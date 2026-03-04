import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';

export function registerTakeHeapSnapshot(server: McpServer, cm: ConnectionManager): void {
  server.tool(
    'take_heap_snapshot',
    'Take a heap snapshot and return a summary with top memory retainers. This may take a few seconds.',
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
        const summary = await cm.performanceManager.takeHeapSnapshot(cm.cdp);
        const totalMB = (summary.totalSize / (1024 * 1024)).toFixed(2);

        const lines = [
          `Heap Snapshot Summary`,
          `Total size: ${totalMB} MB`,
          `Total objects: ${summary.totalObjects.toLocaleString()}`,
          '',
          'Top retainers by size:',
          ...summary.topRetainers.map((r, i) => {
            const sizeMB = (r.size / (1024 * 1024)).toFixed(3);
            return `  ${i + 1}. ${r.name} — ${sizeMB} MB (${r.count} objects)`;
          }),
        ];

        if (summary.topRetainers.length === 0) {
          lines.push('  (no retainer data available)');
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      } catch (e) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to take heap snapshot: ${(e as Error).message}`,
            },
          ],
        };
      }
    },
  );
}
