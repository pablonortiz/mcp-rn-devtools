import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
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
  ReduxActionMessage,
} from '@mcp-rn-devtools/shared';
import type { ConnectionManager } from '../managers/connection-manager.js';
import { logger } from '../utils/logger.js';
import { SERVER_VERSION } from '../utils/version.js';

const REBIND_DELAY_MS = 500;
const TAKEOVER_TIMEOUT_MS = 2000;

/**
 * Emits 'sdk-message' with any message type it does not handle itself, so
 * extensions (e.g. tapfix's QA capture loop) can speak over the same channel;
 * reply with sendToClient().
 *
 * Holding the SDK port also marks which instance owns the single Hermes
 * debugger: newest-instance-wins on start, and a yielded instance takes it
 * back with reclaim() when its own session needs it.
 */
export class SDKBridgeServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private _connectedApp: string | null = null;
  private lastNavigationState: NavigationState | null = null;
  private navigationResolvers: Array<(state: NavigationState | null) => void> = [];
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private _portConflict = false;
  private _yielded = false;
  private _incompatibleHolder = false;
  private _port: number = SDK_WS_PORT;
  private starting: Promise<void> | null = null;
  /** Identifies this instance in takeover requests (a process can host several, e.g. in tests). */
  readonly instanceId = randomUUID();

  constructor(private connectionManager: ConnectionManager) {
    super();
  }

  /** True while another instance holds the SDK port (this one can take it with reclaim()). */
  get portConflict(): boolean {
    return this._portConflict;
  }

  /** True when the holder ignored a takeover request: a pre-0.3 instance, or a hung one. */
  get incompatibleHolder(): boolean {
    return this._incompatibleHolder;
  }

  /** True when a newer instance took over: this one released the port and the CDP session. */
  get yielded(): boolean {
    return this._yielded;
  }

  /** This instance holds the SDK port (the on-device SDK channel; pre-0.5 instances also treat it as the debugger token). */
  get holdsPort(): boolean {
    return this.wss !== null;
  }

  /** The SDK port this instance serves or wants. */
  get port(): number {
    return this._port;
  }

  /** Application id reported by the connected SDK's handshake, if any. */
  get connectedApp(): string | null {
    return this._connectedApp;
  }

  /**
   * Binds the SDK port. When another instance holds it: with `takeover` the
   * holder is asked to yield and the port rebound (newest-instance-wins);
   * without it this instance stays unbound until reclaim() — how a lazy
   * instance avoids taking the debugger away from a session at startup.
   * Resolves once settled either way; concurrent calls share one attempt.
   */
  start(port: number = SDK_WS_PORT, options: { takeover?: boolean } = {}): Promise<void> {
    this._port = port;
    if (this.starting) return this.starting;
    this.starting = this.startOnce(port, options.takeover !== false).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /** A yielded (or never-bound) instance takes the port back — and with it the debugger. */
  async reclaim(): Promise<boolean> {
    if (this.wss) return true;
    await this.start(this._port, { takeover: true });
    return this.wss !== null;
  }

  private async startOnce(port: number, takeover: boolean): Promise<void> {
    if (this.wss) return;
    if (await this.bind(port)) return;
    if (!takeover) {
      logger.info(`SDK port ${port} is held by another instance — this one takes it on its first tool call`);
      return;
    }
    await this.takeOverPort(port);
  }

  private bind(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const wss = new WebSocketServer({ port, host: '0.0.0.0' });
      wss.once('listening', () => {
        this.wss = wss;
        this._portConflict = false;
        this._yielded = false;
        this._incompatibleHolder = false;
        this.acceptClients(wss);
        logger.info(`SDK bridge listening on ws://0.0.0.0:${port}`);
        this.emit('bound');
        resolve(true);
      });
      wss.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') this._portConflict = true;
        else logger.error('SDK bridge server error', err.message);
        resolve(false);
      });
    });
  }

  private acceptClients(wss: WebSocketServer): void {
    wss.on('error', (err) => logger.error('SDK bridge server error', err.message));

    wss.on('connection', (ws) => {
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
            this.handleTakeover(msg?.payload?.pid, msg?.payload?.instance);
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
          this._connectedApp = null;
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
  }

  private async takeOverPort(port: number): Promise<void> {
    logger.warn(`SDK port ${port} already in use — requesting takeover from the previous instance`);
    if (!(await this.requestTakeover(port))) {
      this._incompatibleHolder = true;
      logger.error(
        `SDK port ${port} holder did not respond to takeover (older version or unresponsive) — ` +
          'instances will compete for the CDP session. Kill it manually: ps aux | grep mcp-rn-devtools',
      );
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, REBIND_DELAY_MS));
    if (await this.bind(port)) {
      logger.info('Previous instance yielded — SDK port rebound');
      return;
    }
    // A pre-0.3 instance accepts the socket but ignores the message
    this._incompatibleHolder = true;
    logger.error(
      `SDK port ${port} still in use after the takeover request — the holder did not yield (older version?). ` +
        'Kill it manually: ps aux | grep mcp-rn-devtools',
    );
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
      const timer = setTimeout(() => finish(false), TAKEOVER_TIMEOUT_MS);
      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            type: 'takeover',
            payload: { pid: process.pid, instance: this.instanceId },
            timestamp: Date.now(),
            id: `takeover-${process.pid}`,
          }),
        );
        setTimeout(() => finish(true), 300);
      });
      ws.on('error', () => finish(false));
    });
  }

  private handleTakeover(pid?: number, instance?: string): void {
    // Two of our own tool calls racing to bind would otherwise make us yield to ourselves
    if (instance === this.instanceId) return;
    logger.warn(
      `Takeover requested by a newer mcp-rn-devtools instance${pid ? ` (pid ${pid})` : ''} — ` +
        'releasing the SDK port and the CDP session; this instance reclaims them on its next tool call',
    );
    this._yielded = true;
    this.releasePort();
    this.connectionManager.suspend();
    this.emit('yielded');
  }

  private releasePort(): void {
    this.stopPing();
    const client = this.client;
    this.client = null;
    this._connectedApp = null;
    this.lastNavigationState = null;
    client?.close();
    if (this.connectionManager.sdkConnected) this.connectionManager.sdkConnected = false;
    this.wss?.close();
    this.wss = null;
  }

  private handleMessage(msg: SDKToServerMessage): void {
    switch (msg.type) {
      case 'handshake':
        this._connectedApp = (msg.payload.appName as string | undefined) ?? null;
        logger.info(
          `SDK handshake: v${msg.payload.sdkVersion}` +
            (this._connectedApp ? ` app=${this._connectedApp}` : ''),
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

      case 'pong':
        break;

      default:
        this.emit('sdk-message', msg);
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

  /** Asks the on-device SDK to navigate — tapfix uses it to return to a report's screen after a reload. */
  navigate(name: string, params?: Record<string, unknown>): boolean {
    if (!this.client) return false;
    this.sendToClient({
      type: 'request:navigate',
      payload: { name, params },
      timestamp: Date.now(),
      id: `nav-go-${Date.now()}`,
    });
    return true;
  }

  private requestNavigationState(): void {
    this.sendToClient({
      type: 'request:navigation-state',
      payload: {},
      timestamp: Date.now(),
      id: `nav-req-${Date.now()}`,
    });
  }

  /** Sends a message to the connected SDK client (public: extensions reply through here). */
  sendToClient(msg: Record<string, unknown>): void {
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
    this.releasePort();
  }
}
