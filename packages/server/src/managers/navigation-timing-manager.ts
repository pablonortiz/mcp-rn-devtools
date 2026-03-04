import type { NavigationState } from '@mcp-rn-devtools/shared';

export interface NavigationTransition {
  id: string;
  fromRoute: string;
  toRoute: string;
  duration: number;
  timestamp: number;
}

const BUFFER_SIZE = 200;

export class NavigationTimingManager {
  private buffer: NavigationTransition[] = [];
  private lastRoute: string | null = null;
  private lastTransitionTime: number = 0;
  private idCounter = 0;

  recordNavigation(state: NavigationState): void {
    const currentRoute = state.currentRoute.name;
    const now = Date.now();

    if (this.lastRoute && this.lastRoute !== currentRoute) {
      const duration = now - this.lastTransitionTime;

      this.buffer.push({
        id: `nav-${++this.idCounter}`,
        fromRoute: this.lastRoute,
        toRoute: currentRoute,
        duration,
        timestamp: now,
      });

      if (this.buffer.length > BUFFER_SIZE) {
        this.buffer.shift();
      }
    }

    this.lastRoute = currentRoute;
    this.lastTransitionTime = now;
  }

  getTransitions(options?: {
    limit?: number;
    since?: number;
    route?: string;
    slow_threshold?: number;
  }): NavigationTransition[] {
    let entries = [...this.buffer];

    if (options?.since) {
      entries = entries.filter((e) => e.timestamp >= options.since!);
    }
    if (options?.route) {
      const r = options.route.toLowerCase();
      entries = entries.filter(
        (e) =>
          e.fromRoute.toLowerCase().includes(r) ||
          e.toRoute.toLowerCase().includes(r),
      );
    }
    if (options?.slow_threshold) {
      entries = entries.filter((e) => e.duration >= options.slow_threshold!);
    }
    if (options?.limit) {
      entries = entries.slice(-options.limit);
    }

    return entries;
  }

  getSummary(): Array<{
    route: string;
    avgMountTime: number;
    visits: number;
    slowest: number;
  }> {
    // Group by toRoute (destination)
    const map = new Map<string, { total: number; count: number; max: number }>();

    for (const t of this.buffer) {
      const existing = map.get(t.toRoute);
      if (existing) {
        existing.total += t.duration;
        existing.count++;
        existing.max = Math.max(existing.max, t.duration);
      } else {
        map.set(t.toRoute, { total: t.duration, count: 1, max: t.duration });
      }
    }

    return Array.from(map.entries())
      .map(([route, data]) => ({
        route,
        avgMountTime: Math.round(data.total / data.count),
        visits: data.count,
        slowest: data.max,
      }))
      .sort((a, b) => b.avgMountTime - a.avgMountTime);
  }

  get count(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer = [];
    this.lastRoute = null;
    this.lastTransitionTime = 0;
  }
}
