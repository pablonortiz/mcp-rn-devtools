import type { SDKMessage } from '@mcp-rn-devtools/shared';
import type { WSClient } from '../bridge/ws-client.js';
import { uuid } from '../utils/uuid.js';

type ConsoleMethod = 'log' | 'info' | 'debug' | 'warn' | 'error';

const METHODS: ConsoleMethod[] = ['log', 'info', 'debug', 'warn', 'error'];

function formatArg(arg: unknown): string {
  if (arg === undefined) return 'undefined';
  if (arg === null) return 'null';
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
  try {
    return JSON.stringify(arg, null, 2)?.substring(0, 2048) ?? String(arg);
  } catch {
    return String(arg);
  }
}

export function installConsoleInterceptor(client: WSClient): () => void {
  const originals = new Map<ConsoleMethod, (...args: unknown[]) => void>();

  for (const method of METHODS) {
    const original = console[method];
    if (typeof original !== 'function') continue;

    originals.set(method, original);

    console[method] = (...args: unknown[]) => {
      // Always call original first
      original.apply(console, args);

      const message = args.map(formatArg).join(' ');

      // For warn/error, also send as error:report for ErrorManager
      if (method === 'error') {
        const errorMsg: SDKMessage = {
          type: 'error:report',
          payload: {
            error: {
              id: `sdk-err-${uuid()}`,
              timestamp: Date.now(),
              message,
              isFatal: false,
            },
          },
          timestamp: Date.now(),
          id: uuid(),
        };
        client.send(errorMsg);
      }

      // Map console methods to LogLevel
      const level = method === 'error' ? 'error' : method === 'warn' ? 'warn' : method;

      const msg: SDKMessage = {
        type: 'console:log',
        payload: {
          entry: {
            id: `sdk-log-${uuid()}`,
            timestamp: Date.now(),
            level,
            message,
            args: args.map((a) => {
              try {
                return typeof a === 'object' ? JSON.parse(JSON.stringify(a)) : a;
              } catch {
                return String(a);
              }
            }),
          },
        },
        timestamp: Date.now(),
        id: uuid(),
      };
      client.send(msg);
    };
  }

  return () => {
    for (const [method, original] of originals) {
      console[method] = original;
    }
  };
}
