import type { NetworkRequest, SDKMessage } from '@mcp-rn-devtools/shared';
import type { WSClient } from '../bridge/ws-client.js';
import { uuid } from '../utils/uuid.js';

// Extend XMLHttpRequest with our tracking data
interface TrackedXHR extends XMLHttpRequest {
  _devtools?: {
    id: string;
    method: string;
    url: string;
    requestHeaders: Record<string, string>;
    requestBody: string | null;
    startTime: number;
  };
}

export function installNetworkInterceptor(client: WSClient): () => void {
  const XHR = (globalThis as any).XMLHttpRequest as typeof XMLHttpRequest | undefined;
  if (!XHR) return () => {};

  const origOpen = XHR.prototype.open;
  const origSend = XHR.prototype.send;
  const origSetRequestHeader = XHR.prototype.setRequestHeader;

  XHR.prototype.open = function (this: TrackedXHR, method: string, url: string | URL, ...rest: any[]) {
    this._devtools = {
      id: `sdk-net-${uuid()}`,
      method,
      url: typeof url === 'string' ? url : url.toString(),
      requestHeaders: {},
      requestBody: null,
      startTime: Date.now(),
    };
    return origOpen.call(this, method, url, ...rest);
  } as typeof XHR.prototype.open;

  XHR.prototype.setRequestHeader = function (this: TrackedXHR, name: string, value: string) {
    if (this._devtools) {
      this._devtools.requestHeaders[name] = value;
    }
    return origSetRequestHeader.call(this, name, value);
  };

  XHR.prototype.send = function (this: TrackedXHR, body?: XMLHttpRequestBodyInit | null) {
    if (this._devtools) {
      this._devtools.requestBody = typeof body === 'string' ? body : null;
      const entry = this._devtools;

      // Send request start
      const requestMsg: SDKMessage = {
        type: 'network:request',
        payload: {
          request: {
            id: entry.id,
            url: entry.url,
            method: entry.method,
            status: null,
            requestHeaders: entry.requestHeaders,
            requestBody: entry.requestBody,
            startTime: entry.startTime,
          } satisfies Omit<NetworkRequest, 'source'>,
        },
        timestamp: Date.now(),
        id: uuid(),
      };
      client.send(requestMsg);

      const sendResponse = (xhr: TrackedXHR, error?: string) => {
        const endTime = Date.now();
        const responseHeaders: Record<string, string> = {};
        try {
          const headers = xhr.getAllResponseHeaders();
          if (headers) {
            for (const line of headers.split('\r\n')) {
              const idx = line.indexOf(': ');
              if (idx > 0) {
                responseHeaders[line.substring(0, idx)] = line.substring(idx + 2);
              }
            }
          }
        } catch { /* ignore */ }

        let responseBody: string | null = null;
        try {
          if (xhr.responseType === '' || xhr.responseType === 'text') {
            responseBody = typeof xhr.responseText === 'string'
              ? xhr.responseText.substring(0, 4096)
              : null;
          }
        } catch { /* ignore */ }

        const responseMsg: SDKMessage = {
          type: 'network:response',
          payload: {
            request: {
              id: entry.id,
              url: entry.url,
              method: entry.method,
              status: error ? null : xhr.status,
              requestHeaders: entry.requestHeaders,
              responseHeaders,
              requestBody: entry.requestBody,
              responseBody,
              startTime: entry.startTime,
              endTime,
              duration: endTime - entry.startTime,
              error,
            } satisfies Omit<NetworkRequest, 'source'>,
          },
          timestamp: Date.now(),
          id: uuid(),
        };
        client.send(responseMsg);
      };

      this.addEventListener('loadend', function (this: TrackedXHR) {
        sendResponse(this);
      });

      this.addEventListener('error', function (this: TrackedXHR) {
        sendResponse(this, 'Network error');
      });

      this.addEventListener('timeout', function (this: TrackedXHR) {
        sendResponse(this, 'Timeout');
      });
    }

    return origSend.call(this, body);
  } as typeof XHR.prototype.send;

  // Return cleanup function
  return () => {
    XHR.prototype.open = origOpen;
    XHR.prototype.send = origSend;
    XHR.prototype.setRequestHeader = origSetRequestHeader;
  };
}
