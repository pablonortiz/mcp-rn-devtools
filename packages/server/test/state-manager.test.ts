import { describe, it, expect, beforeEach } from 'vitest';
import { StateManager } from '../src/managers/state-manager.js';

describe('StateManager', () => {
  let manager: StateManager;

  beforeEach(() => {
    manager = new StateManager();
  });

  it('should store and retrieve snapshots', () => {
    manager.addSnapshot({
      name: 'redux',
      state: { counter: 1 },
      timestamp: Date.now(),
    });

    const result = manager.getState('redux');
    expect(result.found).toBe(true);
    expect(result.data).toEqual({ counter: 1 });
  });

  it('should list store names', () => {
    manager.addSnapshot({ name: 'auth', state: {}, timestamp: Date.now() });
    manager.addSnapshot({ name: 'ui', state: {}, timestamp: Date.now() });

    expect(manager.getStoreNames()).toEqual(['auth', 'ui']);
  });

  it('should return all stores when no name given', () => {
    manager.addSnapshot({ name: 'auth', state: { user: 'john' }, timestamp: Date.now() });
    manager.addSnapshot({ name: 'ui', state: { theme: 'dark' }, timestamp: Date.now() });

    const result = manager.getState();
    expect(result.found).toBe(true);
    expect(result.data).toEqual({
      auth: { user: 'john' },
      ui: { theme: 'dark' },
    });
  });

  it('should return not found for unknown store', () => {
    manager.addSnapshot({ name: 'auth', state: {}, timestamp: Date.now() });

    const result = manager.getState('unknown');
    expect(result.found).toBe(false);
    expect(result.stores).toEqual(['auth']);
  });

  it('should resolve dot-separated paths', () => {
    manager.addSnapshot({
      name: 'redux',
      state: { auth: { user: { name: 'John', age: 30 } } },
      timestamp: Date.now(),
    });

    const result = manager.getState('redux', 'auth.user.name');
    expect(result.found).toBe(true);
    expect(result.data).toBe('John');
  });

  it('should handle undefined path segments', () => {
    manager.addSnapshot({
      name: 'redux',
      state: { auth: { user: null } },
      timestamp: Date.now(),
    });

    const result = manager.getState('redux', 'auth.user.name');
    expect(result.found).toBe(true);
    expect(result.data).toBeUndefined();
  });

  it('should keep only latest snapshot per store', () => {
    manager.addSnapshot({ name: 'redux', state: { v: 1 }, timestamp: 1 });
    manager.addSnapshot({ name: 'redux', state: { v: 2 }, timestamp: 2 });

    const result = manager.getState('redux');
    expect(result.data).toEqual({ v: 2 });
  });

  it('should summarize state beyond the requested depth instead of dumping it', () => {
    const deepState = { level1: { level2: { level3: { level4: { secretDepth: 'value' } } } } };

    manager.addSnapshot({ name: 'deep', state: deepState, timestamp: Date.now() });

    const result = manager.getState('deep', undefined, 2);
    expect(result.found).toBe(true);
    const level2 = (result.data as Record<string, Record<string, unknown>>).level1.level2;
    // depth exhausted → summary string, not the nested object
    expect(typeof level2).toBe('string');
    expect(level2).toContain('level3');
  });

  it('should bound huge collections instead of returning them whole', () => {
    const largeState = { items: Array.from({ length: 500 }, (_, i) => ({ id: i })) };

    manager.addSnapshot({ name: 'big', state: largeState, timestamp: Date.now() });

    const result = manager.getState('big', undefined, 4);
    const items = (result.data as { items: unknown[] }).items;
    expect(items.length).toBeLessThanOrEqual(51); // 50 + overflow marker
  });

  it('should resolve requestId waiters when the snapshot arrives', async () => {
    const waiter = manager.waitForSnapshot('req-1', 1000);
    manager.addSnapshot({ name: 'redux', state: { a: 1 }, timestamp: Date.now() }, 'req-1');

    const snapshot = await waiter;
    expect(snapshot?.name).toBe('redux');
  });

  it('should resolve waiters with null on timeout', async () => {
    const snapshot = await manager.waitForSnapshot('req-nunca-llega', 50);
    expect(snapshot).toBeNull();
  });

  it('should clear all data', () => {
    manager.addSnapshot({ name: 'redux', state: {}, timestamp: Date.now() });
    manager.clear();

    expect(manager.getStoreNames()).toEqual([]);
  });
});
