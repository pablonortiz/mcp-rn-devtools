import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';
import { probeMetro } from '../cdp/discovery.js';

export function registerTargetTools(server: McpServer, cm: ConnectionManager): void {
  server.tool(
    'list_targets',
    'List debuggable React Native targets registered with Metro (multiple devices/apps can be connected). Shows which one the server is using.',
    {},
    { readOnlyHint: true },
    async () => {
      const { reachable, targets } = await probeMetro(cm.metroPort);

      if (!reachable) {
        return {
          content: [
            {
              type: 'text',
              text: `Metro is not reachable on port ${cm.metroPort}. Start it with "npx react-native start".`,
            },
          ],
        };
      }

      if (targets.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'Metro is running but no app has registered a debug target. Launch (or reload) the app on a device/emulator.',
            },
          ],
        };
      }

      const currentId = cm.currentTarget?.id;
      const lines = targets.map((t) => {
        const marker = t.id === currentId ? '→' : ' ';
        return `${marker} ${t.id}\n    ${t.title}\n    ${t.description}`;
      });

      return {
        content: [
          {
            type: 'text',
            text: `${targets.length} target(s) on Metro :${cm.metroPort} (→ = connected):\n\n${lines.join('\n')}`,
          },
        ],
      };
    },
  );

  server.tool(
    'select_target',
    'Connect to a specific debug target by ID (from list_targets) and pin it for reconnects. Use when multiple devices or apps are connected to Metro.',
    {
      target_id: z.string().describe('Target ID from list_targets'),
    },
    async ({ target_id }) => {
      try {
        const target = await cm.connectToTarget(target_id);
        return {
          content: [
            {
              type: 'text',
              text: `Connected to ${target.title} (${target.id}). This target is pinned for future reconnects.`,
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: (e as Error).message }],
          isError: true,
        };
      }
    },
  );
}
