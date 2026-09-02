import type { ConsoleLogEntry, LogLevel } from '@mcp-rn-devtools/shared';
import { LOG_BUFFER_SIZE } from '@mcp-rn-devtools/shared';
import { formatConsoleArgs, type ConsoleArg } from '../cdp/console-args.js';
import { ReplayFilter } from './replay-filter.js';

// Hermes prints this into the app console for every debugger that is not React
// Native DevTools — once per connection, pure noise for the reader.
const HERMES_CLIENT_NOTICE = /NOTE:\s*You are using an unsupported debugging client/;

export function isHermesClientNotice(message: string): boolean {
  return HERMES_CLIENT_NOTICE.test(message);
}

export class LogManager {
  private buffer: ConsoleLogEntry[] = [];
  private idCounter = 0;
  private replay = new ReplayFilter();

  addFromCDP(params: {
    type: string;
    args: Array<ConsoleArg & { preview?: unknown }>;
    stackTrace?: { callFrames: Array<{ functionName: string; url: string; lineNumber: number; columnNumber: number; scriptId: string }> };
    timestamp: number;
  }): ConsoleLogEntry | null {
    const level = this.mapCDPType(params.type);
    if (!level) return null;

    // Skip error/warn — those go to ErrorManager
    if (level === 'error' || level === 'warn') return null;

    const message = formatConsoleArgs(params.args);
    if (isHermesClientNotice(message)) return null;
    if (this.replay.isDuplicate({ timestamp: params.timestamp, message })) return null;

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
    entry.receivedAt = Date.now();
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
}
