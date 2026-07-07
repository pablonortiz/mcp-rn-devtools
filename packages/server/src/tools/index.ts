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
import { registerResolveSourceLocation } from './resolve-source-location.js';
import { registerGetActionLog } from './get-action-log.js';
import { registerGetNavigationTiming } from './get-navigation-timing.js';
import { registerDispatchAction } from './dispatch-action.js';
import { registerClearBuffers } from './clear-buffers.js';
import { registerWaitForLog } from './wait-for-log.js';
import { registerGetStateDiff } from './get-state-diff.js';
import { registerTargetTools } from './targets.js';

export function registerAllTools(
  server: McpServer,
  cm: ConnectionManager,
  sdkBridge: SDKBridgeServer,
): void {
  // Logging & errors
  registerGetConsoleLogs(server, cm);
  registerGetErrors(server, cm);
  registerGetWarnings(server, cm);
  registerWaitForLog(server, cm);
  // Network
  registerGetNetworkRequests(server, cm);
  registerGetFailedRequests(server, cm);
  // Diagnostics
  registerHealthCheck(server, cm);
  registerTargetTools(server, cm);
  registerClearBuffers(server, cm);
  // Navigation
  registerGetNavigationState(server, cm, sdkBridge);
  registerGetNavigationTiming(server, cm);
  // Memory / performance
  registerGetMemoryUsage(server, cm);
  registerTakeHeapSnapshot(server, cm);
  registerGetCPUProfile(server, cm);
  registerForceGC(server, cm);
  registerGetRenderProfile(server, cm);
  // State
  registerGetAppState(server, cm, sdkBridge);
  registerGetStateDiff(server, cm, sdkBridge);
  registerGetActionLog(server, cm);
  registerDispatchAction(server, cm);
  // Storage
  registerGetStorageKeys(server, cm, sdkBridge);
  registerGetStorageValue(server, cm, sdkBridge);
  // Runtime
  registerEvaluateJS(server, cm);
  registerResolveSourceLocation(server, cm);
}
