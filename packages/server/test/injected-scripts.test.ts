import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { NETWORK_INTERCEPTOR_SCRIPT, DRAIN_SCRIPT } from '../src/managers/network-manager.js';
import { AGENT_SCRIPT } from '../src/cdp/agent-script.js';

// Hermes' evaluate scope: `globalThis` exists, `global` does not (Metro only passes it to modules).
function hermesLikeContext(withXhr = true): vm.Context {
  const context = vm.createContext({});
  if (withXhr) {
    vm.runInContext(
      `
      function XMLHttpRequest() { this.listeners = {}; this.status = 0; this.responseType = ''; this.responseText = ''; }
      XMLHttpRequest.prototype.open = function(method, url) { this.method = method; this.url = url; };
      XMLHttpRequest.prototype.setRequestHeader = function() {};
      XMLHttpRequest.prototype.send = function() {};
      XMLHttpRequest.prototype.addEventListener = function(event, fn) { (this.listeners[event] = this.listeners[event] || []).push(fn); };
      XMLHttpRequest.prototype.getAllResponseHeaders = function() { return 'content-type: application/json\\r\\nx-req: 1\\r\\n'; };
      XMLHttpRequest.prototype.fire = function(event) { var self = this; (this.listeners[event] || []).forEach(function(fn) { fn.call(self); }); };
      `,
      context,
    );
  }
  return context;
}

describe('scripts injected through Runtime.evaluate', () => {
  it('the network interceptor installs without a `global` binding and captures XHR traffic', () => {
    const context = hermesLikeContext();
    expect(vm.runInContext(NETWORK_INTERCEPTOR_SCRIPT, context)).toBe(true);
    expect(vm.runInContext('typeof global', context)).toBe('undefined');
    expect(vm.runInContext('globalThis.__RN_DEVTOOLS_INJECTED__', context)).toBe(true);

    vm.runInContext(
      `
      var xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://api.example.com/orders');
      xhr.setRequestHeader('Authorization', 'Bearer secret');
      xhr.send('{"id":1}');
      xhr.status = 201;
      xhr.responseText = '{"ok":true}';
      xhr.fire('loadend');
      `,
      context,
    );

    const drained = JSON.parse(vm.runInContext(DRAIN_SCRIPT, context) as string);
    expect(drained).toHaveLength(1);
    expect(drained[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.example.com/orders',
      status: 201,
      requestBody: '{"id":1}',
      responseBody: '{"ok":true}',
      requestHeaders: { Authorization: 'Bearer secret' },
      responseHeaders: { 'content-type': 'application/json', 'x-req': '1' },
    });
    expect(JSON.parse(vm.runInContext(DRAIN_SCRIPT, context) as string)).toEqual([]);
  });

  it('is idempotent: a second injection keeps the first interceptor', () => {
    const context = hermesLikeContext();
    vm.runInContext(NETWORK_INTERCEPTOR_SCRIPT, context);
    const firstOpen = vm.runInContext('XMLHttpRequest.prototype.open', context);
    expect(vm.runInContext(NETWORK_INTERCEPTOR_SCRIPT, context)).toBe(true);
    expect(vm.runInContext('XMLHttpRequest.prototype.open', context)).toBe(firstOpen);
  });

  it('reports false instead of throwing when the runtime has no XMLHttpRequest', () => {
    const context = hermesLikeContext(false);
    expect(vm.runInContext(NETWORK_INTERCEPTOR_SCRIPT, context)).toBe(false);
  });

  it('the runtime agent installs without a `global` binding', () => {
    const context = hermesLikeContext(false);
    expect(vm.runInContext(AGENT_SCRIPT, context)).toBe('installed');
    expect(vm.runInContext(AGENT_SCRIPT, context)).toBe('already-installed');
  });
});
