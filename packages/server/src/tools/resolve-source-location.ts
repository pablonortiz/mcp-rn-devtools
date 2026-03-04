import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';

export function registerResolveSourceLocation(server: McpServer, cm: ConnectionManager): void {
  server.tool(
    'resolve_source_location',
    'Resolve a bundle line/column (e.g. from a CPU profile or stack trace showing index.bundle:69306) back to the original source file and line. Requires Metro to be running.',
    {
      line: z.number().describe('Line number in the bundle (e.g. 69306)'),
      column: z.number().optional().default(0).describe('Column number in the bundle (default 0)'),
    },
    async ({ line, column }) => {
      const location = await cm.sourcemapManager.resolve(line, column);

      if (!location) {
        return {
          content: [
            {
              type: 'text',
              text: `Could not resolve bundle line ${line}:${column}. Make sure Metro is running on port ${cm.metroPort}.`,
            },
          ],
        };
      }

      const lines = [
        `Bundle line ${line}:${column} →`,
        `  File: ${location.source}`,
        `  Line: ${location.line}:${location.column}`,
      ];

      if (location.name) {
        lines.push(`  Symbol: ${location.name}`);
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      };
    },
  );
}
