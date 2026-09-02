import type { ConnectionManager } from './managers/connection-manager.js';
import type { SDKBridgeServer } from './sdk-bridge/sdk-server.js';

const RECLAIM_BACKOFF_MS = 30_000;

/**
 * Hermes admits one debugger. Instead of the newest process owning it forever,
 * the debugger follows whoever is being used: before a tool runs, this instance
 * takes the SDK port back from any sibling (which yields and suspends) and
 * connects on demand.
 */
export class ConnectionOwnership {
  private lastFailedReclaim = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly sdkBridge: SDKBridgeServer,
  ) {}

  /** Serialized: parallel tool calls must not race each other for the port. */
  ensure(options: { connect?: boolean } = {}): Promise<void> {
    const run = this.queue.then(() => this.claim(options));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async claim(options: { connect?: boolean }): Promise<void> {
    if (!this.sdkBridge.holdsPort && this.canRetryReclaim()) {
      const reclaimed = await this.sdkBridge.reclaim();
      this.lastFailedReclaim = reclaimed ? 0 : Date.now();
    }
    if (options.connect !== false && !this.connectionManager.connected) {
      await this.connectionManager.connect();
    }
  }

  /** A pre-0.3 holder never yields; asking on every call would stall each tool for the takeover timeout. */
  private canRetryReclaim(): boolean {
    return Date.now() - this.lastFailedReclaim >= RECLAIM_BACKOFF_MS;
  }
}
