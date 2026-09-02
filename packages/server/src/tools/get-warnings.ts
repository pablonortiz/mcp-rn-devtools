import { z } from 'zod';
import type { ToolRegistrar } from './registrar.js';
import type { ConnectionManager } from '../managers/connection-manager.js';
import { FULL_PARAM_DESCRIPTION, formatWarningEntry, notConnectedHint, renderEntries } from './entry-format.js';

export function registerGetWarnings(server: ToolRegistrar, cm: ConnectionManager): void {
  server.tool(
    'get_warnings',
    'Get LogBox warnings from the running React Native app. These are captured via console.warn.',
    {
      limit: z.number().optional().default(50).describe('Max number of entries to return'),
      since: z.number().optional().describe('Only return entries after this timestamp (ms)'),
      search: z.string().optional().describe('Search string to filter warning messages'),
      full: z.boolean().optional().default(false).describe(FULL_PARAM_DESCRIPTION),
    },
    { readOnlyHint: true },
    async ({ limit, since, search, full }) => {
      const warnings = cm.errorManager.getWarnings({ limit, since, search });

      if (warnings.length === 0) {
        return { content: [{ type: 'text', text: notConnectedHint(cm, 'warnings') }] };
      }

      const blocks = warnings.map((warning) => formatWarningEntry(warning, full));
      return {
        content: [{ type: 'text', text: renderEntries('warning(s)', blocks, full) }],
      };
    },
  );
}
