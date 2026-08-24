import { WebSocketServer, WebSocket } from 'ws';
import { SDK_WS_PORT } from '@mcp-rn-devtools/shared';
import type {
  SDKToServerMessage,
  NavigationState,
  NavigationStateMessage,
  QAReportMessage,
  RenderProfileMessage,
  StateSnapshotMessage,
  StorageKeysMessage,
  StorageValueMessage,
  StorageBackend,
  StorageEntry,
  ReduxActionMessage,
} from '@mcp-rn-devtools/shared';
import type { ConnectionManager } from '../managers/connection-manager.js';
import { logger } from '../utils/logger.js';
import { SERVER_VERSION } from '../utils/version.js';

export class SDKBridgeServer {
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private lastNavigationState: NavigationState | null = null;
  private navigationResolvers: Array<(state: NavigationState | null) => void> = [];
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private _portConflict = false;
  private _yielded = false;
  private takeoverAttempted = false;

  constructor(private connectionManager: ConnectionManager) {}

  /** True when the SDK port was already taken — another server instance is running. */
  get portConflict(): boolean {
    return this._portConflict;
  }

  /** True when a newer instance took over: this one released the port and the CDP session. */
  get yielded(): boolean {
    return this._yielded;
  }

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
          const msg = JSON.parse(data.toString());
          if (msg?.type === 'takeover') {
            this.handleTakeover(msg?.payload?.pid);
            return;
          }
          this.handleMessage(msg as SDKToServerMessage);
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
        payload: { serverVersion: SERVER_VERSION },
        timestamp: Date.now(),
        id: `ack-${Date.now()}`,
      });
    });

    this.wss.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        this._portConflict = true;
        if (!this.takeoverAttempted) {
          this.takeoverAttempted = true;
          logger.warn(`SDK port ${port} already in use — requesting takeover from the previous instance`);
          void this.takeOverPort(port);
        } else {
          logger.error(
            `SDK port ${port} still in use and the holder did not yield — instances will compete for the CDP session`,
          );
        }
        return;
      }
      logger.error('SDK bridge server error', err.message);
    });
  }

  /**
   * Newest-instance-wins: stale servers from finished sessions linger holding
   * the port and steal the single Hermes debugger. Ask the holder to yield,
   * then rebind.
   */
  private async takeOverPort(port: number): Promise<void> {
    const accepted = await this.requestTakeover(port);
    if (!accepted) {
      logger.error(
        `SDK port ${port} holder did not respond to takeover — kill it manually (ps aux | grep mcp-rn-devtools)`,
      );
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    this.wss?.close();
    this.wss = null;
    this._portConflict = false;
    logger.info('Previous instance yielded — rebinding SDK port');
    this.start(port);
  }

  private requestTakeover(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        try {
          ws.terminate();
        } catch {
          /* already closed */
        }
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), 2000);
      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            type: 'takeover',
            payload: { pid: process.pid },
            timestamp: Date.now(),
            id: `takeover-${process.pid}`,
          }),
        );
        setTimeout(() => finish(true), 300);
      });
      ws.on('error', () => finish(false));
    });
  }

  private handleTakeover(pid?: number): void {
    logger.warn(
      `Takeover requested by a newer mcp-rn-devtools instance${pid ? ` (pid ${pid})` : ''} — releasing the SDK port and the CDP session`,
    );
    this._yielded = true;
    this.connectionManager.shutdown();
    this.stop();
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
        // Record navigation timing
        this.connectionManager.navigationTimingManager.recordNavigation(this.lastNavigationState);
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
        this.connectionManager.stateManager.addSnapshot(
          stateMsg.payload.snapshot,
          stateMsg.payload.requestId,
        );
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

      case 'redux:action': {
        const actionMsg = msg as ReduxActionMessage;
        this.connectionManager.actionManager.add(actionMsg.payload.entry);
        break;
      }

      case 'qa:report': {
        const qaMsg = msg as QAReportMessage;
        this.connectionManager.qaReportManager
          .capture(qaMsg.payload.report, {
            getNavigationState: () => this.getNavigationState(),
            getAppState: () => this.getAppState(),
          })
          .catch((e) => logger.error('Failed to capture QA report', (e as Error).message));
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

  /**
   * Requests a fresh state snapshot and waits for the SDK to answer it
   * (requestId-correlated — no fixed sleep). Returns null on timeout.
   * Without a store name, several stores may answer with the same requestId;
   * the promise resolves on the first one and the rest land in StateManager.
   */
  async getAppState(name?: string, timeoutMs: number = 2000): Promise<unknown | null> {
    if (!this.client) return null;

    const requestId = `state-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.sendToClient({
      type: 'request:state',
      payload: { name, requestId },
      timestamp: Date.now(),
      id: requestId,
    });

    const snapshot = await this.connectionManager.stateManager.waitForSnapshot(
      requestId,
      timeoutMs,
    );
    if (snapshot && !name) {
      // Give sibling stores a beat to land before the caller reads the full map
      await new Promise((r) => setTimeout(r, 200));
    }
    return snapshot;
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
