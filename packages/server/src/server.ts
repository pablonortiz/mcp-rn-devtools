import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ConnectionManager } from './managers/connection-manager.js';
import { SDKBridgeServer } from './sdk-bridge/sdk-server.js';
import { registerAllTools } from './tools/index.js';
import { logger } from './utils/logger.js';

export interface ServerOptions {
  metroPort?: number;
  sdkPort?: number;
}

export function createServer(options: ServerOptions = {}) {
  const mcpServer = new McpServer(
    {
      name: 'mcp-rn-devtools',
      version: '0.1.0',
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
