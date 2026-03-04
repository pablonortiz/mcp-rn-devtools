import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';

export function registerGetActionLog(server: McpServer, cm: ConnectionManager): void {
  server.tool(
    'get_action_log',
    'Get Redux action dispatch log. Shows action types, reducer duration, and which state slices changed. Requires mcp-rn-devtools-sdk with createDevtoolsMiddleware.',
    {
      action_type: z.string().optional().describe('Filter by action type (partial match)'),
      store_name: z.string().optional().describe('Filter by store name'),
      search: z.string().optional().describe('Search in action types and changed keys'),
      limit: z.number().optional().default(50).describe('Max entries to return'),
      since: z.number().optional().describe('Only return entries after this timestamp (ms)'),
      summary: z.boolean().optional().default(false).describe('Return per-action-type aggregate summary'),
    },
    async ({ action_type, store_name, search, limit, since, summary }) => {
      if (!cm.sdkConnected) {
        return {
          content: [
            {
              type: 'text',
              text: 'SDK not connected. Redux action logging requires mcp-rn-devtools-sdk with createDevtoolsMiddleware added to your Redux store.',
            },
          ],
        };
      }

      if (summary) {
        const stats = cm.actionManager.getSummary();

        if (stats.length === 0) {
          return {
            content: [{ type: 'text', text: 'No actions recorded yet. Dispatch some Redux actions in the app.' }],
          };
        }

        const lines = [
          `Redux Action Summary (${cm.actionManager.count} total actions):`,
          '',
          ...stats.map((s, i) =>
            `  ${i + 1}. ${s.actionType} — ${s.count}x, avg ${s.avgDuration}ms, total ${s.totalDuration}ms`,
          ),
        ];

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      const actions = cm.actionManager.getActions({
        actionType: action_type,
        storeName: store_name,
        search,
        limit,
        since,
      });

      if (actions.length === 0) {
        return {
          content: [{ type: 'text', text: 'No actions found matching the criteria.' }],
        };
      }

      const formatted = actions.map((a) => {
        const time = new Date(a.timestamp).toISOString();
        const changed = a.changedKeys.length > 0 ? ` → changed: [${a.changedKeys.join(', ')}]` : '';
        return `[${time}] ${a.actionType} (${a.duration}ms)${changed}`;
      });

      return {
        content: [
          {
            type: 'text',
            text: `${actions.length} action(s):\n\n${formatted.join('\n')}`,
          },
        ],
      };
    },
  );
}
