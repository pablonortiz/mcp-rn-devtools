import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PerformanceManager } from '../src/managers/performance-manager.js';
import { EventEmitter } from 'events';

function createMockCDP() {
  const emitter = new EventEmitter();
  const cdp = Object.assign(emitter, {
    connected: true,
    send: vi.fn(),
  });
  return cdp;
}

describe('PerformanceManager', () => {
  let manager: PerformanceManager;
  let cdp: ReturnType<typeof createMockCDP>;

  beforeEach(() => {
    manager = new PerformanceManager();
    cdp = createMockCDP();
  });

  describe('getHeapUsage', () => {
    it('should return heap usage from CDP', async () => {
      cdp.send.mockResolvedValue({
        result: { usedSize: 5242880, totalSize: 10485760 },
      });

      const usage = await manager.getHeapUsage(cdp as any);
      expect(usage.usedSize).toBe(5242880);
      expect(usage.totalSize).toBe(10485760);
      expect(cdp.send).toHaveBeenCalledWith('Runtime.getHeapUsage');
    });

    it('should handle missing result', async () => {
      cdp.send.mockResolvedValue({ result: {} });

      const usage = await manager.getHeapUsage(cdp as any);
      expect(usage.usedSize).toBe(0);
      expect(usage.totalSize).toBe(0);
    });
  });

  describe('forceGC', () => {
    it('should return before/after heap comparison', async () => {
      let callCount = 0;
      cdp.send.mockImplementation(async (method: string) => {
        if (method === 'Runtime.getHeapUsage') {
          callCount++;
          if (callCount === 1) {
            return { result: { usedSize: 10000000, totalSize: 20000000 } };
          }
          return { result: { usedSize: 5000000, totalSize: 20000000 } };
        }
        return {};
      });

      const result = await manager.forceGC(cdp as any);
      expect(result.before.usedSize).toBe(10000000);
      expect(result.after.usedSize).toBe(5000000);
      expect(cdp.send).toHaveBeenCalledWith('HeapProfiler.collectGarbage');
      // Debugger.enable is now managed globally by ConnectionManager, not per-operation
    });

    it('should fall back to gc() when HeapProfiler.collectGarbage fails', async () => {
      let callCount = 0;
      cdp.send.mockImplementation(async (method: string) => {
        if (method === 'Runtime.getHeapUsage') {
          callCount++;
          if (callCount === 1) {
            return { result: { usedSize: 8000000, totalSize: 20000000 } };
          }
          return { result: { usedSize: 6000000, totalSize: 20000000 } };
        }
        if (method === 'HeapProfiler.collectGarbage') {
          throw new Error('RunningDetached, expected paused or running');
        }
        return {};
      });

      const result = await manager.forceGC(cdp as any);
      expect(result.before.usedSize).toBe(8000000);
      expect(result.after.usedSize).toBe(6000000);
      // Should have attempted the gc() fallback
      expect(cdp.send).toHaveBeenCalledWith('Runtime.evaluate', expect.objectContaining({
        expression: expect.stringContaining('gc()'),
      }));
    });
  });

  describe('getCPUProfile', () => {
    it('should profile and return hot functions', async () => {
      cdp.send.mockImplementation(async (method: string) => {
        if (method === 'Profiler.stop') {
          return {
            result: {
              profile: {
                nodes: [
                  {
                    id: 1,
                    callFrame: { functionName: 'render', url: 'App.js', lineNumber: 10 },
                    hitCount: 5,
                  },
                  {
                    id: 2,
                    callFrame: { functionName: 'update', url: 'State.js', lineNumber: 20 },
                    hitCount: 3,
                  },
                ],
                samples: [1, 1, 1, 2, 2],
                timeDeltas: [1000, 2000, 1500, 3000, 2500],
              },
            },
          };
        }
        return {};
      });

      const functions = await manager.getCPUProfile(cdp as any, 100);
      expect(functions.length).toBeGreaterThan(0);
      expect(functions[0].functionName).toBeDefined();
      expect(functions[0].selfTime).toBeGreaterThan(0);
    });

    it('should reject concurrent profiling', async () => {
      cdp.send.mockImplementation(async (method: string) => {
        if (method === 'Profiler.stop') {
          return { result: { profile: { nodes: [], samples: [], timeDeltas: [] } } };
        }
        return {};
      });

      const p1 = manager.getCPUProfile(cdp as any, 100);
      await expect(manager.getCPUProfile(cdp as any, 100)).rejects.toThrow('already in progress');
      await p1;
    });
  });

  describe('takeHeapSnapshot', () => {
    it('should accumulate chunks and return summary', async () => {
      const snapshot = {
        snapshot: {
          meta: {
            node_fields: ['type', 'name', 'id', 'self_size', 'edge_count', 'trace_node_id'],
          },
        },
        nodes: [0, 0, 1, 100, 0, 0, 0, 1, 2, 200, 0, 0],
        strings: ['hidden', 'Object', 'Array'],
      };
      const json = JSON.stringify(snapshot);

      cdp.send.mockImplementation(async (method: string) => {
        if (method === 'HeapProfiler.takeHeapSnapshot') {
          // Simulate chunks being sent
          cdp.emit('HeapProfiler.addHeapSnapshotChunk', { chunk: json.slice(0, 50) });
          cdp.emit('HeapProfiler.addHeapSnapshotChunk', { chunk: json.slice(50) });
          return {};
        }
        return {};
      });

      const summary = await manager.takeHeapSnapshot(cdp as any);
      expect(summary.totalObjects).toBe(2);
      expect(summary.totalSize).toBe(300);
      expect(summary.topRetainers.length).toBeGreaterThan(0);
      // Debugger.enable is now managed globally by ConnectionManager
    });
  });
});
