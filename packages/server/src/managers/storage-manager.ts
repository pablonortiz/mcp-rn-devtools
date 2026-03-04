import type { StorageBackend, StorageEntry } from '@mcp-rn-devtools/shared';
import type { CDPConnection } from '../cdp/connection.js';
import { logger } from '../utils/logger.js';

type Resolver<T> = (value: T) => void;

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

  // CDP fallback for AsyncStorage keys
  async getKeysCDP(cdp: CDPConnection): Promise<string[] | null> {
    try {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          try {
            var AsyncStorage = require('@react-native-async-storage/async-storage').default;
            var result = { done: false, value: null, error: null };
            AsyncStorage.getAllKeys().then(function(keys) {
              result.done = true;
              result.value = keys;
            }).catch(function(e) {
              result.done = true;
              result.error = e.message;
            });
            global.__RN_DEVTOOLS_STORAGE_KEYS__ = result;
            return 'pending';
          } catch(e) {
            return JSON.stringify({ error: e.message });
          }
        })()`,
        returnByValue: true,
      });

      // Poll for result
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 200));
        const poll = await cdp.send('Runtime.evaluate', {
          expression: `(function() {
            var r = global.__RN_DEVTOOLS_STORAGE_KEYS__;
            if (!r || !r.done) return JSON.stringify({ pending: true });
            delete global.__RN_DEVTOOLS_STORAGE_KEYS__;
            if (r.error) return JSON.stringify({ error: r.error });
            return JSON.stringify({ keys: r.value });
          })()`,
          returnByValue: true,
        });

        const value = poll.result?.value as string | undefined;
        if (!value) continue;

        const parsed = JSON.parse(value);
        if (parsed.pending) continue;
        if (parsed.error) {
          logger.warn('CDP AsyncStorage.getAllKeys failed:', parsed.error);
          return null;
        }
        return parsed.keys as string[];
      }

      return null;
    } catch (e) {
      logger.debug('CDP storage keys fallback failed', e);
      return null;
    }
  }

  // CDP fallback for AsyncStorage value
  async getValueCDP(cdp: CDPConnection, key: string): Promise<string | null> {
    try {
      const safeKey = JSON.stringify(key);
      const result = await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          try {
            var AsyncStorage = require('@react-native-async-storage/async-storage').default;
            var result = { done: false, value: null, error: null };
            AsyncStorage.getItem(${safeKey}).then(function(val) {
              result.done = true;
              result.value = val;
            }).catch(function(e) {
              result.done = true;
              result.error = e.message;
            });
            global.__RN_DEVTOOLS_STORAGE_VALUE__ = result;
            return 'pending';
          } catch(e) {
            return JSON.stringify({ error: e.message });
          }
        })()`,
        returnByValue: true,
      });

      // Poll for result
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 200));
        const poll = await cdp.send('Runtime.evaluate', {
          expression: `(function() {
            var r = global.__RN_DEVTOOLS_STORAGE_VALUE__;
            if (!r || !r.done) return JSON.stringify({ pending: true });
            delete global.__RN_DEVTOOLS_STORAGE_VALUE__;
            if (r.error) return JSON.stringify({ error: r.error });
            return JSON.stringify({ value: r.value });
          })()`,
          returnByValue: true,
        });

        const value = poll.result?.value as string | undefined;
        if (!value) continue;

        const parsed = JSON.parse(value);
        if (parsed.pending) continue;
        if (parsed.error) {
          logger.warn('CDP AsyncStorage.getItem failed:', parsed.error);
          return null;
        }
        return parsed.value as string | null;
      }

      return null;
    } catch (e) {
      logger.debug('CDP storage value fallback failed', e);
      return null;
    }
  }
}
