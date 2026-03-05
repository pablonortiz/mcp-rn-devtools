import type { SDKMessage } from '@mcp-rn-devtools/shared';
import type { WSClient } from '../bridge/ws-client.js';
import { uuid } from '../utils/uuid.js';

interface ErrorUtils {
  getGlobalHandler(): (error: Error, isFatal: boolean) => void;
  setGlobalHandler(handler: (error: Error, isFatal: boolean) => void): void;
}

declare const global: {
  ErrorUtils?: ErrorUtils;
};

export function installErrorInterceptor(client: WSClient): () => void {
  const cleanups: Array<() => void> = [];

  // 1. React Native ErrorUtils (catches JS exceptions, RedBox errors)
  const errorUtils = typeof global !== 'undefined' ? global.ErrorUtils : undefined;
  if (errorUtils) {
    const originalHandler = errorUtils.getGlobalHandler();

    errorUtils.setGlobalHandler((error: Error, isFatal: boolean) => {
      const msg: SDKMessage = {
        type: 'error:report',
        payload: {
          error: {
            id: `sdk-err-${uuid()}`,
            timestamp: Date.now(),
            message: error.message || String(error),
            isFatal,
            stack: error.stack ? parseStack(error.stack) : undefined,
          },
        },
        timestamp: Date.now(),
        id: uuid(),
      };
      client.send(msg);

      // Call original handler
      if (originalHandler) {
        originalHandler(error, isFatal);
      }
    });

    cleanups.push(() => {
      if (originalHandler) {
        errorUtils.setGlobalHandler(originalHandler);
      }
    });
  }

  // 2. Unhandled promise rejections
  const onUnhandledRejection = (event: { reason?: unknown }) => {
    const reason = event?.reason;
    const message = reason instanceof Error
      ? reason.message
      : typeof reason === 'string'
        ? reason
        : 'Unhandled promise rejection';

    const stack = reason instanceof Error && reason.stack
      ? parseStack(reason.stack)
      : undefined;

    const msg: SDKMessage = {
      type: 'error:report',
      payload: {
        error: {
          id: `sdk-err-${uuid()}`,
          timestamp: Date.now(),
          message: `[Promise] ${message}`,
          isFatal: false,
          stack,
        },
      },
      timestamp: Date.now(),
      id: uuid(),
    };
    client.send(msg);
  };

  if (typeof globalThis !== 'undefined' && typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('unhandledrejection', onUnhandledRejection as EventListener);
    cleanups.push(() => {
      globalThis.removeEventListener('unhandledrejection', onUnhandledRejection as EventListener);
    });
  }

  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}

function parseStack(stack: string): Array<{
  functionName?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
}> {
  const frames: Array<{
    functionName?: string;
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  }> = [];

  for (const line of stack.split('\n').slice(1, 10)) {
    const match = line.match(/^\s*at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/) ||
                  line.match(/^\s*at\s+(.+?):(\d+):(\d+)/);
    if (match) {
      if (match.length === 5) {
        frames.push({
          functionName: match[1],
          url: match[2],
          lineNumber: parseInt(match[3], 10),
          columnNumber: parseInt(match[4], 10),
        });
      } else if (match.length === 4) {
        frames.push({
          url: match[1],
          lineNumber: parseInt(match[2], 10),
          columnNumber: parseInt(match[3], 10),
        });
      }
    }
  }

  return frames;
}
