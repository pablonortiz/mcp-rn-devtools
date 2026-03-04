import type { ReduxActionEntry } from '@mcp-rn-devtools/shared';
import { ACTION_BUFFER_SIZE } from '@mcp-rn-devtools/shared';

export class ActionManager {
  private buffer: ReduxActionEntry[] = [];

  add(entry: ReduxActionEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length > ACTION_BUFFER_SIZE) {
      this.buffer.shift();
    }
  }

  getActions(options?: {
    actionType?: string;
    storeName?: string;
    limit?: number;
    since?: number;
    search?: string;
  }): ReduxActionEntry[] {
    let entries = [...this.buffer];

    if (options?.since) {
      entries = entries.filter((e) => e.timestamp >= options.since!);
    }
    if (options?.storeName) {
      entries = entries.filter((e) => e.storeName === options.storeName);
    }
    if (options?.actionType) {
      const t = options.actionType.toLowerCase();
      entries = entries.filter((e) => e.actionType.toLowerCase().includes(t));
    }
    if (options?.search) {
      const s = options.search.toLowerCase();
      entries = entries.filter(
        (e) =>
          e.actionType.toLowerCase().includes(s) ||
          e.changedKeys.some((k) => k.toLowerCase().includes(s)),
      );
    }
    if (options?.limit) {
      entries = entries.slice(-options.limit);
    }

    return entries;
  }

  getSummary(): Array<{
    actionType: string;
    count: number;
    avgDuration: number;
    totalDuration: number;
  }> {
    const map = new Map<string, { count: number; total: number }>();

    for (const entry of this.buffer) {
      const existing = map.get(entry.actionType);
      if (existing) {
        existing.count++;
        existing.total += entry.duration;
      } else {
        map.set(entry.actionType, { count: 1, total: entry.duration });
      }
    }

    return Array.from(map.entries())
      .map(([actionType, data]) => ({
        actionType,
        count: data.count,
        avgDuration: Math.round((data.total / data.count) * 100) / 100,
        totalDuration: data.total,
      }))
      .sort((a, b) => b.count - a.count);
  }

  get count(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer = [];
  }
}
