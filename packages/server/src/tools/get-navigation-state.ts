import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';
import type { SDKBridgeServer } from '../sdk-bridge/sdk-server.js';

export function registerGetNavigationState(
  server: McpServer,
  cm: ConnectionManager,
  sdkBridge: SDKBridgeServer,
): void {
  server.tool(
    'get_navigation_state',
    'Get the current navigation state from the React Native app (requires mcp-rn-devtools-sdk with a navigationRef).',
    {},
    async () => {
      if (!cm.sdkConnected) {
        return {
          content: [
            {
              type: 'text',
              text: 'SDK not connected. Navigation state requires the mcp-rn-devtools-sdk package installed in your app with a navigationRef configured.',
            },
          ],
        };
      }

      const state = await sdkBridge.getNavigationState();

      if (!state) {
        return {
          content: [
            {
              type: 'text',
              text: 'No navigation state available. Make sure you passed a navigationRef to <RNDevtoolsProvider>.',
            },
          ],
        };
      }

      const lines = [
        `Current Route: ${state.currentRoute.name}`,
        `Route Key: ${state.currentRoute.key}`,
        state.currentRoute.params
          ? `Params: ${JSON.stringify(state.currentRoute.params, null, 2)}`
          : null,
        `Navigator Type: ${state.type}`,
        `Stack Index: ${state.index}`,
        '',
        'Navigation Stack:',
        ...state.stack.map(
          (route, i) =>
            `  ${i === state.index ? '→' : ' '} ${route.name}${route.params ? ` (${JSON.stringify(route.params)})` : ''}`,
        ),
      ].filter(Boolean);

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      };
    },
  );
}
