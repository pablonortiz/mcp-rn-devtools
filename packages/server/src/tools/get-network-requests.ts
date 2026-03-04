import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';

export function registerGetNetworkRequests(server: McpServer, cm: ConnectionManager): void {
  server.tool(
    'get_network_requests',
    'Get HTTP network requests from the running React Native app. Shows URL, method, status, duration, and headers.',
    {
      limit: z.number().optional().default(50).describe('Max number of entries to return'),
      since: z.number().optional().describe('Only return entries after this timestamp (ms)'),
      search: z.string().optional().describe('Search string to filter by URL'),
    },
    async ({ limit, since, search }) => {
      const requests = cm.networkManager.getRequests({ limit, since, search });

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
          content: [{ type: 'text', text: 'No network requests captured.' }],
        };
      }

      const formatted = requests.map((r) => {
        const status = r.status !== null ? `${r.status}` : 'pending';
        const duration = r.duration ? `${r.duration}ms` : 'ongoing';
        const error = r.error ? ` [${r.error}]` : '';
        return `${r.method} ${r.url} → ${status} (${duration})${error} [${r.source}]`;
      });

      return {
        content: [
          {
            type: 'text',
            text: `${requests.length} network request(s):\n\n${formatted.join('\n')}`,
          },
        ],
      };
    },
  );
}
