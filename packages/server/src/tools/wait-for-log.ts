import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';

const POLL_INTERVAL_MS = 250;

export function registerWaitForLog(server: McpServer, cm: ConnectionManager): void {
  server.tool(
    'wait_for_log',
    'Block until a console log or error matching a pattern appears (only entries newer than the call count). Use it to synchronize with app activity: call it, interact with the app, and it returns the moment the log shows up.',
    {
      pattern: z.string().describe('Pattern to match against log messages (regex, falls back to substring)'),
      timeout_ms: z.number().min(500).max(60000).optional().default(10000)
        .describe('How long to wait before giving up'),
      include_errors: z.boolean().optional().default(true).describe('Also match error entries'),
    },
    { readOnlyHint: true },
    async ({ pattern, timeout_ms, include_errors }) => {
      const startTs = Date.now();
      const matcher = buildMatcher(pattern);
      const deadline = startTs + timeout_ms;
      // Cut by server-side receivedAt: entry timestamps come from the device,
      // whose clock can be skewed by seconds relative to this machine.
      const isFresh = (entry: { receivedAt?: number; timestamp: number }) =>
        (entry.receivedAt ?? entry.timestamp) >= startTs;

      while (Date.now() < deadline) {
        const logs = cm.logManager.getLogs({});
        const logMatch = logs.find((l) => isFresh(l) && matcher(l.message));
        if (logMatch) {
          return {
            content: [
              {
                type: 'text',
                text: `Matched log after ${Date.now() - startTs}ms:\n[${logMatch.level}] ${logMatch.message}`,
              },
            ],
          };
        }

        if (include_errors) {
          const errors = cm.errorManager.getErrors({});
          const errorMatch = errors.find((e) => isFresh(e) && matcher(e.message));
          if (errorMatch) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Matched error after ${Date.now() - startTs}ms:\n${errorMatch.message}`,
                },
              ],
            };
          }
        }

        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }

      return {
        content: [
          {
            type: 'text',
            text: `No log matching "${pattern}" appeared within ${timeout_ms}ms.`,
          },
        ],
      };
    },
  );
}

function buildMatcher(pattern: string): (message: string) => boolean {
  try {
    const regex = new RegExp(pattern, 'i');
    return (message) => regex.test(message);
  } catch {
    const needle = pattern.toLowerCase();
    return (message) => message.toLowerCase().includes(needle);
  }
}
