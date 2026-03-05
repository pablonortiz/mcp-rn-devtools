import { EventEmitter } from 'events';
import {
  DEFAULT_METRO_PORT,
} from '@mcp-rn-devtools/shared';
import { CDPConnection } from '../cdp/connection.js';
import { discoverTargets, findHermesTarget } from '../cdp/discovery.js';
import { LogManager } from './log-manager.js';
import { ErrorManager } from './error-manager.js';
import { NetworkManager } from './network-manager.js';
import { PerformanceManager } from './performance-manager.js';
import { RenderManager } from './render-manager.js';
import { StateManager } from './state-manager.js';
import { StorageManager } from './storage-manager.js';
import { SourceMapManager } from './sourcemap-manager.js';
import { ActionManager } from './action-manager.js';
import { NavigationTimingManager } from './navigation-timing-manager.js';
import { logger } from '../utils/logger.js';

export class ConnectionManager extends EventEmitter {
  readonly cdp = new CDPConnection();
  readonly logManager = new LogManager();
  readonly errorManager = new ErrorManager();
  readonly networkManager = new NetworkManager();
  readonly performanceManager = new PerformanceManager();
  readonly renderManager = new RenderManager();
  readonly stateManager = new StateManager();
  readonly storageManager = new StorageManager();
  readonly sourcemapManager: SourceMapManager;
  readonly actionManager = new ActionManager();
  readonly navigationTimingManager = new NavigationTimingManager();

  private _metroPort: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private startTime = Date.now();
  private _sdkConnected = false;

  constructor(metroPort: number = DEFAULT_METRO_PORT) {
    super();
    this._metroPort = metroPort;
    this.sourcemapManager = new SourceMapManager(metroPort);
    this.setupCDPListeners();
  }

  get metroPort(): number {
    return this._metroPort;
  }

  get connected(): boolean {
    return this.cdp.connected;
  }

  get sdkConnected(): boolean {
    return this._sdkConnected;
  }

  set sdkConnected(value: boolean) {
    this._sdkConnected = value;
    this.networkManager.setSDKConnected(value);
  }

  get uptime(): number {
    return Date.now() - this.startTime;
  }

  async connect(): Promise<void> {
    try {
      const targets = await discoverTargets(this.metroPort);
      const target = findHermesTarget(targets);

      if (!target) {
        logger.warn(
          'No Hermes target found. Is a React Native app running with Metro on port ' +
            this.metroPort +
            '?',
        );
        this.startReconnectPolling();
        return;
      }

      logger.info(`Connecting to: ${target.title} (${target.id})`);
      await this.cdp.connect(target.webSocketDebuggerUrl, this.metroPort);

      // Enable Debugger to transition Hermes from RunningDetached → Running.
      // Without this, Runtime.evaluate, HeapProfiler, and console events don't work.
      await this.cdp.send('Debugger.enable');
      // Enable Runtime to get console messages (triggers replay of buffered messages)
      await this.cdp.send('Runtime.enable');
      logger.info('Debugger + Runtime enabled — Hermes in Running state');

      // Inject network interceptor
      await this.networkManager.injectInterceptor(this.cdp);
      this.networkManager.startPolling(this.cdp);
    } catch (e) {
      logger.warn('Failed to connect to RN app, will retry...', (e as Error).message);
      this.startReconnectPolling();
    }
  }

  private setupCDPListeners(): void {
    this.cdp.on('Runtime.consoleAPICalled', (params: {
      type: string;
      args: Array<{ type: string; value?: unknown; description?: string }>;
      stackTrace?: { callFrames: Array<{ functionName: string; url: string; lineNumber: number; columnNumber: number; scriptId: string }> };
      timestamp: number;
    }) => {
      // Route errors and warnings to ErrorManager
      if (params.type === 'error' || params.type === 'warning') {
        this.errorManager.addFromCDP(params);
      }

      // Route non-error/warning to LogManager (it filters internally too)
      this.logManager.addFromCDP(params);
    });

    this.cdp.on('disconnected', () => {
      this.networkManager.stopPolling();
      this.startReconnectPolling();
    });
  }

  private reconnectDelay = 1000;
  private static readonly MIN_RECONNECT_DELAY = 1000;
  private static readonly MAX_RECONNECT_DELAY = 30000;

  private startReconnectPolling(): void {
    if (this.reconnectTimer) return;

    this.reconnectDelay = ConnectionManager.MIN_RECONNECT_DELAY;
    logger.info('Starting reconnection with exponential backoff...');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      try {
        const targets = await discoverTargets(this.metroPort);
        const target = findHermesTarget(targets);
        if (target) {
          logger.info('Target found, reconnecting...');
          await this.cdp.connect(target.webSocketDebuggerUrl, this.metroPort);
          await this.cdp.send('Debugger.enable');
          await this.cdp.send('Runtime.enable');
          await this.networkManager.injectInterceptor(this.cdp);
          this.networkManager.startPolling(this.cdp);
          // Reset delay on successful reconnect
          this.reconnectDelay = ConnectionManager.MIN_RECONNECT_DELAY;
          // Invalidate source map cache on reconnect (bundle may have changed)
          this.sourcemapManager.invalidate();
          return;
        }
      } catch {
        // Will retry
      }

      // Exponential backoff: double delay up to max
      this.reconnectDelay = Math.min(
        this.reconnectDelay * 2,
        ConnectionManager.MAX_RECONNECT_DELAY,
      );
      logger.debug(`CDP reconnect retry in ${this.reconnectDelay}ms`);
      this.scheduleReconnect();
    }, this.reconnectDelay);
  }

  private stopReconnectPolling(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  shutdown(): void {
    this.stopReconnectPolling();
    this.networkManager.stopPolling();
    this.cdp.disconnect();
  }
}
