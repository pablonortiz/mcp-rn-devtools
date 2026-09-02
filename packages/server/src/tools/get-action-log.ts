import { z } from 'zod';
import type { ToolRegistrar } from './registrar.js';
import type { ConnectionManager } from '../managers/connection-manager.js';
import { redact } from '../utils/redact.js';
import { joinWithinBudget } from '../utils/text.js';
import { OUTPUT_CHARS } from './entry-format.js';

export function registerGetActionLog(server: ToolRegistrar, cm: ConnectionManager): void {
  server.tool(
    'get_action_log',
    'Get Redux action dispatch log. Shows action types, reducer duration, and which state slices changed. Zero-config: the runtime agent records dispatches automatically once a store is discovered.',
    {
      action_type: z.string().optional().describe('Filter by action type (partial match)'),
      store_name: z.string().optional().describe('Filter by store name'),
      search: z.string().optional().describe('Search in action types and changed keys'),
      limit: z.number().optional().default(50).describe('Max entries to return'),
      since: z.number().optional().describe('Only return entries after this timestamp (ms)'),
      summary: z.boolean().optional().default(false).describe('Return per-action-type aggregate summary'),
    },
    { readOnlyHint: true },
    async ({ action_type, store_name, search, limit, since, summary }) => {
      if (!cm.sdkConnected && !cm.connected) {
        return {
          content: [
            {
              type: 'text',
              text: 'Not connected to a React Native app. Make sure Metro is running and the app is active.',
            },
          ],
        };
      }

      // Pull actions recorded by the runtime agent into the shared buffer
      if (cm.connected) {
        const drained = await cm.agentBridge.drainActions(cm.cdp).catch(() => []);
        for (const entry of drained) {
          cm.actionManager.add({ ...entry, payload: redact(entry.payload) });
        }
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
          content: [{ type: 'text', text: 'No actions found matching the criteria. Interact with the app (or dispatch something) and try again.' }],
        };
      }

      const formatted = actions.map((a) => {
        const time = new Date(a.timestamp).toISOString();
        const changed = a.changedKeys.length > 0 ? ` → changed: [${a.changedKeys.join(', ')}]` : '';
        return `[${time}] ${a.actionType} (${a.duration}ms)${changed}`;
      });

      const { text, omitted } = joinWithinBudget(formatted, OUTPUT_CHARS, '\n');
      const note = omitted > 0 ? ` (showing the newest ${actions.length - omitted}; narrow with search/since/limit)` : '';
      return { content: [{ type: 'text', text: `${actions.length} action(s)${note}:\n\n${text}` }] };
    },
  );
}
