import type { RenderProfileEntry } from '@mcp-rn-devtools/shared';
import { RENDER_BUFFER_SIZE, RENDER_PROFILE_SLOW_THRESHOLD_MS } from '@mcp-rn-devtools/shared';

export class RenderManager {
  private buffer: RenderProfileEntry[] = [];

  add(entry: RenderProfileEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length > RENDER_BUFFER_SIZE) {
      this.buffer.shift();
    }
  }

  getRenders(options?: {
    component?: string;
    slowOnly?: boolean;
    threshold?: number;
    limit?: number;
    since?: number;
  }): RenderProfileEntry[] {
    let entries = [...this.buffer];
    const threshold = options?.threshold ?? RENDER_PROFILE_SLOW_THRESHOLD_MS;

    if (options?.since) {
      entries = entries.filter((e) => e.timestamp >= options.since!);
    }
    if (options?.component) {
      const c = options.component.toLowerCase();
      entries = entries.filter((e) => e.component.toLowerCase().includes(c));
    }
    if (options?.slowOnly) {
      entries = entries.filter((e) => e.actualDuration > threshold);
    }
    if (options?.limit) {
      entries = entries.slice(-options.limit);
    }

    return entries;
  }

  getSummary(options?: {
    component?: string;
    since?: number;
  }): Array<{
    component: string;
    renderCount: number;
    avgDuration: number;
    totalDuration: number;
    slowRenders: number;
  }> {
    let entries = [...this.buffer];

    if (options?.since) {
      entries = entries.filter((e) => e.timestamp >= options.since!);
    }
    if (options?.component) {
      const c = options.component.toLowerCase();
      entries = entries.filter((e) => e.component.toLowerCase().includes(c));
    }

    const map = new Map<string, { total: number; count: number; slow: number }>();

    for (const entry of entries) {
      const existing = map.get(entry.component);
      if (existing) {
        existing.total += entry.actualDuration;
        existing.count++;
        if (entry.actualDuration > RENDER_PROFILE_SLOW_THRESHOLD_MS) existing.slow++;
      } else {
        map.set(entry.component, {
          total: entry.actualDuration,
          count: 1,
          slow: entry.actualDuration > RENDER_PROFILE_SLOW_THRESHOLD_MS ? 1 : 0,
        });
      }
    }

    return Array.from(map.entries())
      .map(([component, data]) => ({
        component,
        renderCount: data.count,
        avgDuration: Math.round((data.total / data.count) * 100) / 100,
        totalDuration: Math.round(data.total * 100) / 100,
        slowRenders: data.slow,
      }))
      .sort((a, b) => b.totalDuration - a.totalDuration);
  }

  get count(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer = [];
  }
}
