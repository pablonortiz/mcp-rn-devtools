import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';

export function registerDispatchAction(server: McpServer, cm: ConnectionManager): void {
  server.tool(
    'dispatch_action',
    'Dispatch a Redux action to a store discovered by the runtime agent. Useful to reproduce states or trigger flows while debugging.',
    {
      type: z.string().describe('Action type (e.g. "auth/logout")'),
      payload: z.unknown().optional().describe('Action payload (any JSON value)'),
      store: z.string().optional().describe('Store name (omit to use the first/only store)'),
    },
    async ({ type, payload, store }) => {
      if (!cm.connected) {
        return {
          content: [
            {
              type: 'text',
              text: 'Not connected to a React Native app. Make sure Metro is running and the app is active.',
            },
          ],
        };
      }

      const action: { type: string; payload?: unknown } = { type };
      if (payload !== undefined) action.payload = payload;

      const result: { ok: boolean; store?: string; stores?: string[]; error?: string } | null =
        await cm.agentBridge.dispatch(cm.cdp, store, action).catch((e: Error) => ({
          ok: false,
          error: e.message,
        }));

      if (!result || !result.ok) {
        const stores = (result as { stores?: string[] } | null)?.stores ?? [];
        const detail = (result as { error?: string } | null)?.error;
        const storeHint = stores.length > 0 ? ` Available stores: ${stores.join(', ')}.` : '';
        return {
          content: [
            {
              type: 'text',
              text: `Dispatch failed${detail ? `: ${detail}` : ''}.${storeHint}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Dispatched "${type}" to store "${result.store}". Use get_state_diff or get_app_state to inspect the effect.`,
          },
        ],
      };
    },
  );
}
