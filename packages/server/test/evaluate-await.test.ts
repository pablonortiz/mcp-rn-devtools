import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import type { CDPConnection } from '../src/cdp/connection.js';
import { evaluateAwaiting, withGlobalAlias } from '../src/tools/evaluate-js.js';

/** A CDP connection whose Runtime.evaluate runs inside a vm context without a `global` binding. */
function contextCdp(context: vm.Context): CDPConnection {
  return {
    connected: true,
    async send(method: string, params?: Record<string, unknown>) {
      if (method !== 'Runtime.evaluate') return {};
      try {
        const value = vm.runInContext(params?.expression as string, context);
        return { result: { type: typeof value, value } };
      } catch (e) {
        return { exceptionDetails: { text: 'Uncaught', exception: { description: String(e) } } };
      }
    },
  } as unknown as CDPConnection;
}

describe('evaluate_js', () => {
  it('exposes `global` only for the duration of the call', () => {
    const context = vm.createContext({});
    expect(vm.runInContext(withGlobalAlias('global === globalThis'), context)).toBe(true);
    expect(vm.runInContext("'global' in globalThis", context)).toBe(false);
  });

  it('keeps statement semantics: the last expression is the result', () => {
    const context = vm.createContext({});
    expect(vm.runInContext(withGlobalAlias('var q = 2; q * 21'), context)).toBe(42);
  });

  it('leaves an existing `global` alone', () => {
    const context = vm.createContext({ global: 'mine' });
    vm.runInContext(withGlobalAlias('1'), context);
    expect(vm.runInContext('global', context)).toBe('mine');
  });

  it('awaits a resolved promise in-app', async () => {
    const cdp = contextCdp(vm.createContext({}));
    const settled = await evaluateAwaiting(cdp, 'Promise.resolve({ a: 1 })', 1000);
    expect(settled).toEqual({ ok: true, value: '{"a":1}' });
  });

  it('reports a rejection', async () => {
    const cdp = contextCdp(vm.createContext({}));
    const settled = await evaluateAwaiting(cdp, "Promise.reject(new Error('boom'))", 1000);
    expect(settled.ok).toBe(false);
    expect(settled.value).toContain('boom');
  });

  it('returns synchronous values directly', async () => {
    const cdp = contextCdp(vm.createContext({}));
    expect(await evaluateAwaiting(cdp, '3 + 4', 1000)).toEqual({ ok: true, value: '7' });
  });

  it('gives up on a promise that never settles', async () => {
    const cdp = contextCdp(vm.createContext({}));
    const settled = await evaluateAwaiting(cdp, 'new Promise(function() {})', 250);
    expect(settled.ok).toBe(false);
    expect(settled.value).toMatch(/did not settle within 250ms/);
  });
});
