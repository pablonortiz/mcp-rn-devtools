import { z } from 'zod';
import type { ToolRegistrar } from './registrar.js';
import type { ConnectionManager } from '../managers/connection-manager.js';
import { FULL_PARAM_DESCRIPTION, formatErrorEntry, notConnectedHint, renderEntries } from './entry-format.js';

export function registerGetErrors(server: ToolRegistrar, cm: ConnectionManager): void {
  server.tool(
    'get_errors',
    'Get JavaScript errors and exceptions from the running React Native app. Includes RedBox errors captured via console.error.',
    {
      limit: z.number().optional().default(50).describe('Max number of entries to return'),
      since: z.number().optional().describe('Only return entries after this timestamp (ms)'),
      search: z.string().optional().describe('Search string to filter error messages'),
      full: z.boolean().optional().default(false).describe(FULL_PARAM_DESCRIPTION),
    },
    { readOnlyHint: true },
    async ({ limit, since, search, full }) => {
      const errors = cm.errorManager.getErrors({ limit, since, search });

      if (errors.length === 0) {
        return { content: [{ type: 'text', text: notConnectedHint(cm, 'errors') }] };
      }

      const blocks = errors.map((error) => formatErrorEntry(error, full));
      return {
        content: [{ type: 'text', text: renderEntries('error(s)', blocks, full) }],
      };
    },
  );
}
