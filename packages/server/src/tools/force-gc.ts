import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';

export function registerForceGC(server: McpServer, cm: ConnectionManager): void {
  server.tool(
    'force_gc',
    'Force garbage collection and return before/after heap memory comparison.',
    {},
    async () => {
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

      try {
        const { before, after } = await cm.performanceManager.forceGC(cm.cdp);
        const beforeMB = (before.usedSize / (1024 * 1024)).toFixed(2);
        const afterMB = (after.usedSize / (1024 * 1024)).toFixed(2);
        const freedMB = ((before.usedSize - after.usedSize) / (1024 * 1024)).toFixed(2);
        const freedPercent = before.usedSize > 0
          ? (((before.usedSize - after.usedSize) / before.usedSize) * 100).toFixed(1)
          : '0';

        return {
          content: [
            {
              type: 'text',
              text: [
                'Garbage collection completed:',
                `  Before: ${beforeMB} MB`,
                `  After:  ${afterMB} MB`,
                `  Freed:  ${freedMB} MB (${freedPercent}%)`,
              ].join('\n'),
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to force GC: ${(e as Error).message}`,
            },
          ],
        };
      }
    },
  );
}
