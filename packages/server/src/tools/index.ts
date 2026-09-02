import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../managers/connection-manager.js';
import type { SDKBridgeServer } from '../sdk-bridge/sdk-server.js';
import type { ConnectionOwnership } from '../ownership.js';
import type { InstanceRegistry } from '../ownership/instance-registry.js';
import type { SessionApp } from '../session-app.js';
import { activatingRegistrar } from './registrar.js';
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

/** What the diagnostic tools show besides the connection: who else is running, which app this session is on. */
export interface ToolContext {
  registry: InstanceRegistry;
  sessionApp: SessionApp;
}

export function registerAllTools(
  server: McpServer,
  cm: ConnectionManager,
  sdkBridge: SDKBridgeServer,
  ownership: ConnectionOwnership,
  context: ToolContext,
): void {
  // Every tool first makes this instance the debugger's owner (lazy connect,
  // takeover from siblings). The target tools manage the connection themselves.
  const tools = activatingRegistrar(server, () => ownership.ensure(), ['list_targets', 'select_target']);

  // Logging & errors
  registerGetConsoleLogs(tools, cm);
  registerGetErrors(tools, cm);
  registerGetWarnings(tools, cm);
  registerWaitForLog(tools, cm);
  // Network
  registerGetNetworkRequests(tools, cm);
  registerGetFailedRequests(tools, cm);
  // Diagnostics
  registerHealthCheck(tools, cm, sdkBridge, context);
  registerTargetTools(tools, cm, ownership, context);
  registerClearBuffers(tools, cm);
  // Navigation
  registerGetNavigationState(tools, cm, sdkBridge);
  registerGetNavigationTiming(tools, cm);
  // Memory / performance
  registerGetMemoryUsage(tools, cm);
  registerTakeHeapSnapshot(tools, cm);
  registerGetCPUProfile(tools, cm);
  registerForceGC(tools, cm);
  registerGetRenderProfile(tools, cm);
  // State
  registerGetAppState(tools, cm, sdkBridge);
  registerGetStateDiff(tools, cm, sdkBridge);
  registerGetActionLog(tools, cm);
  registerDispatchAction(tools, cm);
  // Storage
  registerGetStorageKeys(tools, cm, sdkBridge);
  registerGetStorageValue(tools, cm, sdkBridge);
  // Runtime
  registerEvaluateJS(tools, cm);
  registerResolveSourceLocation(tools, cm);
}
