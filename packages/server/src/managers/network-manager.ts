import type { NetworkRequest } from '@mcp-rn-devtools/shared';
import {
  NETWORK_BUFFER_SIZE,
  NETWORK_POLL_INTERVAL_MS,
  GLOBAL_NETWORK_KEY,
  GLOBAL_INJECTED_KEY,
} from '@mcp-rn-devtools/shared';
import type { CDPConnection } from '../cdp/connection.js';
import { evaluateByValue } from '../cdp/evaluate.js';
import { logger } from '../utils/logger.js';

// `global` is not a binding in Hermes' evaluate scope (Metro only passes it to
// module factories), so the scripts resolve the global object themselves.
export const NETWORK_INTERCEPTOR_SCRIPT = `
(function() {
  var g = (typeof globalThis !== 'undefined' ? globalThis : this);
  if (g.${GLOBAL_INJECTED_KEY}) return true;
  if (typeof g.XMLHttpRequest !== 'function') return false;
  g.${GLOBAL_INJECTED_KEY} = true;
  g.${GLOBAL_NETWORK_KEY} = [];

  var _id = 0;
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  var origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._devtools = {
      id: 'cdp-net-' + (++_id),
      method: method,
      url: typeof url === 'string' ? url : String(url),
      requestHeaders: {},
      startTime: Date.now()
    };
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function(key, value) {
    if (this._devtools) {
      this._devtools.requestHeaders[key] = value;
    }
    return origSetHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    if (this._devtools) {
      this._devtools.requestBody = typeof body === 'string' ? body : null;
      var entry = this._devtools;
      this.addEventListener('loadend', function() {
        entry.status = this.status;
        entry.endTime = Date.now();
        entry.duration = entry.endTime - entry.startTime;
        try {
          entry.responseHeaders = {};
          var headers = this.getAllResponseHeaders();
          if (headers) {
            headers.split('\\r\\n').forEach(function(line) {
              var idx = line.indexOf(': ');
              if (idx > 0) entry.responseHeaders[line.substring(0, idx)] = line.substring(idx + 2);
            });
          }
        } catch(e) {}
        try {
          if (this.responseType === '' || this.responseType === 'text') {
            entry.responseBody = typeof this.responseText === 'string' ? this.responseText.substring(0, 4096) : null;
          }
        } catch(e) {}
        g.${GLOBAL_NETWORK_KEY}.push(entry);
      });
      this.addEventListener('error', function() {
        entry.error = 'Network error';
        entry.endTime = Date.now();
        entry.duration = entry.endTime - entry.startTime;
        g.${GLOBAL_NETWORK_KEY}.push(entry);
      });
      this.addEventListener('timeout', function() {
        entry.error = 'Timeout';
        entry.endTime = Date.now();
        entry.duration = entry.endTime - entry.startTime;
        g.${GLOBAL_NETWORK_KEY}.push(entry);
      });
    }
    return origSend.apply(this, arguments);
  };
  return true;
})()
`;

export const DRAIN_SCRIPT = `
(function() {
  var g = (typeof globalThis !== 'undefined' ? globalThis : this);
  var arr = g.${GLOBAL_NETWORK_KEY};
  if (!arr || arr.length === 0) return JSON.stringify([]);
  var items = arr.splice(0, arr.length);
  return JSON.stringify(items);
})()
`;

export class NetworkManager {
  private buffer: NetworkRequest[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private sdkConnected = false;
  private _interceptorInstalled = false;

  /** True once the zero-config XHR interceptor is confirmed running in the app. */
  get interceptorInstalled(): boolean {
    return this._interceptorInstalled;
  }

  addFromSDK(request: Omit<NetworkRequest, 'source'>): void {
    this.push({ ...request, source: 'sdk' });
  }

  getRequests(options?: {
    limit?: number;
    since?: number;
    search?: string;
    statusFilter?: 'failed' | 'success';
  }): NetworkRequest[] {
    let entries = [...this.buffer];

    if (options?.since) {
      entries = entries.filter((e) => e.startTime >= options.since!);
    }
    if (options?.search) {
      const s = options.search.toLowerCase();
      entries = entries.filter((e) => e.url.toLowerCase().includes(s));
    }
    if (options?.statusFilter === 'failed') {
      entries = entries.filter(
        (e) => (e.status !== null && e.status >= 400) || e.error,
      );
    } else if (options?.statusFilter === 'success') {
      entries = entries.filter(
        (e) => e.status !== null && e.status < 400 && !e.error,
      );
    }
    if (options?.limit) {
      entries = entries.slice(-options.limit);
    }

    return entries;
  }

  getFailedRequests(options?: {
    limit?: number;
    since?: number;
  }): NetworkRequest[] {
    return this.getRequests({ ...options, statusFilter: 'failed' });
  }

  get totalCount(): number {
    return this.buffer.length;
  }

  get failedCount(): number {
    return this.buffer.filter(
      (e) => (e.status !== null && e.status >= 400) || e.error,
    ).length;
  }

  setSDKConnected(connected: boolean): void {
    this.sdkConnected = connected;
  }

  async injectInterceptor(cdp: CDPConnection): Promise<boolean> {
    try {
      const installed = await evaluateByValue(cdp, NETWORK_INTERCEPTOR_SCRIPT);
      this._interceptorInstalled = installed === true;
      if (this._interceptorInstalled) logger.info('Network interceptor injected via CDP');
      else logger.warn('Network interceptor not installed: XMLHttpRequest is not available in this runtime');
    } catch (e) {
      this._interceptorInstalled = false;
      logger.warn('Failed to inject network interceptor', (e as Error).message);
    }
    return this._interceptorInstalled;
  }

  startPolling(cdp: CDPConnection): void {
    this.stopPolling();
    this.pollTimer = setInterval(async () => {
      if (this.sdkConnected) return; // SDK handles network when connected
      try {
        const value = (await evaluateByValue(cdp, DRAIN_SCRIPT)) as string | undefined;
        if (value) {
          const requests: NetworkRequest[] = JSON.parse(value);
          for (const req of requests) {
            this.push({ ...req, source: 'cdp' });
          }
        }
      } catch {
        // Connection may be closed, polling will stop on disconnect
      }
    }, NETWORK_POLL_INTERVAL_MS);
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** The runtime is gone (disconnect, reload, yield): the interceptor must be injected again. */
  detach(): void {
    this.stopPolling();
    this._interceptorInstalled = false;
  }

  clear(): void {
    this.buffer = [];
  }

  private push(entry: NetworkRequest): void {
    this.buffer.push(entry);
    if (this.buffer.length > NETWORK_BUFFER_SIZE) {
      this.buffer.shift();
    }
  }
}
