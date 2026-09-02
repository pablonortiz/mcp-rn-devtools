import { z } from 'zod';
import type { ToolRegistrar } from './registrar.js';
import type { ConnectionManager } from '../managers/connection-manager.js';
import { redactHeaders, redactText } from '../utils/redact.js';
import { FULL_PARAM_DESCRIPTION, renderEntries } from './entry-format.js';

export function registerGetNetworkRequests(server: ToolRegistrar, cm: ConnectionManager): void {
  server.tool(
    'get_network_requests',
    'Get HTTP network requests from the running React Native app. Shows URL, method, status and duration; verbose mode adds headers and truncated bodies (secrets redacted).',
    {
      limit: z.number().optional().default(50).describe('Max number of entries to return'),
      since: z.number().optional().describe('Only return entries after this timestamp (ms)'),
      search: z.string().optional().describe('Search string to filter by URL'),
      verbose: z.boolean().optional().default(false)
        .describe('Include request/response headers and truncated bodies'),
      full: z.boolean().optional().default(false).describe(FULL_PARAM_DESCRIPTION),
    },
    { readOnlyHint: true },
    async ({ limit, since, search, verbose, full }) => {
      const requests = cm.networkManager.getRequests({ limit, since, search });

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
          content: [{ type: 'text', text: 'No network requests captured.' }],
        };
      }

      const formatted = requests.map((r) => {
        const status = r.status !== null ? `${r.status}` : 'pending';
        const duration = r.duration ? `${r.duration}ms` : 'ongoing';
        const error = r.error ? ` [${r.error}]` : '';
        const summary = `${r.method} ${r.url} → ${status} (${duration})${error} [${r.source}]`;
        if (!verbose) return summary;

        const detail: string[] = [summary];
        const reqHeaders = redactHeaders(r.requestHeaders);
        const resHeaders = redactHeaders(r.responseHeaders);
        if (reqHeaders && Object.keys(reqHeaders).length > 0) {
          detail.push(`  request headers: ${JSON.stringify(reqHeaders)}`);
        }
        if (r.requestBody) {
          detail.push(`  request body: ${redactText(r.requestBody.slice(0, 500))}`);
        }
        if (resHeaders && Object.keys(resHeaders).length > 0) {
          detail.push(`  response headers: ${JSON.stringify(resHeaders)}`);
        }
        if (r.responseBody) {
          detail.push(`  response body: ${redactText(r.responseBody.slice(0, 500))}`);
        }
        return detail.join('\n');
      });

      const text = verbose
        ? renderEntries('network request(s)', formatted, full)
        : `${requests.length} network request(s):\n\n${formatted.join('\n')}`;
      return { content: [{ type: 'text', text }] };
    },
  );
}
