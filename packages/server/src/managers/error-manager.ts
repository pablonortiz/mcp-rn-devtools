import type { ErrorEntry, StackFrame } from '@mcp-rn-devtools/shared';
import { ERROR_BUFFER_SIZE } from '@mcp-rn-devtools/shared';

export class ErrorManager {
  private errors: ErrorEntry[] = [];
  private warnings: ErrorEntry[] = [];
  private idCounter = 0;

  addFromCDP(params: {
    type: string;
    args: Array<{ type: string; value?: unknown; description?: string }>;
    stackTrace?: { callFrames: Array<{ functionName: string; url: string; lineNumber: number; columnNumber: number; scriptId: string }> };
    timestamp: number;
  }): void {
    if (params.type === 'error') {
      const message = this.formatArgs(params.args);
      const entry: ErrorEntry = {
        id: `cdp-err-${++this.idCounter}`,
        timestamp: params.timestamp,
        message,
        stack: params.stackTrace?.callFrames?.map((f) => ({
          functionName: f.functionName,
          url: f.url,
          lineNumber: f.lineNumber,
          columnNumber: f.columnNumber,
          scriptId: f.scriptId,
        })),
        isFatal: false,
        source: 'cdp',
      };
      this.pushError(entry);
    } else if (params.type === 'warning') {
      const message = this.formatArgs(params.args);
      const entry: ErrorEntry = {
        id: `cdp-warn-${++this.idCounter}`,
        timestamp: params.timestamp,
        message,
        stack: params.stackTrace?.callFrames?.map((f) => ({
          functionName: f.functionName,
          url: f.url,
          lineNumber: f.lineNumber,
          columnNumber: f.columnNumber,
          scriptId: f.scriptId,
        })),
        isFatal: false,
        source: 'cdp',
      };
      this.pushWarning(entry);
    }
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
    this.errors.push(entry);
    if (this.errors.length > ERROR_BUFFER_SIZE) {
      this.errors.shift();
    }
  }

  private pushWarning(entry: ErrorEntry): void {
    this.warnings.push(entry);
    if (this.warnings.length > ERROR_BUFFER_SIZE) {
      this.warnings.shift();
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
