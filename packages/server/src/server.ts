import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ConnectionManager } from './managers/connection-manager.js';
import { SDKBridgeServer } from './sdk-bridge/sdk-server.js';
import { ConnectionOwnership } from './ownership.js';
import { registerAllTools } from './tools/index.js';
import { reversePortsOnAllDevices } from './utils/adb.js';
import { SERVER_VERSION } from './utils/version.js';
import { logger } from './utils/logger.js';
import { DEFAULT_METRO_PORT, SDK_WS_PORT } from '@mcp-rn-devtools/shared';

const ADB_REVERSE_INTERVAL_MS = 30_000;

export type ConnectMode = 'eager' | 'lazy';

export interface ServerOptions {
  metroPort?: number;
  sdkPort?: number;
  /**
   * `eager` attaches to the app at startup (for extensions that record
   * continuously, e.g. tapfix). `lazy` waits for the first tool call, so an
   * idle session never takes the debugger away from the one being used.
   */
  connectMode?: ConnectMode;
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

  const connectionManager = new ConnectionManager({ metroPort: options.metroPort });
  const sdkBridge = new SDKBridgeServer(connectionManager);
  const ownership = new ConnectionOwnership(connectionManager, sdkBridge);
  let reverseTimer: ReturnType<typeof setInterval> | null = null;

  registerAllTools(mcpServer, connectionManager, sdkBridge, ownership);

  return {
    mcpServer,
    connectionManager,
    sdkBridge,
    ownership,

    async start() {
      const connectMode = options.connectMode ?? 'eager';
      // A lazy instance must not take the port (and the debugger) from a
      // session in use just by starting; it claims both on its first tool call.
      await sdkBridge.start(options.sdkPort, { takeover: connectMode === 'eager' });

      // Physical devices over USB reach Metro + SDK bridge via adb reverse —
      // applied automatically so plugging a phone in mid-session just works.
      const reversePorts = [options.metroPort ?? DEFAULT_METRO_PORT, options.sdkPort ?? SDK_WS_PORT];
      connectionManager.on('metro-port-changed', (port: number) => reversePorts.push(port));
      void reversePortsOnAllDevices(reversePorts);
      reverseTimer = setInterval(() => void reversePortsOnAllDevices(reversePorts), ADB_REVERSE_INTERVAL_MS);

      if (connectMode === 'eager') {
        connectionManager.connect().catch((e) => {
          logger.warn('Initial connection failed, will retry:', (e as Error).message);
        });
      }
    },

    shutdown() {
      if (reverseTimer) clearInterval(reverseTimer);
      connectionManager.shutdown();
      sdkBridge.stop();
    },
  };
}
