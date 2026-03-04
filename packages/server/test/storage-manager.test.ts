import { describe, it, expect, beforeEach } from 'vitest';
import { StorageManager } from '../src/managers/storage-manager.js';

describe('StorageManager', () => {
  let manager: StorageManager;

  beforeEach(() => {
    manager = new StorageManager();
  });

  describe('SDK response handling', () => {
    it('should resolve keys when response arrives', async () => {
      const requestId = 'test-keys-1';
      const promise = manager.waitForKeys(requestId);

      manager.handleKeysResponse('async-storage', ['key1', 'key2'], requestId);

      const keys = await promise;
      expect(keys).toEqual(['key1', 'key2']);
    });

    it('should resolve value when response arrives', async () => {
      const requestId = 'test-value-1';
      const promise = manager.waitForValue(requestId);

      manager.handleValueResponse(
        { key: 'mykey', value: 'myvalue', backend: 'async-storage' },
        requestId,
      );

      const entry = await promise;
      expect(entry).toEqual({
        key: 'mykey',
        value: 'myvalue',
        backend: 'async-storage',
      });
    });

    it('should timeout if no response', async () => {
      const requestId = 'test-timeout';
      const keys = await manager.waitForKeys(requestId, 100);
      expect(keys).toBeNull();
    });

    it('should timeout value if no response', async () => {
      const requestId = 'test-timeout-value';
      const entry = await manager.waitForValue(requestId, 100);
      expect(entry).toBeNull();
    });

    it('should ignore responses for unknown request IDs', () => {
      // Should not throw
      manager.handleKeysResponse('async-storage', ['key1'], 'unknown-id');
      manager.handleValueResponse(
        { key: 'k', value: 'v', backend: 'mmkv' },
        'unknown-id',
      );
    });
  });
});
