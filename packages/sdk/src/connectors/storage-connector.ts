import type { SDKMessage, StorageBackend } from '@mcp-rn-devtools/shared';
import type { WSClient } from '../bridge/ws-client.js';
import { uuid } from '../utils/uuid.js';

export interface AsyncStorageLike {
  getAllKeys(): Promise<readonly string[]>;
  getItem(key: string): Promise<string | null>;
  multiGet(keys: readonly string[]): Promise<readonly [string, string | null][]>;
}

export interface MMKVLike {
  getAllKeys(): string[];
  getString(key: string): string | undefined;
}

export function connectAsyncStorage(storage: AsyncStorageLike, client: WSClient): () => void {
  const unsubscribe = client.onMessage(async (msg) => {
    if (msg.type === 'request:storage-keys') {
      const payload = msg.payload as { backend: StorageBackend; requestId: string };
      if (payload.backend !== 'async-storage') return;

      try {
        const keys = await storage.getAllKeys();
        const response: SDKMessage = {
          type: 'storage:keys',
          payload: {
            backend: 'async-storage',
            keys: [...keys],
            requestId: payload.requestId,
          },
          timestamp: Date.now(),
          id: uuid(),
        };
        client.send(response);
      } catch {
        // ignore storage errors
      }
    }

    if (msg.type === 'request:storage-value') {
      const payload = msg.payload as { backend: StorageBackend; key: string; requestId: string };
      if (payload.backend !== 'async-storage') return;

      try {
        const value = await storage.getItem(payload.key);
        const response: SDKMessage = {
          type: 'storage:value',
          payload: {
            backend: 'async-storage',
            entry: { key: payload.key, value, backend: 'async-storage' },
            requestId: payload.requestId,
          },
          timestamp: Date.now(),
          id: uuid(),
        };
        client.send(response);
      } catch {
        // ignore storage errors
      }
    }
  });

  return unsubscribe;
}

export function connectMMKV(mmkv: MMKVLike, client: WSClient): () => void {
  const unsubscribe = client.onMessage((msg) => {
    if (msg.type === 'request:storage-keys') {
      const payload = msg.payload as { backend: StorageBackend; requestId: string };
      if (payload.backend !== 'mmkv') return;

      try {
        const keys = mmkv.getAllKeys();
        const response: SDKMessage = {
          type: 'storage:keys',
          payload: {
            backend: 'mmkv',
            keys: [...keys],
            requestId: payload.requestId,
          },
          timestamp: Date.now(),
          id: uuid(),
        };
        client.send(response);
      } catch {
        // ignore storage errors
      }
    }

    if (msg.type === 'request:storage-value') {
      const payload = msg.payload as { backend: StorageBackend; key: string; requestId: string };
      if (payload.backend !== 'mmkv') return;

      try {
        const value = mmkv.getString(payload.key) ?? null;
        const response: SDKMessage = {
          type: 'storage:value',
          payload: {
            backend: 'mmkv',
            entry: { key: payload.key, value, backend: 'mmkv' },
            requestId: payload.requestId,
          },
          timestamp: Date.now(),
          id: uuid(),
        };
        client.send(response);
      } catch {
        // ignore storage errors
      }
    }
  });

  return unsubscribe;
}
