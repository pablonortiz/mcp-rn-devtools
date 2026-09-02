import { stripAnsi } from '../utils/text.js';

export interface ConsoleArg {
  type: string;
  value?: unknown;
  description?: string;
}

/** Renders Runtime.consoleAPICalled args as one line, without terminal color codes. */
export function formatConsoleArgs(args: ConsoleArg[]): string {
  return stripAnsi(
    args
      .map((arg) => {
        if (arg.value !== undefined) {
          return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
        }
        return arg.description ?? `[${arg.type}]`;
      })
      .join(' '),
  );
}
