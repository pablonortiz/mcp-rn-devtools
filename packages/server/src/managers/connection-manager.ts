import { EventEmitter } from 'events';
import { DEFAULT_METRO_PORT } from '@mcp-rn-devtools/shared';
import { CDPConnection } from '../cdp/connection.js';
import {
  DEFAULT_SCAN_PORTS,
  describeTarget,
  discoverTargets,
  findReactNativeTarget,
  isMainRuntimeTarget,
  probeMetro,
  scanMetroPorts,
  type CDPTarget,
} from '../cdp/discovery.js';
import { AgentBridge } from '../cdp/agent-bridge.js';
import { targetKey } from '../cdp/target-key.js';
import { matchesSessionApp } from '../session-app.js';
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

const MAX_PINNED_FAILURES = 3;

export interface ConnectionManagerOptions {
  metroPort?: number;
  /** Other Metro ports to look at when the configured one has no app (several apps in parallel). */
  scanPorts?: number[];
  /** Backoff bounds for the background reconnect loop. */
  reconnect?: { minMs?: number; maxMs?: number };
  /** App id prefixes this session works on — preferred over whatever else Metro lists. */
  sessionAppIds?: string[];
}

export interface ResolvedTarget {
  target: CDPTarget;
  metroPort: number;
  via: 'pinned' | 'session-app' | 'metro' | 'other-metro';
}

type ReconnectGuard = () => boolean | Promise<boolean>;

export class ConnectionManager extends EventEmitter {
  readonly cdp = new CDPConnection();
  readonly agentBridge = new AgentBridge();
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
  readonly scanPorts: number[];
  readonly sessionAppIds: string[];

  private _metroPort: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private startTime = Date.now();
  private _sdkConnected = false;
  private preferredTargetId: string | null = null;
  private pinnedFailures = 0;
  private _currentTarget: CDPTarget | null = null;
  private _connectingTarget: CDPTarget | null = null;
  private inFlight: Promise<boolean> | null = null;
  private epoch = 0;
  private reconnectGuard: ReconnectGuard | null = null;
  private reconnectDelay: number;
  private readonly minReconnectDelay: number;
  private readonly maxReconnectDelay: number;

  constructor(options: number | ConnectionManagerOptions = {}) {
    super();
    const resolved = typeof options === 'number' ? { metroPort: options } : options;
    this._metroPort = resolved.metroPort ?? DEFAULT_METRO_PORT;
    this.scanPorts = resolved.scanPorts ?? DEFAULT_SCAN_PORTS;
    this.sessionAppIds = resolved.sessionAppIds ?? [];
    this.minReconnectDelay = resolved.reconnect?.minMs ?? 1000;
    this.maxReconnectDelay = resolved.reconnect?.maxMs ?? 30000;
    this.reconnectDelay = this.minReconnectDelay;
    this.sourcemapManager = new SourceMapManager(this._metroPort);
    this.setupCDPListeners();
  }

  get metroPort(): number {
    return this._metroPort;
  }

  get connected(): boolean {
    return this.cdp.connected;
  }

  /** A connect() attempt is in progress. */
  get connecting(): boolean {
    return this.inFlight !== null;
  }

  get sdkConnected(): boolean {
    return this._sdkConnected;
  }

  set sdkConnected(value: boolean) {
    this._sdkConnected = value;
    this.networkManager.setSDKConnected(value);
    this.emit('sdk-connected-changed', value);
  }

  get uptime(): number {
    return Date.now() - this.startTime;
  }

  get currentTarget(): CDPTarget | null {
    return this._currentTarget;
  }

  /** Target id chosen with select_target, kept across reconnects until it fails repeatedly. */
  get pinnedTargetId(): string | null {
    return this.preferredTargetId;
  }

  /** Identity (app on device) of the attached target. */
  get currentTargetKey(): string | null {
    return this._currentTarget ? targetKey(this._currentTarget) : null;
  }

  /** Target an attach is in progress for. */
  get connectingTarget(): CDPTarget | null {
    return this._connectingTarget;
  }

  /** Consulted before a background reconnect; returning false stops the loop (a sibling holds the target). */
  setReconnectGuard(guard: ReconnectGuard | null): void {
    this.reconnectGuard = guard;
  }

  /**
   * Finds the app's runtime and attaches now — a caller wants it, so a pending
   * backoff wait is skipped. Concurrent calls (tool calls, the reconnect timer)
   * share one attempt; without a target the background reconnect keeps looking.
   */
  async connect(resolved?: ResolvedTarget): Promise<void> {
    this.stopReconnectPolling();
    const connected = await this.attempt(resolved);
    if (!connected) this.startReconnectPolling();
  }

  private attempt(resolved?: ResolvedTarget): Promise<boolean> {
    if (!this.inFlight) {
      this.inFlight = this.connectOnce(resolved).finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async connectOnce(preResolved?: ResolvedTarget): Promise<boolean> {
    if (this.cdp.connected) return true;
    const epoch = this.epoch;
    try {
      const resolved = preResolved ?? (await this.resolveTarget());
      if (!resolved) {
        logger.warn(
          'No React Native target found. Is a React Native app running with Metro on port ' +
            this.metroPort +
            '?',
        );
        return false;
      }

      this.setMetroPort(resolved.metroPort);
      await this.establishConnection(resolved.target);
      if (epoch !== this.epoch) {
        // suspend() ran while we were attaching: the debugger belongs to someone else now
        this.cdp.disconnect();
        this._currentTarget = null;
        return false;
      }
      return true;
    } catch (e) {
      logger.warn('Failed to connect to RN app, will retry...', (e as Error).message);
      this.countPinnedFailure();
      return false;
    }
  }

  /** Connects to a specific target by ID and pins it for future reconnects. */
  async connectToTarget(targetId: string, metroPort: number = this.metroPort): Promise<CDPTarget> {
    if (this.inFlight) await this.inFlight.catch(() => false);
    const targets = await discoverTargets(metroPort);
    const target = targets.find((t) => t.id === targetId);
    if (!target) {
      const available = targets.map(describeTarget).join(', ') || 'none';
      throw new Error(`Target "${targetId}" not found on Metro :${metroPort}. Available: ${available}`);
    }
    if (!isMainRuntimeTarget(target)) {
      const usable = targets.filter(isMainRuntimeTarget).map(describeTarget).join(', ') || 'none';
      throw new Error(
        `Target "${targetId}" (${target.description}) is not the app's JS runtime — ` +
          `it belongs to a library (e.g. Reanimated's UI runtime) and would hang. Use: ${usable}`,
      );
    }

    this.setMetroPort(metroPort);
    this.preferredTargetId = targetId;
    this.pinnedFailures = 0;
    this.stopReconnectPolling();
    this.cdp.disconnect();
    try {
      await this.establishConnection(target);
    } catch (e) {
      this.startReconnectPolling();
      throw e;
    }
    return target;
  }

  /** Points discovery and source maps at another Metro (parallel apps use 8082, 8083…). */
  setMetroPort(metroPort: number): void {
    if (metroPort === this._metroPort) return;
    this._metroPort = metroPort;
    this.sourcemapManager.setMetroPort(metroPort);
    this.emit('metro-port-changed', metroPort);
  }

  /**
   * Which target this instance should attach to: the pinned one, else the app
   * this session works on (searched across Metro ports — one app has no
   * ambiguity), else whatever the configured Metro serves.
   */
  async resolveTarget(): Promise<ResolvedTarget | null> {
    const { reachable, targets } = await probeMetro(this.metroPort);

    if (this.preferredTargetId) {
      const pinned = targets.find((t) => t.id === this.preferredTargetId);
      if (pinned) return { target: pinned, metroPort: this.metroPort, via: 'pinned' };
      logger.warn(`Pinned target ${this.preferredTargetId} gone, falling back to auto-select`);
      this.preferredTargetId = null;
    }

    if (this.sessionAppIds.length > 0) {
      const local = targets.filter(isMainRuntimeTarget).find((t) => matchesSessionApp(t.appId ?? t.title, this.sessionAppIds));
      if (local) return { target: local, metroPort: this.metroPort, via: 'session-app' };
      const elsewhere = await this.findTargetsForApp(this.sessionAppIds);
      if (elsewhere.length > 0) return elsewhere[0];
    }

    const auto = findReactNativeTarget(targets);
    if (auto) return { target: auto, metroPort: this.metroPort, via: 'metro' };
    // A running Metro without an app means the app is about to show up here;
    // only a dead configured port justifies looking elsewhere.
    return reachable ? null : this.pickFromAnotherMetro();
  }

  /** Main runtimes of the given app(s) across every known Metro port, configured port first. */
  async findTargetsForApp(appIds: string[]): Promise<ResolvedTarget[]> {
    const ports = [this.metroPort, ...this.scanPorts.filter((port) => port !== this.metroPort)];
    const metros = await scanMetroPorts(ports);
    return metros.flatMap((metro) =>
      metro.targets
        .filter(isMainRuntimeTarget)
        .filter((target) => matchesSessionApp(target.appId ?? target.title, appIds))
        .map((target): ResolvedTarget => ({ target, metroPort: metro.port, via: 'session-app' })),
    );
  }

  /** Switches Metro when exactly one other port has an app: unambiguous, no guessing between apps. */
  private async pickFromAnotherMetro(): Promise<ResolvedTarget | null> {
    const otherPorts = this.scanPorts.filter((port) => port !== this.metroPort);
    if (otherPorts.length === 0) return null;

    const withApp = (await scanMetroPorts(otherPorts))
      .map((metro) => ({ port: metro.port, target: findReactNativeTarget(metro.targets) }))
      .filter((metro): metro is { port: number; target: CDPTarget } => metro.target !== null);
    if (withApp.length !== 1) return null;

    logger.info(`No Metro on :${this.metroPort}, found an app on :${withApp[0].port} — switching`);
    return { target: withApp[0].target, metroPort: withApp[0].port, via: 'other-metro' };
  }

  private async establishConnection(target: CDPTarget): Promise<void> {
    logger.info(`Connecting to: ${target.title} (${target.id})`);
    this._connectingTarget = target;
    this.emit('connecting', target, this.metroPort);
    try {
      await this.cdp.connect(target.webSocketDebuggerUrl, this.metroPort);
    } finally {
      this._connectingTarget = null;
    }
    this._currentTarget = target;

    // Enable Debugger to transition Hermes from RunningDetached → Running.
    // Without this, Runtime.evaluate, HeapProfiler, and console events don't work.
    await this.cdp.send('Debugger.enable');
    // Enable Runtime to get console messages (triggers replay of buffered messages)
    await this.cdp.send('Runtime.enable');
    logger.info('Debugger + Runtime enabled — Hermes in Running state');
    this.pinnedFailures = 0;

    await this.networkManager.injectInterceptor(this.cdp);
    this.networkManager.startPolling(this.cdp);
    await this.agentBridge.inject(this.cdp);
    this.emit('connected', target);
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
      this._currentTarget = null;
      this.networkManager.detach();
      this.emit('disconnected');
      this.startReconnectPolling();
    });
  }

  private startReconnectPolling(): void {
    if (this.reconnectTimer) return;

    this.reconnectDelay = this.minReconnectDelay;
    logger.info('Starting reconnection with exponential backoff...');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      if (this.reconnectGuard && !(await this.reconnectGuard())) return;

      if (await this.attempt()) {
        this.reconnectDelay = this.minReconnectDelay;
        // Invalidate source map cache on reconnect (bundle may have changed)
        this.sourcemapManager.invalidate();
        return;
      }

      // Exponential backoff: double delay up to max
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      logger.debug(`CDP reconnect retry in ${this.reconnectDelay}ms`);
      this.scheduleReconnect();
    }, this.reconnectDelay);
  }

  /** A pinned target that keeps failing (stale id after a reload, wrong runtime) must not block auto-select forever. */
  private countPinnedFailure(): void {
    if (!this.preferredTargetId) return;
    if (++this.pinnedFailures < MAX_PINNED_FAILURES) return;
    logger.warn(`Pinned target ${this.preferredTargetId} failed ${this.pinnedFailures} times — back to auto-select`);
    this.preferredTargetId = null;
    this.pinnedFailures = 0;
  }

  private stopReconnectPolling(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Releases the debugger without ending the process (another instance took
   * over). Nothing reconnects until connect() is called again.
   */
  suspend(): void {
    this.epoch++;
    this.stopReconnectPolling();
    this.networkManager.detach();
    this.cdp.disconnect();
    this._currentTarget = null;
    this.emit('suspended');
    // Extensions treat 'shutdown' as "stop working on this session" (tapfix
    // stops its fix agent on it), which is also what a yield means for them.
    this.emit('shutdown');
  }

  shutdown(): void {
    this.suspend();
  }
}
