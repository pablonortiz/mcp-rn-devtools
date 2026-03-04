import { describe, it, expect, beforeEach } from 'vitest';
import { NavigationTimingManager } from '../src/managers/navigation-timing-manager.js';
import type { NavigationState } from '@mcp-rn-devtools/shared';

function makeNavState(routeName: string): NavigationState {
  return {
    currentRoute: { name: routeName, key: `key-${routeName}` },
    stack: [{ name: routeName, key: `key-${routeName}` }],
    index: 0,
    type: 'stack',
    stale: false,
  };
}

describe('NavigationTimingManager', () => {
  let manager: NavigationTimingManager;

  beforeEach(() => {
    manager = new NavigationTimingManager();
  });

  it('should not record transition for first navigation', () => {
    manager.recordNavigation(makeNavState('Home'));
    expect(manager.count).toBe(0);
  });

  it('should record transition between different routes', () => {
    manager.recordNavigation(makeNavState('Home'));
    manager.recordNavigation(makeNavState('Settings'));

    expect(manager.count).toBe(1);
    const transitions = manager.getTransitions();
    expect(transitions[0].fromRoute).toBe('Home');
    expect(transitions[0].toRoute).toBe('Settings');
    expect(transitions[0].duration).toBeGreaterThanOrEqual(0);
  });

  it('should not record transition to same route', () => {
    manager.recordNavigation(makeNavState('Home'));
    manager.recordNavigation(makeNavState('Home'));

    expect(manager.count).toBe(0);
  });

  it('should record multiple transitions', () => {
    manager.recordNavigation(makeNavState('Home'));
    manager.recordNavigation(makeNavState('Settings'));
    manager.recordNavigation(makeNavState('Profile'));

    expect(manager.count).toBe(2);
  });

  it('should filter by route name', () => {
    manager.recordNavigation(makeNavState('Home'));
    manager.recordNavigation(makeNavState('Settings'));
    manager.recordNavigation(makeNavState('Profile'));

    const results = manager.getTransitions({ route: 'settings' });
    expect(results).toHaveLength(2); // Home→Settings and Settings→Profile
  });

  it('should filter by slow threshold', () => {
    manager.recordNavigation(makeNavState('A'));
    // All transitions happen near-instantly in tests
    manager.recordNavigation(makeNavState('B'));

    // These fast transitions should be filtered out with a high threshold
    const results = manager.getTransitions({ slow_threshold: 10000 });
    expect(results).toHaveLength(0);
  });

  it('should respect limit', () => {
    manager.recordNavigation(makeNavState('A'));
    manager.recordNavigation(makeNavState('B'));
    manager.recordNavigation(makeNavState('C'));
    manager.recordNavigation(makeNavState('D'));

    const results = manager.getTransitions({ limit: 2 });
    expect(results).toHaveLength(2);
  });

  describe('getSummary', () => {
    it('should aggregate by destination route', () => {
      manager.recordNavigation(makeNavState('Home'));
      manager.recordNavigation(makeNavState('Settings'));
      manager.recordNavigation(makeNavState('Home'));
      manager.recordNavigation(makeNavState('Settings'));

      const summary = manager.getSummary();
      expect(summary).toHaveLength(2);

      const settingsSummary = summary.find((s) => s.route === 'Settings');
      expect(settingsSummary).toBeDefined();
      expect(settingsSummary!.visits).toBe(2);
    });

    it('should sort by avg mount time descending', () => {
      manager.recordNavigation(makeNavState('A'));
      manager.recordNavigation(makeNavState('B'));
      manager.recordNavigation(makeNavState('C'));

      const summary = manager.getSummary();
      for (let i = 0; i < summary.length - 1; i++) {
        expect(summary[i].avgMountTime).toBeGreaterThanOrEqual(summary[i + 1].avgMountTime);
      }
    });
  });

  it('should clear all data', () => {
    manager.recordNavigation(makeNavState('Home'));
    manager.recordNavigation(makeNavState('Settings'));
    manager.clear();

    expect(manager.count).toBe(0);
  });
});
