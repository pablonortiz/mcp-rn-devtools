import { z } from 'zod';
import type { ToolRegistrar } from './registrar.js';
import type { ConnectionManager } from '../managers/connection-manager.js';
import { FULL_PARAM_DESCRIPTION, formatLogEntry, notConnectedHint, renderEntries } from './entry-format.js';

export function registerGetConsoleLogs(server: ToolRegistrar, cm: ConnectionManager): void {
  server.tool(
    'get_console_logs',
    'Get console log output from the running React Native app. Returns log, info, and debug messages (not errors/warnings — use get_errors and get_warnings for those).',
    {
      level: z.enum(['log', 'info', 'debug']).optional().describe('Filter by log level'),
      search: z.string().optional().describe('Search string to filter messages'),
      limit: z.number().optional().default(50).describe('Max number of entries to return'),
      since: z.number().optional().describe('Only return entries after this timestamp (ms)'),
      full: z.boolean().optional().default(false).describe(FULL_PARAM_DESCRIPTION),
    },
    { readOnlyHint: true },
    async ({ level, search, limit, since, full }) => {
      const logs = cm.logManager.getLogs({ level, search, limit, since });

      if (logs.length === 0) {
        return { content: [{ type: 'text', text: notConnectedHint(cm, 'console logs') }] };
      }

      const blocks = logs.map((log) => formatLogEntry(log, full));
      return {
        content: [{ type: 'text', text: renderEntries('console log(s)', blocks, full) }],
      };
    },
  );
}
