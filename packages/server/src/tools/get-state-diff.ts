import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';
import type { SDKBridgeServer } from '../sdk-bridge/sdk-server.js';
import { diffStates } from '../utils/state-diff.js';
import { redact } from '../utils/redact.js';

const DIFF_DEPTH = 8;

export function registerGetStateDiff(
  server: McpServer,
  cm: ConnectionManager,
  sdkBridge: SDKBridgeServer,
): void {
  server.tool(
    'get_state_diff',
    'Show what changed in a Redux store since the last call. First call records a baseline; subsequent calls diff the current state against it and reset the baseline. Workflow: call once, interact with the app (or dispatch), call again.',
    {
      store: z.string().optional().describe('Store name (omit to use the first/only store)'),
    },
    { readOnlyHint: true },
    async ({ store }) => {
      const current = await fetchCurrentState(cm, sdkBridge, store);

      if (!current) {
        return {
          content: [
            {
              type: 'text',
              text: 'Could not read the store state. Make sure the app is connected and has a Redux store.',
            },
          ],
        };
      }

      const baseline = cm.stateManager.getDiffBaseline(current.name);
      cm.stateManager.setDiffBaseline(current.name, current.state);

      if (!baseline) {
        return {
          content: [
            {
              type: 'text',
              text: `Baseline recorded for store "${current.name}". Interact with the app (or dispatch actions), then call get_state_diff again to see what changed.`,
            },
          ],
        };
      }

      const entries = diffStates(baseline.state, current.state);

      if (entries.length === 0) {
        return {
          content: [
            { type: 'text', text: `No changes in store "${current.name}" since the last baseline.` },
          ],
        };
      }

      const lines = entries.map((e) => {
        const redacted = redact({ before: e.before, after: e.after });
        switch (e.kind) {
          case 'added':
            return `+ ${e.path} = ${JSON.stringify(redacted.after)}`;
          case 'removed':
            return `- ${e.path} (was ${JSON.stringify(redacted.before)})`;
          default:
            return `~ ${e.path}: ${JSON.stringify(redacted.before)} → ${JSON.stringify(redacted.after)}`;
        }
      });

      return {
        content: [
          {
            type: 'text',
            text: `${entries.length} change(s) in store "${current.name}":\n\n${lines.join('\n')}`,
          },
        ],
      };
    },
  );
}

async function fetchCurrentState(
  cm: ConnectionManager,
  sdkBridge: SDKBridgeServer,
  store?: string,
): Promise<{ name: string; state: unknown } | null> {
  if (cm.sdkConnected) {
    const snapshot = (await sdkBridge.getAppState(store)) as { name: string; state: unknown } | null;
    if (snapshot) return { name: snapshot.name, state: snapshot.state };
  }

  if (cm.connected) {
    const result = await cm.agentBridge.getState(cm.cdp, store, undefined, DIFF_DEPTH).catch(() => null);
    if (result?.found && !result.missing) {
      return { name: result.store ?? 'redux', state: result.data };
    }
  }

  return null;
}
