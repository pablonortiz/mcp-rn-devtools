import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';

export function registerGetWarnings(server: McpServer, cm: ConnectionManager): void {
  server.tool(
    'get_warnings',
    'Get LogBox warnings from the running React Native app. These are captured via console.warn.',
    {
      limit: z.number().optional().default(50).describe('Max number of entries to return'),
      since: z.number().optional().describe('Only return entries after this timestamp (ms)'),
      search: z.string().optional().describe('Search string to filter warning messages'),
    },
    async ({ limit, since, search }) => {
      const warnings = cm.errorManager.getWarnings({ limit, since, search });

      if (!cm.connected && warnings.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'Not connected to a React Native app. Make sure Metro is running and a Hermes-powered app is active.',
            },
          ],
        };
      }

      if (warnings.length === 0) {
        return {
          content: [{ type: 'text', text: 'No warnings found.' }],
        };
      }

      const formatted = warnings.map((w) => {
        const time = new Date(w.timestamp).toISOString();
        const stack = w.stack?.length
          ? `\n  at ${w.stack.map((f) => `${f.functionName || '<anonymous>'} (${f.url}:${f.lineNumber}:${f.columnNumber})`).join('\n  at ')}`
          : '';
        return `[${time}] ${w.message}${stack}`;
      });

      return {
        content: [
          {
            type: 'text',
            text: `${warnings.length} warning(s):\n\n${formatted.join('\n\n')}`,
          },
        ],
      };
    },
  );
}
