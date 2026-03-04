import { describe, it, expect, beforeEach } from 'vitest';
import { ActionManager } from '../src/managers/action-manager.js';
import type { ReduxActionEntry } from '@mcp-rn-devtools/shared';

function makeEntry(overrides: Partial<ReduxActionEntry> = {}): ReduxActionEntry {
  return {
    id: `action-${Math.random()}`,
    actionType: 'test/action',
    timestamp: Date.now(),
    duration: 1,
    changedKeys: [],
    storeName: 'redux',
    ...overrides,
  };
}

describe('ActionManager', () => {
  let manager: ActionManager;

  beforeEach(() => {
    manager = new ActionManager();
  });

  it('should add and retrieve actions', () => {
    manager.add(makeEntry());
    manager.add(makeEntry());
    expect(manager.getActions()).toHaveLength(2);
  });

  it('should filter by action type', () => {
    manager.add(makeEntry({ actionType: 'auth/login' }));
    manager.add(makeEntry({ actionType: 'ui/setTheme' }));
    manager.add(makeEntry({ actionType: 'auth/logout' }));

    const results = manager.getActions({ actionType: 'auth' });
    expect(results).toHaveLength(2);
  });

  it('should filter by store name', () => {
    manager.add(makeEntry({ storeName: 'main' }));
    manager.add(makeEntry({ storeName: 'auth' }));

    const results = manager.getActions({ storeName: 'main' });
    expect(results).toHaveLength(1);
  });

  it('should filter by search in action types and changed keys', () => {
    manager.add(makeEntry({ actionType: 'auth/login', changedKeys: ['user'] }));
    manager.add(makeEntry({ actionType: 'ui/toggle', changedKeys: ['theme'] }));

    expect(manager.getActions({ search: 'user' })).toHaveLength(1);
    expect(manager.getActions({ search: 'toggle' })).toHaveLength(1);
  });

  it('should filter by since timestamp', () => {
    const now = Date.now();
    manager.add(makeEntry({ timestamp: now - 10000 }));
    manager.add(makeEntry({ timestamp: now }));

    expect(manager.getActions({ since: now - 5000 })).toHaveLength(1);
  });

  it('should respect limit', () => {
    for (let i = 0; i < 10; i++) {
      manager.add(makeEntry());
    }
    expect(manager.getActions({ limit: 3 })).toHaveLength(3);
  });

  it('should respect buffer size', () => {
    for (let i = 0; i < 600; i++) {
      manager.add(makeEntry());
    }
    expect(manager.count).toBe(500);
  });

  describe('getSummary', () => {
    it('should aggregate by action type', () => {
      manager.add(makeEntry({ actionType: 'a/foo', duration: 5 }));
      manager.add(makeEntry({ actionType: 'a/foo', duration: 15 }));
      manager.add(makeEntry({ actionType: 'b/bar', duration: 3 }));

      const summary = manager.getSummary();
      expect(summary).toHaveLength(2);
      expect(summary[0].actionType).toBe('a/foo');
      expect(summary[0].count).toBe(2);
      expect(summary[0].avgDuration).toBe(10);
      expect(summary[0].totalDuration).toBe(20);
    });

    it('should sort by count descending', () => {
      manager.add(makeEntry({ actionType: 'rare' }));
      manager.add(makeEntry({ actionType: 'frequent' }));
      manager.add(makeEntry({ actionType: 'frequent' }));
      manager.add(makeEntry({ actionType: 'frequent' }));

      const summary = manager.getSummary();
      expect(summary[0].actionType).toBe('frequent');
    });
  });

  it('should clear all entries', () => {
    manager.add(makeEntry());
    manager.clear();
    expect(manager.count).toBe(0);
  });
});
