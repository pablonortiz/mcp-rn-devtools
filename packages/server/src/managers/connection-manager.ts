import { EventEmitter } from 'events';
import {
  DEFAULT_METRO_PORT,
  RECONNECT_INTERVAL_MS,
  MAX_RECONNECT_ATTEMPTS,
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

  private _metroPort: number;
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;
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

      // Enable Runtime to get console messages (triggers replay of buffered messages)
      await this.cdp.send('Runtime.enable');
      logger.info('Runtime.enable sent — listening for console events');

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

  private startReconnectPolling(): void {
    if (this.reconnectTimer) return;

    let attempts = 0;
    logger.info('Starting reconnection polling...');

    this.reconnectTimer = setInterval(async () => {
      attempts++;
      if (attempts > MAX_RECONNECT_ATTEMPTS) {
        logger.warn('Max reconnect attempts reached. Stopping polling.');
        this.stopReconnectPolling();
        return;
      }

      try {
        const targets = await discoverTargets(this.metroPort);
        const target = findHermesTarget(targets);
        if (target) {
          this.stopReconnectPolling();
          logger.info('Target found, reconnecting...');
          await this.cdp.connect(target.webSocketDebuggerUrl, this.metroPort);
          await this.cdp.send('Runtime.enable');
          await this.networkManager.injectInterceptor(this.cdp);
          this.networkManager.startPolling(this.cdp);
        }
      } catch {
        // Will retry on next interval
      }
    }, RECONNECT_INTERVAL_MS);
  }

  private stopReconnectPolling(): void {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  shutdown(): void {
    this.stopReconnectPolling();
    this.networkManager.stopPolling();
    this.cdp.disconnect();
  }
}
