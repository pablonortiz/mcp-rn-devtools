import { z } from 'zod';
import type { ToolRegistrar } from './registrar.js';
import type { ConnectionManager } from '../managers/connection-manager.js';
import type { SDKBridgeServer } from '../sdk-bridge/sdk-server.js';
import { redact } from '../utils/redact.js';

export function registerGetAppState(
  server: ToolRegistrar,
  cm: ConnectionManager,
  sdkBridge: SDKBridgeServer,
): void {
  server.tool(
    'get_app_state',
    'Get application state from Redux/Zustand stores. Zero-config: discovers Redux stores automatically via the injected runtime agent. The optional SDK adds Zustand and custom stores.',
    {
      name: z.string().optional().describe('Store name to query (omit to use the first/only store)'),
      path: z.string().optional().describe('Dot-separated path into the state (e.g. "auth.user.name")'),
      depth: z.number().min(1).max(8).optional().default(4)
        .describe('Levels of nesting to expand — deeper levels are summarized'),
    },
    { readOnlyHint: true },
    async ({ name, path, depth }) => {
      // SDK channel first: covers Zustand and explicitly registered stores
      if (cm.sdkConnected) {
        const snapshot = await sdkBridge.getAppState(name);
        if (snapshot) {
          const result = cm.stateManager.getState(name, path, depth);
          if (result.found) {
            return formatState(result.data, result.stores, name, path, 'sdk');
          }
        }
      }

      // Zero-config channel: runtime agent discovers stores by fiber-walking
      if (cm.connected) {
        const result = await cm.agentBridge.getState(cm.cdp, name, path, depth).catch(() => null);

        if (result?.found && !result.missing) {
          cm.stateManager.addSnapshot({
            name: result.store ?? 'redux',
            state: result.data,
            timestamp: Date.now(),
          });
          return formatState(result.data, result.stores, result.store, path, 'agent');
        }

        if (result?.missing) {
          return text(`Path "${path}" not found in store "${result.store}".`);
        }

        const stores = result?.stores ?? [];
        if (name && stores.length > 0) {
          return text(`Store "${name}" not found. Available stores: ${stores.join(', ')}`);
        }
        return text(
          'No Redux store discovered in the app. If the app uses Zustand or a custom store, ' +
            'install mcp-rn-devtools-sdk and pass it via the stateManagers prop.',
        );
      }

      return text(
        'Not connected to a React Native app. Make sure Metro is running and the app is active.',
      );
    },
  );
}

function formatState(
  data: unknown,
  stores: string[],
  name?: string,
  path?: string | null,
  source?: string,
) {
  const header = name
    ? `State for "${name}"${path ? ` at path "${path}"` : ''} [${source}]:`
    : `All stores (${stores.join(', ')}) [${source}]:`;
  const formatted = JSON.stringify(redact(data), null, 2);
  return text(`${header}\n\n${formatted}`);
}

function text(message: string) {
  return { content: [{ type: 'text' as const, text: message }] };
}
