import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';
import type { SDKBridgeServer } from '../sdk-bridge/sdk-server.js';
import { probeMetro } from '../cdp/discovery.js';
import { redactionEnabled } from '../utils/redact.js';

export function registerHealthCheck(
  server: McpServer,
  cm: ConnectionManager,
  sdkBridge: SDKBridgeServer,
): void {
  server.tool(
    'health_check',
    'Check connection status and diagnose problems: CDP/SDK channels, discovered stores, error/request counts, and actionable hints when something is not connected.',
    {},
    { readOnlyHint: true },
    async () => {
      const lines: string[] = [
        `CDP Connected: ${cm.connected ? 'Yes' : 'No'}${cm.currentTarget ? ` — ${cm.currentTarget.title} (${cm.currentTarget.id})` : ''}`,
        `SDK Connected: ${cm.sdkConnected ? 'Yes' : 'No'}${sdkBridge.connectedApp ? ` — app: ${sdkBridge.connectedApp}` : ''}`,
        `Redaction: ${redactionEnabled() ? 'on' : 'OFF (MCP_RN_NO_REDACT=1)'}`,
        `Uptime: ${Math.round(cm.uptime / 1000)}s`,
      ];

      if (sdkBridge.yielded) {
        lines.push(
          '',
          '⛔ THIS INSTANCE YIELDED to a newer mcp-rn-devtools instance (takeover protocol).',
          'It released the SDK port and the CDP session and will stay inactive.',
          'Use the newer session\'s rn-devtools, or restart this MCP server to reclaim.',
        );
      } else if (sdkBridge.portConflict) {
        lines.push(
          '',
          '⚠ ANOTHER mcp-rn-devtools INSTANCE IS RUNNING (SDK port already in use).',
          'A takeover was requested but the holder did not yield (old version or unresponsive).',
          'Fix: kill the stale server(s) — check "ps aux | grep mcp-rn-devtools" — keeping only this session\'s one.',
        );
      }

      if (cm.connected) {
        const summary = await cm.agentBridge.summary(cm.cdp).catch(() => null);
        if (summary) {
          lines.push(
            `Runtime agent: stores [${summary.stores.join(', ') || 'none discovered yet'}], ` +
              `navigation ${summary.navigation ? 'yes' : 'no'}, react-query ${summary.queryClient ? 'yes' : 'no'}`,
          );
        } else {
          lines.push('Runtime agent: not responding (will re-inject on next tool call)');
        }
      }

      lines.push(
        '',
        `Errors: ${cm.errorManager.errorsCount}`,
        `Warnings: ${cm.errorManager.warningsCount}`,
        `Network Requests: ${cm.networkManager.totalCount} total, ${cm.networkManager.failedCount} failed`,
        `Actions recorded: ${cm.actionManager.count}`,
      );

      const recentErrors = cm.errorManager.getRecentErrors(3);
      if (recentErrors.length > 0) {
        lines.push('', 'Recent errors:');
        for (const err of recentErrors) {
          const time = new Date(err.timestamp).toISOString();
          lines.push(`  [${time}] ${err.message}`);
        }
      }

      if (!cm.connected) {
        lines.push('', ...(await diagnoseDisconnection(cm)));
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      };
    },
  );
}

async function diagnoseDisconnection(cm: ConnectionManager): Promise<string[]> {
  const { reachable, targets } = await probeMetro(cm.metroPort);

  if (!reachable) {
    return [
      `Diagnosis: Metro is NOT running on port ${cm.metroPort}.`,
      'Fix: start it from the app repo with "npx react-native start" (or your start script).',
    ];
  }

  if (targets.length === 0) {
    return [
      'Diagnosis: Metro is running but NO app has registered a debug target.',
      'Likely causes:',
      '  1. The app is not running on any device/emulator — launch it.',
      '  2. The installed build never registers the inspector (common with old or CI-built debug APKs).',
      '     Fix: rebuild and reinstall with "npx react-native run-android" / "run-ios".',
      '  3. The app is still loading its JS bundle — targets appear a few seconds after launch; retry.',
    ];
  }

  return [
    `Diagnosis: ${targets.length} target(s) available but not connected yet — the server reconnects with backoff.`,
    'Fix: retry in a few seconds, or pick one explicitly with select_target.',
    ...targets.map((t) => `  - ${t.id}: ${t.title} (${t.description})`),
  ];
}
