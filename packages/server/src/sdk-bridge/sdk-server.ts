import { WebSocketServer, WebSocket } from 'ws';
import { SDK_WS_PORT } from '@mcp-rn-devtools/shared';
import type {
  SDKToServerMessage,
  NavigationState,
  NavigationStateMessage,
  RenderProfileMessage,
  StateSnapshotMessage,
  StorageKeysMessage,
  StorageValueMessage,
  StorageBackend,
  StorageEntry,
} from '@mcp-rn-devtools/shared';
import type { ConnectionManager } from '../managers/connection-manager.js';
import { logger } from '../utils/logger.js';

export class SDKBridgeServer {
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private lastNavigationState: NavigationState | null = null;
  private navigationResolvers: Array<(state: NavigationState | null) => void> = [];
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private connectionManager: ConnectionManager) {}

  start(port: number = SDK_WS_PORT): void {
    this.wss = new WebSocketServer({ port, host: '0.0.0.0' });
    logger.info(`SDK bridge listening on ws://0.0.0.0:${port}`);

    this.wss.on('connection', (ws) => {
      if (this.client) {
        logger.warn('New SDK client replacing existing one');
        this.client.close();
      }

      this.client = ws;
      this.connectionManager.sdkConnected = true;
      logger.info('SDK client connected');

      this.startPing(ws);

      ws.on('message', (data) => {
        try {
          const msg: SDKToServerMessage = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch (e) {
          logger.error('Failed to parse SDK message', e);
        }
      });

      ws.on('close', () => {
        if (this.client === ws) {
          this.client = null;
          this.connectionManager.sdkConnected = false;
          this.lastNavigationState = null;
          this.stopPing();
          logger.info('SDK client disconnected');
        }
      });

      ws.on('error', (err) => {
        logger.error('SDK client error', err.message);
      });

      // Send handshake ack
      this.sendToClient({
        type: 'handshake:ack',
        payload: { serverVersion: '0.1.0' },
        timestamp: Date.now(),
        id: `ack-${Date.now()}`,
      });
    });

    this.wss.on('error', (err) => {
      logger.error('SDK bridge server error', err.message);
    });
  }

  private handleMessage(msg: SDKToServerMessage): void {
    switch (msg.type) {
      case 'handshake':
        logger.info(
          `SDK handshake: v${msg.payload.sdkVersion}` +
            (msg.payload.appName ? ` app=${msg.payload.appName}` : ''),
        );
        break;

      case 'network:request':
      case 'network:response': {
        const req = msg.payload.request;
        this.connectionManager.networkManager.addFromSDK(req as any);
        break;
      }

      case 'console:log': {
        const entry = msg.payload.entry;
        this.connectionManager.logManager.addFromSDK(entry as any);
        break;
      }

      case 'error:report': {
        const error = msg.payload.error;
        this.connectionManager.errorManager.addErrorFromSDK(error as any);
        break;
      }

      case 'navigation:state': {
        const navMsg = msg as NavigationStateMessage;
        this.lastNavigationState = navMsg.payload.state;
        // Resolve any pending navigation requests
        for (const resolve of this.navigationResolvers) {
          resolve(this.lastNavigationState);
        }
        this.navigationResolvers = [];
        break;
      }

      case 'render:profile': {
        const renderMsg = msg as RenderProfileMessage;
        this.connectionManager.renderManager.add(renderMsg.payload.entry);
        break;
      }

      case 'state:snapshot': {
        const stateMsg = msg as StateSnapshotMessage;
        this.connectionManager.stateManager.addSnapshot(stateMsg.payload.snapshot);
        break;
      }

      case 'storage:keys': {
        const storageKeysMsg = msg as StorageKeysMessage;
        this.connectionManager.storageManager.handleKeysResponse(
          storageKeysMsg.payload.backend,
          storageKeysMsg.payload.keys,
          storageKeysMsg.payload.requestId,
        );
        break;
      }

      case 'storage:value': {
        const storageValueMsg = msg as StorageValueMessage;
        this.connectionManager.storageManager.handleValueResponse(
          storageValueMsg.payload.entry,
          storageValueMsg.payload.requestId,
        );
        break;
      }

      case 'pong':
        break;

      default:
        logger.debug('Unknown SDK message type:', (msg as SDKToServerMessage).type);
    }
  }

  async getNavigationState(timeoutMs: number = 3000): Promise<NavigationState | null> {
    if (this.lastNavigationState) {
      // Also request fresh state
      this.requestNavigationState();
      return this.lastNavigationState;
    }

    if (!this.client) return null;

    this.requestNavigationState();

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.navigationResolvers.indexOf(resolve);
        if (idx !== -1) this.navigationResolvers.splice(idx, 1);
        resolve(null);
      }, timeoutMs);

      this.navigationResolvers.push((state) => {
        clearTimeout(timer);
        resolve(state);
      });
    });
  }

  requestAppState(name?: string): void {
    this.sendToClient({
      type: 'request:state',
      payload: { name },
      timestamp: Date.now(),
      id: `state-req-${Date.now()}`,
    });
  }

  async getStorageKeys(backend: StorageBackend, timeoutMs: number = 3000): Promise<string[] | null> {
    if (!this.client) return null;

    const requestId = `storage-keys-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    this.sendToClient({
      type: 'request:storage-keys',
      payload: { backend, requestId },
      timestamp: Date.now(),
      id: requestId,
    });

    return this.connectionManager.storageManager.waitForKeys(requestId, timeoutMs);
  }

  async getStorageValue(backend: StorageBackend, key: string, timeoutMs: number = 3000): Promise<StorageEntry | null> {
    if (!this.client) return null;

    const requestId = `storage-value-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    this.sendToClient({
      type: 'request:storage-value',
      payload: { backend, key, requestId },
      timestamp: Date.now(),
      id: requestId,
    });

    return this.connectionManager.storageManager.waitForValue(requestId, timeoutMs);
  }

  private requestNavigationState(): void {
    this.sendToClient({
      type: 'request:navigation-state',
      payload: {},
      timestamp: Date.now(),
      id: `nav-req-${Date.now()}`,
    });
  }

  private sendToClient(msg: Record<string, unknown>): void {
    if (this.client?.readyState === WebSocket.OPEN) {
      this.client.send(JSON.stringify(msg));
    }
  }

  private startPing(ws: WebSocket): void {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        this.sendToClient({
          type: 'ping',
          payload: {},
          timestamp: Date.now(),
          id: `ping-${Date.now()}`,
        });
      }
    }, 30000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  stop(): void {
    this.stopPing();
    this.client?.close();
    this.wss?.close();
  }
}
