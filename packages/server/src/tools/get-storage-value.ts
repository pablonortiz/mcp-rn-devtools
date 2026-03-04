import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';
import type { SDKBridgeServer } from '../sdk-bridge/sdk-server.js';

export function registerGetStorageValue(
  server: McpServer,
  cm: ConnectionManager,
  sdkBridge: SDKBridgeServer,
): void {
  server.tool(
    'get_storage_value',
    'Read a value from AsyncStorage or MMKV by key. Works via SDK (preferred) or CDP fallback for AsyncStorage.',
    {
      key: z.string().describe('The storage key to read'),
      backend: z
        .enum(['async-storage', 'mmkv'])
        .optional()
        .default('async-storage')
        .describe('Storage backend to query'),
    },
    async ({ key, backend }) => {
      let value: string | null | undefined = undefined;

      if (cm.sdkConnected) {
        const entry = await sdkBridge.getStorageValue(backend, key);
        if (entry) value = entry.value;
      }

      // CDP fallback for AsyncStorage
      if (value === undefined && backend === 'async-storage' && cm.connected) {
        value = await cm.storageManager.getValueCDP(cm.cdp, key);
      }

      if (value === undefined) {
        const hint = backend === 'mmkv'
          ? 'MMKV requires SDK connection. Install mcp-rn-devtools-sdk and pass mmkv prop to <RNDevtoolsProvider>.'
          : 'Not connected. Ensure Metro is running or install mcp-rn-devtools-sdk with asyncStorage prop.';

        return {
          content: [{ type: 'text', text: `Could not read storage value. ${hint}` }],
        };
      }

      if (value === null) {
        return {
          content: [
            { type: 'text', text: `Key "${key}" not found in ${backend}.` },
          ],
        };
      }

      // Try to pretty-print JSON values
      let formatted = value;
      try {
        const parsed = JSON.parse(value);
        formatted = JSON.stringify(parsed, null, 2);
      } catch {
        // not JSON, use raw value
      }

      return {
        content: [
          {
            type: 'text',
            text: `${backend} ["${key}"]:\n\n${formatted}`,
          },
        ],
      };
    },
  );
}
