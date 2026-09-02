import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ConnectionManager } from './managers/connection-manager.js';
import { SDKBridgeServer } from './sdk-bridge/sdk-server.js';
import { ConnectionOwnership } from './ownership.js';
import { InstanceRegistry } from './ownership/instance-registry.js';
import { ControlServer } from './ownership/control-server.js';
import { detectSessionApp, type SessionApp } from './session-app.js';
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
  /** Shown to other instances in the registry (default: mcp-rn-devtools). */
  label?: string;
  /** App id prefixes this session works on; detected from the cwd's repo when omitted. */
  sessionAppIds?: string[];
  /** Where instances register themselves (default: ~/.mcp-rn-devtools/instances). */
  stateDir?: string;
  /** Metro ports to look at besides the configured one (default 8081–8085). */
  scanPorts?: number[];
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

  const instanceId = randomUUID();
  const sessionApp: SessionApp = options.sessionAppIds
    ? { ids: options.sessionAppIds, source: 'options' }
    : detectSessionApp();
  const connectionManager = new ConnectionManager({
    metroPort: options.metroPort,
    scanPorts: options.scanPorts,
    sessionAppIds: sessionApp.ids,
  });
  const sdkBridge = new SDKBridgeServer(connectionManager);
  const registry = new InstanceRegistry(
    { instanceId, pid: process.pid, label: options.label ?? 'mcp-rn-devtools', version: SERVER_VERSION, cwd: process.cwd() },
    { dir: options.stateDir },
  );
  const ownership = new ConnectionOwnership({ connectionManager, sdkBridge, registry, instanceId });
  const control = new ControlServer({
    onYield: (key, from) => ownership.handleYieldRequest(key, from),
    onStatus: () => registry.current,
  });
  let reverseTimer: ReturnType<typeof setInterval> | null = null;

  registerAllTools(mcpServer, connectionManager, sdkBridge, ownership, { registry, sessionApp });

  return {
    mcpServer,
    connectionManager,
    sdkBridge,
    ownership,
    registry,
    control,
    sessionApp,

    async start() {
      const connectMode = options.connectMode ?? 'eager';
      if (sessionApp.ids.length > 0) logger.info(`Session app: ${sessionApp.ids.join(', ')} (${sessionApp.source})`);

      registry.update({ controlPort: await control.start() });
      // The SDK port is only the on-device SDK channel now; the debugger is
      // claimed per target, so nobody is asked to yield just because we started.
      await sdkBridge.start(options.sdkPort, { takeover: false });

      // Physical devices over USB reach Metro + SDK bridge via adb reverse —
      // applied automatically so plugging a phone in mid-session just works.
      const reversePorts = [options.metroPort ?? DEFAULT_METRO_PORT, options.sdkPort ?? SDK_WS_PORT];
      connectionManager.on('metro-port-changed', (port: number) => reversePorts.push(port));
      void reversePortsOnAllDevices(reversePorts);
      reverseTimer = setInterval(() => void reversePortsOnAllDevices(reversePorts), ADB_REVERSE_INTERVAL_MS);

      if (connectMode === 'eager') {
        ownership.ensure().catch((e) => {
          logger.warn('Initial connection failed, will retry:', (e as Error).message);
        });
      }
    },

    shutdown() {
      if (reverseTimer) clearInterval(reverseTimer);
      control.stop();
      connectionManager.shutdown();
      sdkBridge.stop();
      registry.remove();
    },
  };
}
