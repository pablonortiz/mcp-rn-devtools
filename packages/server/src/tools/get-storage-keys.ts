import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';
import type { SDKBridgeServer } from '../sdk-bridge/sdk-server.js';

export function registerGetStorageKeys(
  server: McpServer,
  cm: ConnectionManager,
  sdkBridge: SDKBridgeServer,
): void {
  server.tool(
    'get_storage_keys',
    'List storage keys from AsyncStorage or MMKV. Works via SDK (preferred) or CDP fallback for AsyncStorage.',
    {
      backend: z
        .enum(['async-storage', 'mmkv'])
        .optional()
        .default('async-storage')
        .describe('Storage backend to query'),
      search: z.string().optional().describe('Filter keys containing this string'),
      limit: z.number().optional().default(100).describe('Max number of keys to return'),
    },
    async ({ backend, search, limit }) => {
      let keys: string[] | null = null;

      if (cm.sdkConnected) {
        keys = await sdkBridge.getStorageKeys(backend);
      }

      // CDP fallback for AsyncStorage
      if (!keys && backend === 'async-storage' && cm.connected) {
        keys = await cm.storageManager.getKeysCDP(cm.cdp);
      }

      if (!keys) {
        const hint = backend === 'mmkv'
          ? 'MMKV requires SDK connection. Install mcp-rn-devtools-sdk and pass mmkv prop to <RNDevtoolsProvider>.'
          : 'Not connected. Ensure Metro is running or install mcp-rn-devtools-sdk with asyncStorage prop.';

        return {
          content: [{ type: 'text', text: `Could not retrieve storage keys. ${hint}` }],
        };
      }

      // Apply search filter
      if (search) {
        const s = search.toLowerCase();
        keys = keys.filter((k) => k.toLowerCase().includes(s));
      }

      // Apply limit
      const total = keys.length;
      if (keys.length > limit) {
        keys = keys.slice(0, limit);
      }

      if (keys.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: search
                ? `No ${backend} keys found matching "${search}".`
                : `No ${backend} keys found.`,
            },
          ],
        };
      }

      const lines = [
        `${backend} keys (${keys.length}${total > limit ? ` of ${total}` : ''}):`,
        '',
        ...keys.map((k) => `  - ${k}`),
      ];

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
}
