import type { StateSnapshot } from '@mcp-rn-devtools/shared';
import { STATE_BUFFER_SIZE } from '@mcp-rn-devtools/shared';
import { pruneValue } from '../utils/prune.js';

export class StateManager {
  private latest = new Map<string, StateSnapshot>();
  private history: StateSnapshot[] = [];
  private snapshotResolvers = new Map<string, (snapshot: StateSnapshot) => void>();
  private diffBaselines = new Map<string, StateSnapshot>();

  addSnapshot(snapshot: StateSnapshot, requestId?: string): void {
    this.latest.set(snapshot.name, snapshot);
    this.history.push(snapshot);
    if (this.history.length > STATE_BUFFER_SIZE) {
      this.history.shift();
    }

    if (requestId) {
      const resolver = this.snapshotResolvers.get(requestId);
      if (resolver) {
        this.snapshotResolvers.delete(requestId);
        resolver(snapshot);
      }
    }
  }

  /** Resolves when a snapshot tagged with this requestId arrives (null on timeout). */
  waitForSnapshot(requestId: string, timeoutMs: number = 3000): Promise<StateSnapshot | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.snapshotResolvers.delete(requestId);
        resolve(null);
      }, timeoutMs);

      this.snapshotResolvers.set(requestId, (snapshot) => {
        clearTimeout(timer);
        resolve(snapshot);
      });
    });
  }

  getState(name?: string, path?: string, depth: number = 4): {
    found: boolean;
    stores: string[];
    data: unknown;
  } {
    const stores = Array.from(this.latest.keys());

    if (name) {
      const snapshot = this.latest.get(name);
      if (!snapshot) {
        return { found: false, stores, data: null };
      }
      const data = path ? this.resolvePath(snapshot.state, path) : snapshot.state;
      return { found: true, stores, data: pruneValue(data, depth) };
    }

    if (stores.length === 0) {
      return { found: false, stores, data: null };
    }

    const allStates: Record<string, unknown> = {};
    for (const [storeName, snapshot] of this.latest) {
      allStates[storeName] = snapshot.state;
    }
    return { found: true, stores, data: pruneValue(allStates, depth) };
  }

  getStoreNames(): string[] {
    return Array.from(this.latest.keys());
  }

  setDiffBaseline(name: string, state: unknown): void {
    this.diffBaselines.set(name, { name, state, timestamp: Date.now() });
  }

  getDiffBaseline(name: string): StateSnapshot | undefined {
    return this.diffBaselines.get(name);
  }

  clear(): void {
    this.latest.clear();
    this.history = [];
    this.diffBaselines.clear();
  }

  private resolvePath(obj: unknown, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }
}
