import type { StateSnapshot } from '@mcp-rn-devtools/shared';
import { STATE_BUFFER_SIZE } from '@mcp-rn-devtools/shared';

export class StateManager {
  private latest = new Map<string, StateSnapshot>();
  private history: StateSnapshot[] = [];

  addSnapshot(snapshot: StateSnapshot): void {
    this.latest.set(snapshot.name, snapshot);
    this.history.push(snapshot);
    if (this.history.length > STATE_BUFFER_SIZE) {
      this.history.shift();
    }
  }

  getState(name?: string, path?: string): {
    found: boolean;
    stores: string[];
    data: unknown;
    truncated: boolean;
  } {
    if (name) {
      const snapshot = this.latest.get(name);
      if (!snapshot) {
        return {
          found: false,
          stores: Array.from(this.latest.keys()),
          data: null,
          truncated: false,
        };
      }

      const data = path ? this.resolvePath(snapshot.state, path) : snapshot.state;
      return this.formatResult(data);
    }

    // Return all stores
    const allStates: Record<string, unknown> = {};
    for (const [storeName, snapshot] of this.latest) {
      allStates[storeName] = snapshot.state;
    }
    return this.formatResult(allStates);
  }

  getStoreNames(): string[] {
    return Array.from(this.latest.keys());
  }

  clear(): void {
    this.latest.clear();
    this.history = [];
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

  private formatResult(data: unknown): {
    found: boolean;
    stores: string[];
    data: unknown;
    truncated: boolean;
  } {
    const MAX_SIZE = 50 * 1024; // 50KB
    let serialized: string;
    let truncated = false;

    try {
      serialized = JSON.stringify(data, null, 2);
      if (serialized.length > MAX_SIZE) {
        // Truncate and re-serialize at top level
        serialized = serialized.substring(0, MAX_SIZE);
        truncated = true;
      }
    } catch {
      serialized = String(data);
    }

    return {
      found: true,
      stores: Array.from(this.latest.keys()),
      data: truncated ? serialized : data,
      truncated,
    };
  }
}
