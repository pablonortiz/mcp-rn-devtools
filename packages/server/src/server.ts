import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ConnectionManager } from './managers/connection-manager.js';
import { SDKBridgeServer } from './sdk-bridge/sdk-server.js';
import { registerAllTools } from './tools/index.js';
import { reversePortsOnAllDevices } from './utils/adb.js';
import { SERVER_VERSION } from './utils/version.js';
import { logger } from './utils/logger.js';
import { DEFAULT_METRO_PORT, SDK_WS_PORT } from '@mcp-rn-devtools/shared';

const ADB_REVERSE_INTERVAL_MS = 30_000;

export interface ServerOptions {
  metroPort?: number;
  sdkPort?: number;
}

export function createServer(options: ServerOptions = {}) {
  const mcpServer = new McpServer(
    {
      name: 'mcp-rn-devtools',
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  const connectionManager = new ConnectionManager(options.metroPort);
  const sdkBridge = new SDKBridgeServer(connectionManager);

  registerAllTools(mcpServer, connectionManager, sdkBridge);

  return {
    mcpServer,
    connectionManager,
    sdkBridge,

    async start() {
      // Start SDK bridge server
      sdkBridge.start(options.sdkPort);

      // Physical devices over USB reach Metro + SDK bridge via adb reverse —
      // applied automatically so plugging a phone in mid-session just works.
      const reversePorts = [options.metroPort ?? DEFAULT_METRO_PORT, options.sdkPort ?? SDK_WS_PORT];
      void reversePortsOnAllDevices(reversePorts);
      const reverseTimer = setInterval(() => void reversePortsOnAllDevices(reversePorts), ADB_REVERSE_INTERVAL_MS);
      connectionManager.on('shutdown', () => clearInterval(reverseTimer));

      // Connect to RN app (non-blocking — retries in background)
      connectionManager.connect().catch((e) => {
        logger.warn('Initial connection failed, will retry:', (e as Error).message);
      });
    },

    shutdown() {
      connectionManager.shutdown();
      sdkBridge.stop();
    },
  };
}
