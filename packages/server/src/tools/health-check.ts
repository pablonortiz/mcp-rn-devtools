import type { ToolRegistrar } from './registrar.js';
import type { ConnectionManager } from '../managers/connection-manager.js';
import type { SDKBridgeServer } from '../sdk-bridge/sdk-server.js';
import { buildHealthReport } from './health-report.js';

export function registerHealthCheck(
  server: ToolRegistrar,
  cm: ConnectionManager,
  sdkBridge: SDKBridgeServer,
): void {
  server.tool(
    'health_check',
    'Connection status with the verdict first: READY (target, stores, capture) or BLOCKED with the cause and the fix. Then version, which instance owns the debugger, SDK channel, counters and recent errors. Calling it also claims the debugger for this session.',
    {},
    { readOnlyHint: true },
    async () => ({
      content: [{ type: 'text', text: await buildHealthReport(cm, sdkBridge) }],
    }),
  );
}
