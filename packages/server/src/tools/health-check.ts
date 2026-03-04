import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';

export function registerHealthCheck(server: McpServer, cm: ConnectionManager): void {
  server.tool(
    'health_check',
    'Check the connection status and get a summary of the React Native app state: connection status, error/warning/request counts, and recent errors.',
    {},
    async () => {
      const result = {
        connected: cm.connected,
        sdkConnected: cm.sdkConnected,
        engine: cm.connected ? 'Hermes' : 'unknown',
        errorsCount: cm.errorManager.errorsCount,
        warningsCount: cm.errorManager.warningsCount,
        failedRequestsCount: cm.networkManager.failedCount,
        totalRequestsCount: cm.networkManager.totalCount,
        recentErrors: cm.errorManager.getRecentErrors(3),
        uptime: cm.uptime,
      };

      const lines = [
        `CDP Connected: ${result.connected ? 'Yes' : 'No'}`,
        `SDK Connected: ${result.sdkConnected ? 'Yes' : 'No'}`,
        `Engine: ${result.engine}`,
        `Uptime: ${Math.round(result.uptime / 1000)}s`,
        ``,
        `Errors: ${result.errorsCount}`,
        `Warnings: ${result.warningsCount}`,
        `Network Requests: ${result.totalRequestsCount} total, ${result.failedRequestsCount} failed`,
      ];

      if (result.recentErrors.length > 0) {
        lines.push('', 'Recent errors:');
        for (const err of result.recentErrors) {
          const time = new Date(err.timestamp).toISOString();
          lines.push(`  [${time}] ${err.message}`);
        }
      }

      if (!result.connected) {
        lines.push(
          '',
          'Tip: Make sure Metro bundler is running and a Hermes-powered React Native app is active.',
        );
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      };
    },
  );
}
