import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AGENT_SCRIPT, AGENT_GLOBAL_KEY } from '../src/cdp/agent-script.js';

interface FakeStore {
  getState(): unknown;
  dispatch(action: unknown): unknown;
  subscribe(listener: () => void): () => void;
}

function createFakeStore(initial: Record<string, unknown>): FakeStore {
  let state = initial;
  return {
    getState: () => state,
    dispatch(action: unknown) {
      const a = action as { type?: string; payload?: unknown };
      if (a?.type === 'counter/increment') {
        state = { ...state, counter: (state.counter as number) + 1 };
      }
      return action;
    },
    subscribe: () => () => {},
  };
}

function installFakeHook(store: FakeStore) {
  const providerFiber = {
    memoizedProps: { store },
    child: null,
    sibling: null,
    type: { displayName: 'Provider' },
  };
  const root = { current: { memoizedProps: null, child: providerFiber, sibling: null } };
  (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map([[1, {}]]),
    getFiberRoots: () => new Set([root]),
  };
}

function agentGlobal(): Record<string, CallableFunction> {
  return (globalThis as Record<string, unknown>)[AGENT_GLOBAL_KEY] as Record<string, CallableFunction>;
}

describe('AGENT_SCRIPT (evaluated in-process)', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>)[AGENT_GLOBAL_KEY];
    delete (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    delete (globalThis as Record<string, unknown>).nativeModuleProxy;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[AGENT_GLOBAL_KEY];
    delete (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    delete (globalThis as Record<string, unknown>).nativeModuleProxy;
  });

  it('installs exactly once', () => {
    expect(eval(AGENT_SCRIPT)).toBe('installed');
    expect(eval(AGENT_SCRIPT)).toBe('already-installed');
  });

  it('discovers a redux store through the fiber tree and reads state', () => {
    const store = createFakeStore({ counter: 0, auth: { user: 'Pablo' } });
    installFakeHook(store);
    eval(AGENT_SCRIPT);

    const report = agentGlobal().discover() as { stores: string[] };
    expect(report.stores).toEqual(['redux']);

    const state = JSON.parse(agentGlobal().getStateJson(null, 'auth.user', 4) as string);
    expect(state.found).toBe(true);
    expect(state.data).toBe('Pablo');
  });

  it('records dispatched actions with changed keys after discovery', () => {
    const store = createFakeStore({ counter: 0 });
    installFakeHook(store);
    eval(AGENT_SCRIPT);
    agentGlobal().discover();

    // dispatch through the wrapped store, as app code would
    store.dispatch({ type: 'counter/increment' });
    store.dispatch({ type: 'noop' });

    const drained = JSON.parse(agentGlobal().drainActionsJson() as string) as Array<{
      actionType: string;
      changedKeys: string[];
    }>;
    expect(drained).toHaveLength(2);
    expect(drained[0].actionType).toBe('counter/increment');
    expect(drained[0].changedKeys).toEqual(['counter']);
    expect(drained[1].changedKeys).toEqual([]);

    // drain empties the buffer
    expect(JSON.parse(agentGlobal().drainActionsJson() as string)).toEqual([]);
  });

  it('dispatches actions into the store via dispatchJson', () => {
    const store = createFakeStore({ counter: 5 });
    installFakeHook(store);
    eval(AGENT_SCRIPT);
    agentGlobal().discover();

    const result = JSON.parse(
      agentGlobal().dispatchJson(null, { type: 'counter/increment' }) as string,
    );
    expect(result.ok).toBe(true);
    expect((store.getState() as { counter: number }).counter).toBe(6);
  });

  it('summarizes deep state instead of dumping it (prune)', () => {
    const store = createFakeStore({
      deep: { l2: { l3: { l4: { l5: 'value' } } } },
      big: Array.from({ length: 200 }, (_, i) => i),
    });
    installFakeHook(store);
    eval(AGENT_SCRIPT);
    agentGlobal().discover();

    const state = JSON.parse(agentGlobal().getStateJson(null, null, 2) as string);
    expect(typeof state.data.deep.l2).toBe('string');
    expect(state.data.big.length).toBeLessThanOrEqual(51);
  });

  it('reads AsyncStorage through nativeModuleProxy with kick-and-poll', () => {
    (globalThis as Record<string, unknown>).nativeModuleProxy = {
      RNCAsyncStorage: {
        getAllKeys: (cb: (err: unknown, keys: string[]) => void) => cb(null, ['k1', 'k2']),
        multiGet: (keys: string[], cb: (err: unknown, pairs: [string, string][]) => void) =>
          cb(null, [[keys[0], 'value-1']]),
        multiSet: (_pairs: [string, string][], cb: (err: unknown) => void) => cb(null),
        multiRemove: (_keys: string[], cb: (err: unknown) => void) => cb(null),
      },
    };
    eval(AGENT_SCRIPT);

    expect(agentGlobal().storageKick('r1', 'keys')).toBe('kicked');
    const keys = JSON.parse(agentGlobal().readResultJson('r1') as string);
    expect(keys).toMatchObject({ done: true, ok: true, value: ['k1', 'k2'] });

    agentGlobal().storageKick('r2', 'get', 'k1');
    const value = JSON.parse(agentGlobal().readResultJson('r2') as string);
    expect(value).toMatchObject({ done: true, ok: true, value: 'value-1' });

    // results are one-shot
    expect(JSON.parse(agentGlobal().readResultJson('r1') as string)).toEqual({ done: false });
  });

  it('reports a clean error when AsyncStorage is unavailable', () => {
    eval(AGENT_SCRIPT);
    expect(agentGlobal().storageKick('r1', 'keys')).toBe('no-mod');
    const result = JSON.parse(agentGlobal().readResultJson('r1') as string);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('reports missing hook gracefully', () => {
    eval(AGENT_SCRIPT);
    const report = agentGlobal().discover() as { hasHook: boolean; stores: string[] };
    expect(report.hasHook).toBe(false);
    expect(report.stores).toEqual([]);
  });
});
