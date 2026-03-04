import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';

export function registerGetFailedRequests(server: McpServer, cm: ConnectionManager): void {
  server.tool(
    'get_failed_requests',
    'Get failed HTTP requests (status >= 400 or network errors) from the running React Native app.',
    {
      limit: z.number().optional().default(50).describe('Max number of entries to return'),
      since: z.number().optional().describe('Only return entries after this timestamp (ms)'),
    },
    async ({ limit, since }) => {
      const requests = cm.networkManager.getFailedRequests({ limit, since });

      if (!cm.connected && !cm.sdkConnected && requests.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'Not connected to a React Native app. Make sure Metro is running and a Hermes-powered app is active.',
            },
          ],
        };
      }

      if (requests.length === 0) {
        return {
          content: [{ type: 'text', text: 'No failed network requests found.' }],
        };
      }

      const formatted = requests.map((r) => {
        const status = r.status !== null ? `${r.status}` : 'no status';
        const duration = r.duration ? `${r.duration}ms` : 'unknown';
        const error = r.error ? `\n  Error: ${r.error}` : '';
        const body = r.responseBody
          ? `\n  Response: ${r.responseBody.substring(0, 500)}`
          : '';
        return `${r.method} ${r.url} → ${status} (${duration})${error}${body}`;
      });

      return {
        content: [
          {
            type: 'text',
            text: `${requests.length} failed request(s):\n\n${formatted.join('\n\n')}`,
          },
        ],
      };
    },
  );
}
