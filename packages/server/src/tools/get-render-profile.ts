import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';

export function registerGetRenderProfile(server: McpServer, cm: ConnectionManager): void {
  server.tool(
    'get_render_profile',
    'Get component render profile data. Requires mcp-rn-devtools-sdk with Profiler wrapping components.',
    {
      component: z.string().optional().describe('Filter by component name'),
      slow_only: z.boolean().optional().default(false).describe('Only show slow renders'),
      threshold: z.number().optional().default(16).describe('Slow render threshold in ms (default 16)'),
      limit: z.number().optional().default(50).describe('Max entries to return'),
      since: z.number().optional().describe('Only return entries after this timestamp (ms)'),
      summary: z.boolean().optional().default(false).describe('Return per-component aggregate summary'),
    },
    async ({ component, slow_only, threshold, limit, since, summary }) => {
      if (!cm.sdkConnected) {
        return {
          content: [
            {
              type: 'text',
              text: 'SDK not connected. Render profiling requires the mcp-rn-devtools-sdk package with Profiler components wrapping your app.',
            },
          ],
        };
      }

      if (summary) {
        const stats = cm.renderManager.getSummary({ component, since });

        if (stats.length === 0) {
          return {
            content: [{ type: 'text', text: 'No render data recorded yet. Interact with the app to generate render events.' }],
          };
        }

        const lines = [
          'Render Profile Summary (sorted by total duration):',
          '',
          ...stats.map((s, i) =>
            `  ${i + 1}. ${s.component} — ${s.renderCount} renders, avg ${s.avgDuration}ms, total ${s.totalDuration}ms${s.slowRenders > 0 ? ` (${s.slowRenders} slow)` : ''}`,
          ),
        ];

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      const renders = cm.renderManager.getRenders({
        component,
        slowOnly: slow_only,
        threshold,
        limit,
        since,
      });

      if (renders.length === 0) {
        return {
          content: [{ type: 'text', text: 'No render events found matching the criteria.' }],
        };
      }

      const formatted = renders.map((r) => {
        const time = new Date(r.timestamp).toISOString();
        return `[${time}] ${r.component} (${r.phase}) actual: ${r.actualDuration.toFixed(1)}ms base: ${r.baseDuration.toFixed(1)}ms`;
      });

      return {
        content: [
          {
            type: 'text',
            text: `${renders.length} render event(s):\n\n${formatted.join('\n')}`,
          },
        ],
      };
    },
  );
}
