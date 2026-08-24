import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ConnectionManager } from './managers/connection-manager.js';
import { SDKBridgeServer } from './sdk-bridge/sdk-server.js';
import { CockpitServer } from './cockpit/cockpit-server.js';
import { registerAllTools } from './tools/index.js';
import { SERVER_VERSION } from './utils/version.js';
import { logger } from './utils/logger.js';

export interface ServerOptions {
  metroPort?: number;
  sdkPort?: number;
  cockpitPort?: number;
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
  const cockpit = new CockpitServer(connectionManager, sdkBridge);

  registerAllTools(mcpServer, connectionManager, sdkBridge);

  return {
    mcpServer,
    connectionManager,
    sdkBridge,
    cockpit,

    async start() {
      // Start SDK bridge server
      sdkBridge.start(options.sdkPort);

      // QA Cockpit: local web UI for the capture loop
      cockpit.start(options.cockpitPort);

      // Connect to RN app (non-blocking — retries in background)
      connectionManager.connect().catch((e) => {
        logger.warn('Initial connection failed, will retry:', (e as Error).message);
      });
    },

    shutdown() {
      connectionManager.shutdown();
      sdkBridge.stop();
      cockpit.stop();
    },
  };
}
