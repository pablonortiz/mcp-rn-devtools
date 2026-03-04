import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';

export function registerGetConsoleLogs(server: McpServer, cm: ConnectionManager): void {
  server.tool(
    'get_console_logs',
    'Get console log output from the running React Native app. Returns log, info, and debug messages (not errors/warnings — use get_errors and get_warnings for those).',
    {
      level: z.enum(['log', 'info', 'debug']).optional().describe('Filter by log level'),
      search: z.string().optional().describe('Search string to filter messages'),
      limit: z.number().optional().default(50).describe('Max number of entries to return'),
      since: z.number().optional().describe('Only return entries after this timestamp (ms)'),
    },
    async ({ level, search, limit, since }) => {
      const logs = cm.logManager.getLogs({ level, search, limit, since });

      if (!cm.connected && logs.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'Not connected to a React Native app. Make sure Metro is running and a Hermes-powered app is active.',
            },
          ],
        };
      }

      if (logs.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No console logs found matching the criteria.',
            },
          ],
        };
      }

      const formatted = logs.map((log) => {
        const time = new Date(log.timestamp).toISOString();
        const stack = log.stackTrace?.length
          ? `\n  at ${log.stackTrace.map((f) => `${f.functionName || '<anonymous>'} (${f.url}:${f.lineNumber}:${f.columnNumber})`).join('\n  at ')}`
          : '';
        return `[${time}] [${log.level.toUpperCase()}] ${log.message}${stack}`;
      });

      return {
        content: [
          {
            type: 'text',
            text: `${logs.length} console log(s):\n\n${formatted.join('\n\n')}`,
          },
        ],
      };
    },
  );
}
