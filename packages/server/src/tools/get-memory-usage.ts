import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';

export function registerGetMemoryUsage(server: McpServer, cm: ConnectionManager): void {
  server.tool(
    'get_memory_usage',
    'Get current JavaScript heap memory usage from the React Native app.',
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
        const usage = await cm.performanceManager.getHeapUsage(cm.cdp);
        const usedMB = (usage.usedSize / (1024 * 1024)).toFixed(2);
        const totalMB = (usage.totalSize / (1024 * 1024)).toFixed(2);
        const percent = usage.totalSize > 0
          ? ((usage.usedSize / usage.totalSize) * 100).toFixed(1)
          : '0';

        return {
          content: [
            {
              type: 'text',
              text: `Heap memory: ${usedMB} MB used / ${totalMB} MB total (${percent}%)`,
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to get memory usage: ${(e as Error).message}`,
            },
          ],
        };
      }
    },
  );
}
