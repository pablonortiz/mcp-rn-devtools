import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { logger } from '../utils/logger.js';

export interface InstanceTarget {
  key: string;
  appId: string;
  deviceName: string;
  metroPort: number;
  targetId: string;
  state: 'connecting' | 'connected';
}

export interface InstanceRecord {
  instanceId: string;
  pid: number;
  /** What kind of server this is (mcp-rn-devtools, tapfix…). */
  label: string;
  version: string;
  cwd: string;
  controlPort: number | null;
  /** SDK channel port this instance holds, if any. */
  sdkPort: number | null;
  target: InstanceTarget | null;
  updatedAt: number;
}

export interface RegistryOptions {
  dir?: string;
  isAlive?: (pid: number) => boolean;
}

export function defaultRegistryDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.MCP_RN_STATE_DIR ?? path.join(homedir(), '.mcp-rn-devtools', 'instances');
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Who holds which app's debugger, one JSON file per live server instance.
 * No broker: the file only says whom to ask; the control endpoint is the
 * truth. Files of dead processes are pruned by whoever reads them.
 */
export class InstanceRegistry {
  readonly dir: string;
  private readonly isAlive: (pid: number) => boolean;
  private record: InstanceRecord;
  private _enabled = true;
  private closed = false;

  constructor(self: Pick<InstanceRecord, 'instanceId' | 'pid' | 'label' | 'version' | 'cwd'>, options: RegistryOptions = {}) {
    this.dir = options.dir ?? defaultRegistryDir();
    this.isAlive = options.isAlive ?? processAlive;
    this.record = { ...self, controlPort: null, sdkPort: null, target: null, updatedAt: Date.now() };
    try {
      mkdirSync(this.dir, { recursive: true });
    } catch (e) {
      this._enabled = false;
      logger.warn(`Instance registry disabled (${this.dir}: ${(e as Error).message}) — falling back to port-based ownership`);
    }
  }

  /** False when the state directory is unusable; ownership then degrades to the SDK-port token. */
  get enabled(): boolean {
    return this._enabled;
  }

  get current(): InstanceRecord {
    return this.record;
  }

  update(patch: Partial<Pick<InstanceRecord, 'controlPort' | 'sdkPort' | 'target'>>): void {
    this.record = { ...this.record, ...patch, updatedAt: Date.now() };
    if (!this._enabled || this.closed) return;
    const file = this.fileFor(this.record.instanceId);
    try {
      writeFileSync(`${file}.tmp`, JSON.stringify(this.record));
      renameSync(`${file}.tmp`, file);
    } catch (e) {
      logger.debug('Instance registry write failed', (e as Error).message);
    }
  }

  /** Final: later updates (the suspend that shutdown triggers) must not resurrect the file. */
  remove(): void {
    this.closed = true;
    if (!this._enabled) return;
    rmSync(this.fileFor(this.record.instanceId), { force: true });
    rmSync(`${this.fileFor(this.record.instanceId)}.tmp`, { force: true });
  }

  /** Live records of the other instances on this machine; stale files are deleted on the way. */
  others(): InstanceRecord[] {
    if (!this._enabled || !existsSync(this.dir)) return [];
    const records: InstanceRecord[] = [];
    for (const entry of readdirSync(this.dir)) {
      if (!entry.endsWith('.json')) continue;
      const file = path.join(this.dir, entry);
      const record = this.read(file);
      if (!record || record.instanceId === this.record.instanceId) continue;
      if (!this.isAlive(record.pid)) {
        rmSync(file, { force: true });
        continue;
      }
      records.push(record);
    }
    return records;
  }

  holderOf(key: string): InstanceRecord | null {
    return this.others().find((record) => record.target?.key === key) ?? null;
  }

  sdkPortHolder(port: number): InstanceRecord | null {
    return this.others().find((record) => record.sdkPort === port) ?? null;
  }

  private read(file: string): InstanceRecord | null {
    try {
      const record = JSON.parse(readFileSync(file, 'utf-8')) as InstanceRecord;
      return typeof record.pid === 'number' && typeof record.instanceId === 'string' ? record : null;
    } catch {
      return null;
    }
  }

  private fileFor(instanceId: string): string {
    return path.join(this.dir, `${instanceId}.json`);
  }
}
