import type { ConnectionManager, ResolvedTarget } from './managers/connection-manager.js';
import type { SDKBridgeServer } from './sdk-bridge/sdk-server.js';
import type { CDPTarget } from './cdp/discovery.js';
import { targetKey } from './cdp/target-key.js';
import type { InstanceRegistry } from './ownership/instance-registry.js';
import { requestYield, type YieldAnswer } from './ownership/control-server.js';
import { logger } from './utils/logger.js';

const LEGACY_BACKOFF_MS = 30_000;

export interface OwnershipDeps {
  connectionManager: ConnectionManager;
  sdkBridge: SDKBridgeServer;
  registry: InstanceRegistry;
  instanceId: string;
}

/**
 * Hermes admits one debugger per app instance. Ownership is per target: before
 * a tool runs, this instance resolves the app it wants, asks whoever holds
 * that target (and only that one) to yield, connects, and records itself in
 * the registry. Sessions on other apps are never disturbed. Instances that
 * predate the registry are handled through the SDK-port takeover they speak.
 */
export class ConnectionOwnership {
  private queue: Promise<void> = Promise.resolve();
  private lastFailedLegacy = 0;
  private lastKey: string | null = null;

  constructor(private readonly deps: OwnershipDeps) {
    const { connectionManager: cm, sdkBridge, registry } = deps;
    cm.on('connecting', (target: CDPTarget, metroPort: number) => {
      registry.update({ target: this.describe(target, metroPort, 'connecting') });
    });
    cm.on('connected', (target: CDPTarget) => {
      this.lastKey = targetKey(target);
      registry.update({ target: this.describe(target, cm.metroPort, 'connected') });
    });
    cm.on('disconnected', () => registry.update({ target: null }));
    cm.on('suspended', () => registry.update({ target: null }));
    sdkBridge.on('bound', () => registry.update({ sdkPort: sdkBridge.port }));
    sdkBridge.on('yielded', () => registry.update({ sdkPort: null }));
    cm.setReconnectGuard(() => this.mayReconnect());
  }

  /** Serialized: parallel tool calls must not race each other for a target. */
  ensure(): Promise<void> {
    return this.enqueue(() => this.claim());
  }

  /** Takes a specific target away from whoever holds it, without connecting (select_target connects and pins). */
  claimTarget(resolved: ResolvedTarget): Promise<void> {
    return this.enqueue(() => this.takeOver(resolved));
  }

  /** Answer to another instance's yield request, from the control endpoint. */
  handleYieldRequest(key: string, from: string): YieldAnswer {
    if (from === this.deps.instanceId) return 'declined';
    const cm = this.deps.connectionManager;
    const held = cm.currentTargetKey ?? (cm.connectingTarget ? targetKey(cm.connectingTarget) : null);
    if (held !== key) return 'declined';
    logger.info(`Yielding ${key} to instance ${from.slice(0, 8)} — reclaimed on this instance's next tool call`);
    cm.suspend();
    return 'yielded';
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async claim(): Promise<void> {
    const cm = this.deps.connectionManager;
    if (cm.connected) return;
    const resolved = await cm.resolveTarget();
    if (!resolved) {
      await cm.connect();
      return;
    }
    await this.takeOver(resolved);
    await cm.connect(resolved);
  }

  private async takeOver(resolved: ResolvedTarget): Promise<void> {
    const key = targetKey(resolved.target);
    const holder = this.deps.registry.holderOf(key);
    if (holder?.controlPort) {
      const outcome = await requestYield(holder.controlPort, key, this.deps.instanceId);
      logger.info(`Asked ${holder.label} (pid ${holder.pid}) to yield ${resolved.target.appId ?? key}: ${outcome}`);
      return;
    }
    await this.legacyTakeoverIfNeeded();
  }

  /**
   * Instances without a registry entry (pre-0.5) treat the SDK port as the
   * ownership token and yield everything when asked for it over that port.
   */
  private async legacyTakeoverIfNeeded(): Promise<void> {
    const { sdkBridge, registry } = this.deps;
    if (sdkBridge.holdsPort) return;
    if (registry.enabled && registry.sdkPortHolder(sdkBridge.port)) return;
    if (Date.now() - this.lastFailedLegacy < LEGACY_BACKOFF_MS) return;
    const reclaimed = await sdkBridge.reclaim();
    this.lastFailedLegacy = reclaimed ? 0 : Date.now();
  }

  /** After Hermes drops us because a sibling attached, do not fight back — the next tool call reclaims. */
  private mayReconnect(): boolean {
    if (!this.lastKey) return true;
    const holder = this.deps.registry.holderOf(this.lastKey);
    if (holder?.target?.state !== 'connected') return true;
    logger.info(`Target now held by ${holder.label} (pid ${holder.pid}) — not reconnecting until this instance is used again`);
    return false;
  }

  private describe(target: CDPTarget, metroPort: number, state: 'connecting' | 'connected') {
    return {
      key: targetKey(target),
      appId: target.appId ?? target.title,
      deviceName: target.deviceName ?? '',
      metroPort,
      targetId: target.id,
      state,
    };
  }
}
