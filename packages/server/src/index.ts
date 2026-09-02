export { createServer } from './server.js';
export type { ServerOptions, ConnectMode } from './server.js';

// Building blocks for extensions built on top of the core (e.g. tapfix):
// they share this process's CDP session and SDK channel instead of competing
// for the single Hermes debugger.
export { ConnectionManager } from './managers/connection-manager.js';
export type { ConnectionManagerOptions } from './managers/connection-manager.js';
export { SDKBridgeServer } from './sdk-bridge/sdk-server.js';
export { ConnectionOwnership } from './ownership.js';
export { AgentBridge } from './cdp/agent-bridge.js';
export { evaluateByValue } from './cdp/evaluate.js';
export {
  probeMetro,
  scanMetroPorts,
  isMainRuntimeTarget,
  findReactNativeTarget,
  DEFAULT_SCAN_PORTS,
} from './cdp/discovery.js';
export type { CDPTarget, MetroProbe } from './cdp/discovery.js';
export { activatingRegistrar } from './tools/registrar.js';
export type { ToolRegistrar } from './tools/registrar.js';
export { exitWhenOrphaned } from './utils/process-lifecycle.js';
export { parseDevServerHint, readDevServerHint } from './utils/dev-server-hint.js';
export type { DevServerHint } from './utils/dev-server-hint.js';
export { redact, redactionEnabled } from './utils/redact.js';
export {
  captureScreenPng,
  getDeviceScreenInfo,
  relaunchApp,
  reversePortsOnAllDevices,
  findAdb,
  firstDevice,
  listDevices,
  startScreenRecord,
} from './utils/adb.js';
export type { AdbDevice, DeviceScreenInfo, ScreenRecording } from './utils/adb.js';
export type { SourceLocation } from './managers/sourcemap-manager.js';
export { captureAdbScreenshot } from './utils/adb-screenshot.js';
export { logger } from './utils/logger.js';

// Wire types shared with the on-device SDK (the QA overlay speaks these)
export type {
  QAReport,
  QAReportElement,
  QAReportPayload,
  QAReportMode,
  QAReportStatus,
  QAElementFrame,
  QARelatedElement,
  QARecording,
  NavigationState,
  SDKMessage,
} from '@mcp-rn-devtools/shared';
export { QA_COCKPIT_PORT, QA_REPORTS_DIRNAME, QA_UNKNOWN_APP } from '@mcp-rn-devtools/shared';
