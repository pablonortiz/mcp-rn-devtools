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

  it('should truncate large state to 50KB', () => {
    const largeState: Record<string, string> = {};
    for (let i = 0; i < 5000; i++) {
      largeState[`key${i}`] = 'x'.repeat(100);
    }

    manager.addSnapshot({ name: 'big', state: largeState, timestamp: Date.now() });

    const result = manager.getState('big');
    expect(result.truncated).toBe(true);
  });

  it('should clear all data', () => {
    manager.addSnapshot({ name: 'redux', state: {}, timestamp: Date.now() });
    manager.clear();

    expect(manager.getStoreNames()).toEqual([]);
  });
});
