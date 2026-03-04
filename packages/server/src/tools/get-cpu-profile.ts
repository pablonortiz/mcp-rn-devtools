import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';

export function registerGetCPUProfile(server: McpServer, cm: ConnectionManager): void {
  server.tool(
    'get_cpu_profile',
    'Profile CPU usage for a given duration and return the hottest functions sorted by self time.',
    {
      duration: z
        .number()
        .optional()
        .default(5000)
        .describe('Profiling duration in milliseconds (default 5000, max 30000)'),
    },
    async ({ duration }) => {
      if (!cm.connected) {
        return {
          content: [
            {
              type: 'text',
              text: 'Not connected to a React Native app. Make sure Metro is running and a Hermes-powered app is active.',
            },
          ],
        };
      }

      const cappedDuration = Math.min(Math.max(duration, 500), 30000);

      try {
        const functions = await cm.performanceManager.getCPUProfile(cm.cdp, cappedDuration);

        if (functions.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `CPU profile completed (${cappedDuration}ms) — no significant function activity recorded.`,
              },
            ],
          };
        }

        const lines = [
          `CPU Profile (${cappedDuration}ms) — Top functions by self time:`,
          '',
          ...functions.map((fn, i) => {
            const loc = fn.url !== '(native)' ? ` (${fn.url}:${fn.lineNumber})` : ' (native)';
            return `  ${i + 1}. ${fn.functionName} — ${fn.selfTime}ms${loc}`;
          }),
        ];

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      } catch (e) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to get CPU profile: ${(e as Error).message}`,
            },
          ],
        };
      }
    },
  );
}
