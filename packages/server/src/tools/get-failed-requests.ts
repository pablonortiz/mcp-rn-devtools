import { z } from 'zod';
import type { ToolRegistrar } from './registrar.js';
import type { ConnectionManager } from '../managers/connection-manager.js';
import { FULL_PARAM_DESCRIPTION, renderEntries } from './entry-format.js';

export function registerGetFailedRequests(server: ToolRegistrar, cm: ConnectionManager): void {
  server.tool(
    'get_failed_requests',
    'Get failed HTTP requests (status >= 400 or network errors) from the running React Native app.',
    {
      limit: z.number().optional().default(50).describe('Max number of entries to return'),
      since: z.number().optional().describe('Only return entries after this timestamp (ms)'),
      full: z.boolean().optional().default(false).describe(FULL_PARAM_DESCRIPTION),
    },
    { readOnlyHint: true },
    async ({ limit, since, full }) => {
      const requests = cm.networkManager.getFailedRequests({ limit, since });

      if (!cm.connected && !cm.sdkConnected && requests.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'Not connected to a React Native app — run health_check for the diagnosis.',
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
          ? `\n  Response: ${full ? r.responseBody : r.responseBody.substring(0, 500)}`
          : '';
        return `${r.method} ${r.url} → ${status} (${duration})${error}${body}`;
      });

      return { content: [{ type: 'text', text: renderEntries('failed request(s)', formatted, full) }] };
    },
  );
}
