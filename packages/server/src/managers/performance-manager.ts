import type { HeapUsage, HeapSnapshotSummary, CPUProfileFunction } from '@mcp-rn-devtools/shared';
import type { CDPConnection } from '../cdp/connection.js';
import { logger } from '../utils/logger.js';

export class PerformanceManager {
  private profiling = false;

  // Note: Debugger.enable is called globally by ConnectionManager at connect time.
  // Hermes transitions from RunningDetached → Running, enabling HeapProfiler,
  // Runtime.evaluate, and console events. No per-operation enable/disable needed.

  async getHeapUsage(cdp: CDPConnection): Promise<HeapUsage> {
    const response = await cdp.send('Runtime.getHeapUsage');
    const result = response.result as Record<string, unknown> | undefined;
    return {
      usedSize: (result?.usedSize as number) ?? 0,
      totalSize: (result?.totalSize as number) ?? 0,
    };
  }

  async takeHeapSnapshot(cdp: CDPConnection): Promise<HeapSnapshotSummary> {
    const chunks: string[] = [];

    const chunkHandler = (params: Record<string, unknown>) => {
      const chunk = params.chunk as string;
      if (chunk) chunks.push(chunk);
    };

    cdp.on('HeapProfiler.addHeapSnapshotChunk', chunkHandler);

    try {
      await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });

      const raw = chunks.join('');
      return this.summarizeSnapshot(raw);
    } finally {
      cdp.removeListener('HeapProfiler.addHeapSnapshotChunk', chunkHandler);
    }
  }

  async getCPUProfile(cdp: CDPConnection, durationMs: number): Promise<CPUProfileFunction[]> {
    if (this.profiling) {
      throw new Error('CPU profiling already in progress');
    }

    this.profiling = true;
    try {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.start');

      await new Promise((resolve) => setTimeout(resolve, durationMs));

      const response = await cdp.send('Profiler.stop');
      await cdp.send('Profiler.disable');

      const profile = (response.result as Record<string, unknown>)?.profile as Record<string, unknown> | undefined;
      if (!profile) return [];

      return this.extractHotFunctions(profile);
    } finally {
      this.profiling = false;
    }
  }

  async forceGC(cdp: CDPConnection): Promise<{ before: HeapUsage; after: HeapUsage }> {
    const before = await this.getHeapUsage(cdp);

    // Try HeapProfiler.collectGarbage with debugger attached.
    // Falls back to Runtime.evaluate gc() for Hermes environments
    // where even Debugger.enable doesn't help.
    let gcSucceeded = false;
    try {
      await cdp.send('HeapProfiler.collectGarbage');
      gcSucceeded = true;
    } catch (e) {
      logger.debug('HeapProfiler.collectGarbage failed, trying gc() fallback', (e as Error).message);
    }

    if (!gcSucceeded) {
      // Hermes exposes a global gc() in debug builds
      try {
        await cdp.send('Runtime.evaluate', {
          expression: '(typeof gc !== "undefined" ? gc() : undefined)',
          returnByValue: true,
        });
      } catch {
        logger.debug('gc() fallback also failed');
      }
    }

    // Small delay to let GC settle
    await new Promise((resolve) => setTimeout(resolve, 100));
    const after = await this.getHeapUsage(cdp);
    return { before, after };
  }

  private summarizeSnapshot(raw: string): HeapSnapshotSummary {
    try {
      const snapshot = JSON.parse(raw);
      const nodes = snapshot.nodes as number[] | undefined;
      const strings = snapshot.strings as string[] | undefined;
      const nodeFields = snapshot.snapshot?.meta?.node_fields as string[] | undefined;

      if (!nodes || !strings || !nodeFields) {
        return { totalSize: 0, totalObjects: 0, topRetainers: [] };
      }

      const fieldCount = nodeFields.length;
      const _typeIdx = nodeFields.indexOf('type');
      const nameIdx = nodeFields.indexOf('name');
      const selfSizeIdx = nodeFields.indexOf('self_size');

      const retainerMap = new Map<string, { size: number; count: number }>();
      let totalSize = 0;
      let totalObjects = 0;

      for (let i = 0; i < nodes.length; i += fieldCount) {
        const selfSize = selfSizeIdx >= 0 ? nodes[i + selfSizeIdx] : 0;
        const name = nameIdx >= 0 ? strings[nodes[i + nameIdx]] : 'unknown';

        totalSize += selfSize;
        totalObjects++;

        if (selfSize > 0 && name) {
          const existing = retainerMap.get(name);
          if (existing) {
            existing.size += selfSize;
            existing.count++;
          } else {
            retainerMap.set(name, { size: selfSize, count: 1 });
          }
        }
      }

      const topRetainers = Array.from(retainerMap.entries())
        .map(([name, { size, count }]) => ({ name, size, count }))
        .sort((a, b) => b.size - a.size)
        .slice(0, 20);

      return { totalSize, totalObjects, topRetainers };
    } catch (e) {
      logger.warn('Failed to parse heap snapshot', e);
      return { totalSize: 0, totalObjects: 0, topRetainers: [] };
    }
  }

  private extractHotFunctions(profile: Record<string, unknown>): CPUProfileFunction[] {
    const nodes = profile.nodes as Array<{
      id: number;
      callFrame: { functionName: string; url: string; lineNumber: number };
      hitCount?: number;
      children?: number[];
    }> | undefined;

    if (!nodes) return [];

    const samples = profile.samples as number[] | undefined;
    const timeDeltas = profile.timeDeltas as number[] | undefined;

    // Calculate self time from samples and time deltas
    const selfTimeMap = new Map<number, number>();

    if (samples && timeDeltas) {
      for (let i = 0; i < samples.length; i++) {
        const nodeId = samples[i];
        const delta = timeDeltas[i] ?? 0;
        selfTimeMap.set(nodeId, (selfTimeMap.get(nodeId) ?? 0) + delta);
      }
    }

    const functions: CPUProfileFunction[] = [];
    for (const node of nodes) {
      const selfTime = selfTimeMap.get(node.id) ?? 0;
      const { functionName, url, lineNumber } = node.callFrame;

      if (selfTime > 0 && functionName) {
        functions.push({
          functionName,
          url: url || '(native)',
          lineNumber,
          selfTime: Math.round(selfTime / 1000), // microseconds to ms
          totalTime: 0, // approximate — would need tree traversal
        });
      }
    }

    // Deduplicate by function name + url
    const deduped = new Map<string, CPUProfileFunction>();
    for (const fn of functions) {
      const key = `${fn.functionName}@${fn.url}:${fn.lineNumber}`;
      const existing = deduped.get(key);
      if (existing) {
        existing.selfTime += fn.selfTime;
      } else {
        deduped.set(key, { ...fn });
      }
    }

    return Array.from(deduped.values())
      .sort((a, b) => b.selfTime - a.selfTime)
      .slice(0, 30);
  }
}
