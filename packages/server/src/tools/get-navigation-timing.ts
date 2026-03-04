import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';

export function registerGetNavigationTiming(server: McpServer, cm: ConnectionManager): void {
  server.tool(
    'get_navigation_timing',
    'Get navigation transition timing data — how long each screen transition takes. Requires mcp-rn-devtools-sdk with navigationRef.',
    {
      route: z.string().optional().describe('Filter transitions involving this route name'),
      limit: z.number().optional().default(50).describe('Max transitions to return'),
      since: z.number().optional().describe('Only return transitions after this timestamp (ms)'),
      slow_threshold: z.number().optional().describe('Only show transitions slower than this (ms)'),
      summary: z.boolean().optional().default(false).describe('Return per-route aggregate summary'),
    },
    async ({ route, limit, since, slow_threshold, summary }) => {
      if (!cm.sdkConnected) {
        return {
          content: [
            {
              type: 'text',
              text: 'SDK not connected. Navigation timing requires mcp-rn-devtools-sdk with navigationRef configured.',
            },
          ],
        };
      }

      if (summary) {
        const stats = cm.navigationTimingManager.getSummary();

        if (stats.length === 0) {
          return {
            content: [{ type: 'text', text: 'No navigation transitions recorded yet. Navigate between screens in the app.' }],
          };
        }

        const lines = [
          'Navigation Timing Summary (sorted by avg mount time):',
          '',
          ...stats.map((s, i) =>
            `  ${i + 1}. ${s.route} — avg ${s.avgMountTime}ms, ${s.visits} visit(s), slowest ${s.slowest}ms`,
          ),
        ];

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      const transitions = cm.navigationTimingManager.getTransitions({
        route,
        limit,
        since,
        slow_threshold,
      });

      if (transitions.length === 0) {
        return {
          content: [{ type: 'text', text: 'No navigation transitions found matching the criteria.' }],
        };
      }

      const formatted = transitions.map((t) => {
        const time = new Date(t.timestamp).toISOString();
        return `[${time}] ${t.fromRoute} → ${t.toRoute}: ${t.duration}ms`;
      });

      return {
        content: [
          {
            type: 'text',
            text: `${transitions.length} transition(s):\n\n${formatted.join('\n')}`,
          },
        ],
      };
    },
  );
}
