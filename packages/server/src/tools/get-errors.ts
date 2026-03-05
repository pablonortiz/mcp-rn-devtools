import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';

export function registerGetErrors(server: McpServer, cm: ConnectionManager): void {
  server.tool(
    'get_errors',
    'Get JavaScript errors and exceptions from the running React Native app. Includes RedBox errors captured via console.error.',
    {
      limit: z.number().optional().default(50).describe('Max number of entries to return'),
      since: z.number().optional().describe('Only return entries after this timestamp (ms)'),
      search: z.string().optional().describe('Search string to filter error messages'),
    },
    async ({ limit, since, search }) => {
      const errors = cm.errorManager.getErrors({ limit, since, search });

      if (errors.length === 0) {
        const sources: string[] = [];
        if (cm.connected) sources.push('CDP');
        if (cm.sdkConnected) sources.push('SDK');
        const status = sources.length > 0
          ? `Connected via ${sources.join(' + ')}.`
          : 'Not connected to a React Native app. Make sure Metro is running and the SDK is installed.';
        return {
          content: [{ type: 'text', text: `No errors found. ${status}` }],
        };
      }

      const formatted = errors.map((err) => {
        const time = new Date(err.timestamp).toISOString();
        const fatal = err.isFatal ? ' [FATAL]' : '';
        const stack = err.stack?.length
          ? `\n  at ${err.stack.map((f) => `${f.functionName || '<anonymous>'} (${f.url}:${f.lineNumber}:${f.columnNumber})`).join('\n  at ')}`
          : '';
        const component = err.componentStack
          ? `\nComponent stack: ${err.componentStack}`
          : '';
        return `[${time}]${fatal} ${err.message}${stack}${component}`;
      });

      return {
        content: [
          {
            type: 'text',
            text: `${errors.length} error(s):\n\n${formatted.join('\n\n')}`,
          },
        ],
      };
    },
  );
}
