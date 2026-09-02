import type { ToolRegistrar } from './registrar.js';
import type { ConnectionManager } from '../managers/connection-manager.js';
import type { SDKBridgeServer } from '../sdk-bridge/sdk-server.js';

export function registerGetNavigationState(
  server: ToolRegistrar,
  cm: ConnectionManager,
  sdkBridge: SDKBridgeServer,
): void {
  server.tool(
    'get_navigation_state',
    'Get the current navigation state (React Navigation). Zero-config: the runtime agent discovers the navigation container automatically; the SDK channel is used when available.',
    {},
    { readOnlyHint: true },
    async () => {
      // SDK channel first (richer, event-driven)
      if (cm.sdkConnected) {
        const state = await sdkBridge.getNavigationState();
        if (state) {
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

          return { content: [{ type: 'text', text: lines.join('\n') }] };
        }
      }

      // Zero-config agent fallback
      if (cm.connected) {
        const nav = await cm.agentBridge.getNavigation(cm.cdp).catch(() => null);
        if (nav?.found) {
          const lines = [
            `Current Route: ${JSON.stringify(nav.currentRoute, null, 2)}`,
            '',
            `Navigation State:`,
            JSON.stringify(nav.state, null, 2),
          ];
          return { content: [{ type: 'text', text: lines.join('\n') }] };
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: 'No navigation container found. Make sure the app uses React Navigation and has rendered, or install mcp-rn-devtools-sdk with a navigationRef for richer data.',
          },
        ],
      };
    },
  );
}
