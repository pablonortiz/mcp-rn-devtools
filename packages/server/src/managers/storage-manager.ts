import type { StorageBackend, StorageEntry } from '@mcp-rn-devtools/shared';

type Resolver<T> = (value: T) => void;

/**
 * Correlates SDK storage responses with pending requests.
 * The zero-config AsyncStorage path lives in AgentBridge (native module proxy);
 * this manager only handles the SDK channel.
 */
export class StorageManager {
  private keyResolvers = new Map<string, Resolver<string[]>>();
  private valueResolvers = new Map<string, Resolver<StorageEntry>>();

  // Called when SDK sends storage:keys response
  handleKeysResponse(backend: StorageBackend, keys: string[], requestId: string): void {
    const resolver = this.keyResolvers.get(requestId);
    if (resolver) {
      this.keyResolvers.delete(requestId);
      resolver(keys);
    }
  }

  // Called when SDK sends storage:value response
  handleValueResponse(entry: StorageEntry, requestId: string): void {
    const resolver = this.valueResolvers.get(requestId);
    if (resolver) {
      this.valueResolvers.delete(requestId);
      resolver(entry);
    }
  }

  // Wait for SDK response for keys
  waitForKeys(requestId: string, timeoutMs: number = 3000): Promise<string[] | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.keyResolvers.delete(requestId);
        resolve(null);
      }, timeoutMs);

      this.keyResolvers.set(requestId, (keys) => {
        clearTimeout(timer);
        resolve(keys);
      });
    });
  }

  // Wait for SDK response for a value
  waitForValue(requestId: string, timeoutMs: number = 3000): Promise<StorageEntry | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.valueResolvers.delete(requestId);
        resolve(null);
      }, timeoutMs);

      this.valueResolvers.set(requestId, (entry) => {
        clearTimeout(timer);
        resolve(entry);
      });
    });
  }
}
