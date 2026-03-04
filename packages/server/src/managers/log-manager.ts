import type { ConsoleLogEntry, LogLevel, StackFrame } from '@mcp-rn-devtools/shared';
import { LOG_BUFFER_SIZE } from '@mcp-rn-devtools/shared';

export class LogManager {
  private buffer: ConsoleLogEntry[] = [];
  private idCounter = 0;

  addFromCDP(params: {
    type: string;
    args: Array<{ type: string; value?: unknown; description?: string; preview?: unknown }>;
    stackTrace?: { callFrames: Array<{ functionName: string; url: string; lineNumber: number; columnNumber: number; scriptId: string }> };
    timestamp: number;
  }): ConsoleLogEntry | null {
    const level = this.mapCDPType(params.type);
    if (!level) return null;

    // Skip error/warn — those go to ErrorManager
    if (level === 'error' || level === 'warn') return null;

    const message = this.formatArgs(params.args);
    const entry: ConsoleLogEntry = {
      id: `cdp-log-${++this.idCounter}`,
      timestamp: params.timestamp,
      level,
      message,
      args: params.args.map((a) => a.value ?? a.description ?? `[${a.type}]`),
      stackTrace: params.stackTrace?.callFrames?.map((f) => ({
        functionName: f.functionName,
        url: f.url,
        lineNumber: f.lineNumber,
        columnNumber: f.columnNumber,
        scriptId: f.scriptId,
      })),
      source: 'cdp',
    };

    this.push(entry);
    return entry;
  }

  addFromSDK(entry: Omit<ConsoleLogEntry, 'source'>): void {
    this.push({ ...entry, source: 'sdk' });
  }

  getLogs(options?: {
    level?: LogLevel;
    search?: string;
    limit?: number;
    since?: number;
  }): ConsoleLogEntry[] {
    let entries = [...this.buffer];

    if (options?.since) {
      entries = entries.filter((e) => e.timestamp >= options.since!);
    }
    if (options?.level) {
      entries = entries.filter((e) => e.level === options.level);
    }
    if (options?.search) {
      const s = options.search.toLowerCase();
      entries = entries.filter((e) => e.message.toLowerCase().includes(s));
    }
    if (options?.limit) {
      entries = entries.slice(-options.limit);
    }

    return entries;
  }

  clear(): void {
    this.buffer = [];
  }

  get count(): number {
    return this.buffer.length;
  }

  private push(entry: ConsoleLogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length > LOG_BUFFER_SIZE) {
      this.buffer.shift();
    }
  }

  private mapCDPType(type: string): LogLevel | null {
    switch (type) {
      case 'log':
        return 'log';
      case 'info':
        return 'info';
      case 'debug':
        return 'debug';
      case 'warning':
        return 'warn';
      case 'error':
        return 'error';
      default:
        return 'log';
    }
  }

  private formatArgs(
    args: Array<{ type: string; value?: unknown; description?: string }>,
  ): string {
    return args
      .map((a) => {
        if (a.value !== undefined) {
          return typeof a.value === 'string' ? a.value : JSON.stringify(a.value);
        }
        return a.description ?? `[${a.type}]`;
      })
      .join(' ');
  }
}
