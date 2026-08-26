export { createServer } from './server.js';
export type { ServerOptions } from './server.js';

// Building blocks for extensions built on top of the core (e.g. tapfix):
// they share this process's CDP session and SDK channel instead of competing
// for the single Hermes debugger.
export { ConnectionManager } from './managers/connection-manager.js';
export { SDKBridgeServer } from './sdk-bridge/sdk-server.js';
export { AgentBridge } from './cdp/agent-bridge.js';
export { redact, redactionEnabled } from './utils/redact.js';
export {
  captureScreenPng,
  getDeviceScreenInfo,
  relaunchApp,
  reversePortsOnAllDevices,
  findAdb,
  firstDevice,
  listDevices,
} from './utils/adb.js';
export type { AdbDevice, DeviceScreenInfo } from './utils/adb.js';
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
  NavigationState,
  SDKMessage,
} from '@mcp-rn-devtools/shared';
export { QA_COCKPIT_PORT, QA_REPORTS_DIRNAME, QA_UNKNOWN_APP } from '@mcp-rn-devtools/shared';
