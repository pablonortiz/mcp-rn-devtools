import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';
import type { SDKBridgeServer } from '../sdk-bridge/sdk-server.js';
import { redactStorageValue } from '../utils/redact.js';

export function registerGetStorageValue(
  server: McpServer,
  cm: ConnectionManager,
  sdkBridge: SDKBridgeServer,
): void {
  server.tool(
    'get_storage_value',
    'Read a value from AsyncStorage or MMKV by key. AsyncStorage works zero-config via the runtime agent; MMKV requires the SDK. Secrets are redacted (opt out with MCP_RN_NO_REDACT=1).',
    {
      key: z.string().describe('The storage key to read'),
      backend: z
        .enum(['async-storage', 'mmkv'])
        .optional()
        .default('async-storage')
        .describe('Storage backend to query'),
    },
    { readOnlyHint: true },
    async ({ key, backend }) => {
      let value: string | null | undefined = undefined;

      if (cm.sdkConnected) {
        const entry = await sdkBridge.getStorageValue(backend, key);
        if (entry) value = entry.value;
      }

      // Zero-config agent fallback (AsyncStorage via native module proxy)
      if (value === undefined && backend === 'async-storage' && cm.connected) {
        const result = await cm.agentBridge.storageOp(cm.cdp, 'get', key);
        if (result.ok !== undefined && result.error === null) {
          value = (result.value as string | null) ?? null;
        }
      }

      if (value === undefined) {
        const hint = backend === 'mmkv'
          ? 'MMKV requires SDK connection. Install mcp-rn-devtools-sdk and pass mmkv prop to <RNDevtoolsProvider>.'
          : 'Not connected. Make sure Metro is running and the app is active.';

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

      let formatted = redactStorageValue(key, value) ?? '';
      try {
        const parsed = JSON.parse(formatted);
        formatted = JSON.stringify(parsed, null, 2);
      } catch {
        // not JSON, use as-is
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
