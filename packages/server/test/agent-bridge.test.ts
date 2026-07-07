import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentBridge } from '../src/cdp/agent-bridge.js';
import { AGENT_GLOBAL_KEY, AGENT_SCRIPT } from '../src/cdp/agent-script.js';

/**
 * Simulates the Hermes side: a stub agent object evaluated against the
 * expressions the bridge sends. Expressions are matched by the agent method
 * they invoke.
 */
function createMockCDP(handlers: Record<string, (expr: string) => unknown>, opts?: { installed?: boolean }) {
  let installed = opts?.installed ?? true;
  const send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method !== 'Runtime.evaluate') return {};
    const expr = params?.expression as string;

    if (expr.includes('already-installed') || expr === AGENT_SCRIPT) {
      const value = installed ? 'already-installed' : 'installed';
      installed = true;
      return { result: { value } };
    }

    if (!installed) return { result: { value: null } };

    for (const [needle, handler] of Object.entries(handlers)) {
      if (expr.includes(needle)) {
        return { result: { value: handler(expr) } };
      }
    }
    return { result: { value: null } };
  });

  return { send, connected: true };
}

describe('AgentBridge', () => {
  let bridge: AgentBridge;

  beforeEach(() => {
    bridge = new AgentBridge();
  });

  it('injects the agent script', async () => {
    const cdp = createMockCDP({}, { installed: false });
    const ok = await bridge.inject(cdp as never);
    expect(ok).toBe(true);
    expect(cdp.send).toHaveBeenCalledWith(
      'Runtime.evaluate',
      expect.objectContaining({ expression: AGENT_SCRIPT }),
    );
  });

  it('parses discovery results', async () => {
    const discovery = { hasHook: true, stores: ['redux'], queryClient: false, navigation: true, visited: 700 };
    const cdp = createMockCDP({
      'a.discover()': () => JSON.stringify(discovery),
    });

    const result = await bridge.discover(cdp as never);
    expect(result).toEqual(discovery);
  });

  it('reads state through getStateJson with name, path and depth', async () => {
    const cdp = createMockCDP({
      'a.summaryJson()': () => JSON.stringify({ stores: ['redux'], queryClient: false, navigation: false, pendingActions: 0 }),
      'a.getStateJson(': (expr) => {
        expect(expr).toContain('"auth"');
        expect(expr).toContain('"user.name"');
        expect(expr).toContain(', 3)');
        return JSON.stringify({ found: true, stores: ['auth'], store: 'auth', data: 'Pablo' });
      },
    });

    const result = await bridge.getState(cdp as never, 'auth', 'user.name', 3);
    expect(result?.found).toBe(true);
    expect(result?.data).toBe('Pablo');
  });

  it('re-injects and retries when the agent is missing (e.g. after reload)', async () => {
    const cdp = createMockCDP(
      { 'a.summaryJson()': () => JSON.stringify({ stores: [], queryClient: false, navigation: false, pendingActions: 0 }) },
      { installed: false },
    );

    const summary = await bridge.summary(cdp as never);
    expect(summary).toEqual({ stores: [], queryClient: false, navigation: false, pendingActions: 0 });
  });

  it('runs discovery lazily before state reads when no stores are registered', async () => {
    let discovered = false;
    const cdp = createMockCDP({
      'a.summaryJson()': () =>
        JSON.stringify({ stores: discovered ? ['redux'] : [], queryClient: false, navigation: false, pendingActions: 0 }),
      'a.discover()': () => {
        discovered = true;
        return JSON.stringify({ hasHook: true, stores: ['redux'], queryClient: false, navigation: false, visited: 1 });
      },
      'a.getStateJson(': () => JSON.stringify({ found: true, stores: ['redux'], store: 'redux', data: { a: 1 } }),
    });

    const result = await bridge.getState(cdp as never);
    expect(discovered).toBe(true);
    expect(result?.found).toBe(true);
  });

  it('resolves storage operations via kick-and-poll', async () => {
    let kicked = false;
    const cdp = createMockCDP({
      'a.storageKick(': () => {
        kicked = true;
        return 'kicked';
      },
      'a.readResultJson(': () =>
        JSON.stringify(kicked ? { done: true, ok: true, value: ['key1', 'key2'], error: null } : { done: false }),
    });

    const result = await bridge.storageOp(cdp as never, 'keys');
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(['key1', 'key2']);
  });

  it('times out storage operations that never complete', async () => {
    const cdp = createMockCDP({
      'a.storageKick(': () => 'kicked',
      'a.readResultJson(': () => JSON.stringify({ done: false }),
    });

    const result = await bridge.storageOp(cdp as never, 'keys', undefined, undefined, 500);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('timed out');
  });

  it('drains actions into typed entries', async () => {
    const actions = [
      { id: 'agent-action-1', actionType: 'auth/login', timestamp: 1, duration: 2, changedKeys: ['auth'], storeName: 'redux' },
    ];
    const cdp = createMockCDP({
      'a.summaryJson()': () => JSON.stringify({ stores: ['redux'], queryClient: false, navigation: false, pendingActions: 1 }),
      'a.drainActionsJson()': () => JSON.stringify(actions),
    });

    const result = await bridge.drainActions(cdp as never);
    expect(result).toHaveLength(1);
    expect(result[0].actionType).toBe('auth/login');
  });

  it('exposes the agent global key used by the script', () => {
    expect(AGENT_SCRIPT).toContain(AGENT_GLOBAL_KEY);
  });
});
