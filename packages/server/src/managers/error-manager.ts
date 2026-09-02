import type { ErrorEntry, StackFrame } from '@mcp-rn-devtools/shared';
import { ERROR_BUFFER_SIZE } from '@mcp-rn-devtools/shared';
import { formatConsoleArgs, type ConsoleArg } from '../cdp/console-args.js';
import { ReplayFilter } from './replay-filter.js';

interface CDPCallFrame {
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
  scriptId: string;
}

export class ErrorManager {
  private errors: ErrorEntry[] = [];
  private warnings: ErrorEntry[] = [];
  private idCounter = 0;
  private replay = new ReplayFilter();

  addFromCDP(params: {
    type: string;
    args: ConsoleArg[];
    stackTrace?: { callFrames: CDPCallFrame[] };
    timestamp: number;
  }): void {
    if (params.type !== 'error' && params.type !== 'warning') return;

    const message = formatConsoleArgs(params.args);
    if (this.replay.isDuplicate({ timestamp: params.timestamp, message })) return;

    const kind = params.type === 'error' ? 'err' : 'warn';
    const entry: ErrorEntry = {
      id: `cdp-${kind}-${++this.idCounter}`,
      timestamp: params.timestamp,
      message,
      stack: this.toStack(params.stackTrace?.callFrames),
      isFatal: false,
      source: 'cdp',
    };

    if (params.type === 'error') this.pushError(entry);
    else this.pushWarning(entry);
  }

  addErrorFromSDK(entry: Omit<ErrorEntry, 'source'>): void {
    this.pushError({ ...entry, source: 'sdk' });
  }

  addWarningFromSDK(entry: Omit<ErrorEntry, 'source'>): void {
    this.pushWarning({ ...entry, source: 'sdk' });
  }

  getErrors(options?: {
    limit?: number;
    since?: number;
    search?: string;
  }): ErrorEntry[] {
    return this.filter(this.errors, options);
  }

  getWarnings(options?: {
    limit?: number;
    since?: number;
    search?: string;
  }): ErrorEntry[] {
    return this.filter(this.warnings, options);
  }

  get errorsCount(): number {
    return this.errors.length;
  }

  get warningsCount(): number {
    return this.warnings.length;
  }

  getRecentErrors(count: number = 5): ErrorEntry[] {
    return this.errors.slice(-count);
  }

  clear(): void {
    this.errors = [];
    this.warnings = [];
  }

  private toStack(frames?: CDPCallFrame[]): StackFrame[] | undefined {
    return frames?.map((f) => ({
      functionName: f.functionName,
      url: f.url,
      lineNumber: f.lineNumber,
      columnNumber: f.columnNumber,
      scriptId: f.scriptId,
    }));
  }

  private filter(
    entries: ErrorEntry[],
    options?: { limit?: number; since?: number; search?: string },
  ): ErrorEntry[] {
    let result = [...entries];
    if (options?.since) {
      result = result.filter((e) => e.timestamp >= options.since!);
    }
    if (options?.search) {
      const s = options.search.toLowerCase();
      result = result.filter((e) => e.message.toLowerCase().includes(s));
    }
    if (options?.limit) {
      result = result.slice(-options.limit);
    }
    return result;
  }

  private pushError(entry: ErrorEntry): void {
    entry.receivedAt = Date.now();
    this.errors.push(entry);
    if (this.errors.length > ERROR_BUFFER_SIZE) {
      this.errors.shift();
    }
  }

  private pushWarning(entry: ErrorEntry): void {
    entry.receivedAt = Date.now();
    this.warnings.push(entry);
    if (this.warnings.length > ERROR_BUFFER_SIZE) {
      this.warnings.shift();
    }
  }
}
