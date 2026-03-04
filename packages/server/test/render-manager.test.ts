import { describe, it, expect, beforeEach } from 'vitest';
import { RenderManager } from '../src/managers/render-manager.js';
import type { RenderProfileEntry } from '@mcp-rn-devtools/shared';

function makeEntry(overrides: Partial<RenderProfileEntry> = {}): RenderProfileEntry {
  return {
    id: `render-${Math.random()}`,
    component: 'TestComponent',
    phase: 'update',
    actualDuration: 5,
    baseDuration: 3,
    startTime: 100,
    commitTime: 105,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('RenderManager', () => {
  let manager: RenderManager;

  beforeEach(() => {
    manager = new RenderManager();
  });

  it('should add and retrieve render entries', () => {
    manager.add(makeEntry());
    manager.add(makeEntry());
    expect(manager.getRenders()).toHaveLength(2);
  });

  it('should filter by component name', () => {
    manager.add(makeEntry({ component: 'UserList' }));
    manager.add(makeEntry({ component: 'Header' }));
    manager.add(makeEntry({ component: 'UserCard' }));

    const results = manager.getRenders({ component: 'user' });
    expect(results).toHaveLength(2);
  });

  it('should filter slow renders', () => {
    manager.add(makeEntry({ actualDuration: 5 }));
    manager.add(makeEntry({ actualDuration: 20 }));
    manager.add(makeEntry({ actualDuration: 50 }));

    const slow = manager.getRenders({ slowOnly: true, threshold: 16 });
    expect(slow).toHaveLength(2);
  });

  it('should filter by since timestamp', () => {
    const now = Date.now();
    manager.add(makeEntry({ timestamp: now - 10000 }));
    manager.add(makeEntry({ timestamp: now }));

    const results = manager.getRenders({ since: now - 5000 });
    expect(results).toHaveLength(1);
  });

  it('should respect limit', () => {
    for (let i = 0; i < 10; i++) {
      manager.add(makeEntry());
    }
    const results = manager.getRenders({ limit: 3 });
    expect(results).toHaveLength(3);
  });

  it('should respect buffer size', () => {
    for (let i = 0; i < 600; i++) {
      manager.add(makeEntry());
    }
    expect(manager.count).toBe(500);
  });

  describe('getSummary', () => {
    it('should aggregate by component', () => {
      manager.add(makeEntry({ component: 'A', actualDuration: 10 }));
      manager.add(makeEntry({ component: 'A', actualDuration: 20 }));
      manager.add(makeEntry({ component: 'B', actualDuration: 5 }));

      const summary = manager.getSummary();
      expect(summary).toHaveLength(2);
      expect(summary[0].component).toBe('A');
      expect(summary[0].renderCount).toBe(2);
      expect(summary[0].avgDuration).toBe(15);
      expect(summary[0].totalDuration).toBe(30);
    });

    it('should sort by total duration descending', () => {
      manager.add(makeEntry({ component: 'Low', actualDuration: 1 }));
      manager.add(makeEntry({ component: 'High', actualDuration: 100 }));

      const summary = manager.getSummary();
      expect(summary[0].component).toBe('High');
    });

    it('should count slow renders', () => {
      manager.add(makeEntry({ component: 'A', actualDuration: 5 }));
      manager.add(makeEntry({ component: 'A', actualDuration: 20 }));
      manager.add(makeEntry({ component: 'A', actualDuration: 50 }));

      const summary = manager.getSummary();
      expect(summary[0].slowRenders).toBe(2);
    });
  });
});
