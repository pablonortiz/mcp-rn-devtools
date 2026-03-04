import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';
import type { SDKBridgeServer } from '../sdk-bridge/sdk-server.js';
import { registerGetConsoleLogs } from './get-console-logs.js';
import { registerGetErrors } from './get-errors.js';
import { registerGetWarnings } from './get-warnings.js';
import { registerGetNetworkRequests } from './get-network-requests.js';
import { registerGetFailedRequests } from './get-failed-requests.js';
import { registerHealthCheck } from './health-check.js';
import { registerGetNavigationState } from './get-navigation-state.js';
import { registerGetMemoryUsage } from './get-memory-usage.js';
import { registerTakeHeapSnapshot } from './take-heap-snapshot.js';
import { registerGetCPUProfile } from './get-cpu-profile.js';
import { registerForceGC } from './force-gc.js';
import { registerGetRenderProfile } from './get-render-profile.js';
import { registerGetAppState } from './get-app-state.js';
import { registerGetStorageKeys } from './get-storage-keys.js';
import { registerGetStorageValue } from './get-storage-value.js';
import { registerEvaluateJS } from './evaluate-js.js';

export function registerAllTools(
  server: McpServer,
  cm: ConnectionManager,
  sdkBridge: SDKBridgeServer,
): void {
  registerGetConsoleLogs(server, cm);
  registerGetErrors(server, cm);
  registerGetWarnings(server, cm);
  registerGetNetworkRequests(server, cm);
  registerGetFailedRequests(server, cm);
  registerHealthCheck(server, cm);
  registerGetNavigationState(server, cm, sdkBridge);
  // Phase 5a: Memory/Performance
  registerGetMemoryUsage(server, cm);
  registerTakeHeapSnapshot(server, cm);
  registerGetCPUProfile(server, cm);
  registerForceGC(server, cm);
  // Phase 5b: Render Tracking
  registerGetRenderProfile(server, cm);
  // Phase 5c: State Inspection
  registerGetAppState(server, cm, sdkBridge);
  // Phase 5d: Storage
  registerGetStorageKeys(server, cm, sdkBridge);
  registerGetStorageValue(server, cm, sdkBridge);
  // Runtime evaluation
  registerEvaluateJS(server, cm);
}
