import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';
import type { SDKBridgeServer } from '../sdk-bridge/sdk-server.js';

export function registerGetAppState(
  server: McpServer,
  cm: ConnectionManager,
  sdkBridge: SDKBridgeServer,
): void {
  server.tool(
    'get_app_state',
    'Get application state from Redux/Zustand stores. Requires mcp-rn-devtools-sdk with stateManagers configured.',
    {
      name: z.string().optional().describe('Store name to query (omit to list all stores)'),
      path: z.string().optional().describe('Dot-separated path into the state (e.g. "auth.user.name")'),
    },
    async ({ name, path }) => {
      if (!cm.sdkConnected) {
        return {
          content: [
            {
              type: 'text',
              text: 'SDK not connected. State inspection requires the mcp-rn-devtools-sdk package with stateManagers configured.',
            },
          ],
        };
      }

      // Request fresh state from SDK
      await sdkBridge.requestAppState(name);
      // Small delay for the SDK to respond
      await new Promise((resolve) => setTimeout(resolve, 200));

      const result = cm.stateManager.getState(name, path);

      if (!result.found) {
        const storeList = result.stores.length > 0
          ? `Available stores: ${result.stores.join(', ')}`
          : 'No stores registered.';

        return {
          content: [
            {
              type: 'text',
              text: name
                ? `Store "${name}" not found. ${storeList}`
                : `No state data available. ${storeList}`,
            },
          ],
        };
      }

      const formatted = typeof result.data === 'string'
        ? result.data
        : JSON.stringify(result.data, null, 2);

      const header = name
        ? `State for "${name}"${path ? ` at path "${path}"` : ''}:`
        : 'All stores:';

      const truncNote = result.truncated ? '\n\n(Output truncated at 50KB)' : '';

      return {
        content: [
          {
            type: 'text',
            text: `${header}\n\n${formatted}${truncNote}`,
          },
        ],
      };
    },
  );
}
