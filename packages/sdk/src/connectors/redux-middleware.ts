import type { SDKMessage } from '@mcp-rn-devtools/shared';
import type { WSClient } from '../bridge/ws-client.js';
import { uuid } from '../utils/uuid.js';

let actionCounter = 0;
const MAX_BUFFER = 100;

export interface DevtoolsMiddleware {
  // The Redux middleware function
  (storeAPI: { getState: () => unknown }): (next: (action: unknown) => unknown) => (action: unknown) => unknown;
  /** @internal Called by RNDevtoolsProvider to attach the WebSocket client */
  _attachClient(client: WSClient): void;
  /** @internal Called by RNDevtoolsProvider on unmount */
  _detachClient(): void;
}

/**
 * Creates a Redux middleware that logs dispatched actions to the devtools server.
 * The middleware works without a client initially — it buffers actions until
 * RNDevtoolsProvider connects it automatically.
 *
 * Usage:
 * ```ts
 * import { createDevtoolsMiddleware } from 'mcp-rn-devtools-sdk';
 *
 * const devtoolsMiddleware = createDevtoolsMiddleware('main');
 * const store = configureStore({
 *   middleware: (getDefault) => getDefault().concat(devtoolsMiddleware),
 * });
 *
 * // Provider auto-connects it:
 * <RNDevtoolsProvider reduxMiddlewares={[devtoolsMiddleware]}>
 * ```
 */
export function createDevtoolsMiddleware(storeName: string = 'redux'): DevtoolsMiddleware {
  let client: WSClient | null = null;
  let pendingBuffer: SDKMessage[] = [];

  const middleware: DevtoolsMiddleware = Object.assign(
    (storeAPI: { getState: () => unknown }) =>
      (next: (action: unknown) => unknown) =>
      (action: unknown) => {
        const actionObj = action as { type?: string; payload?: unknown } | undefined;
        const actionType = actionObj?.type ?? String(action);

        const stateBefore = storeAPI.getState() as Record<string, unknown> | undefined;
        const beforeKeys = stateBefore ? Object.keys(stateBefore) : [];
        const beforeSnapshot = new Map<string, unknown>();
        for (const key of beforeKeys) {
          beforeSnapshot.set(key, stateBefore?.[key]);
        }

        const start = Date.now();
        const result = next(action);
        const duration = Date.now() - start;

        const stateAfter = storeAPI.getState() as Record<string, unknown> | undefined;
        const changedKeys: string[] = [];
        if (stateAfter) {
          for (const key of Object.keys(stateAfter)) {
            if (stateAfter[key] !== beforeSnapshot.get(key)) {
              changedKeys.push(key);
            }
          }
        }

        const msg: SDKMessage = {
          type: 'redux:action',
          payload: {
            entry: {
              id: `action-${++actionCounter}`,
              actionType,
              payload: actionObj?.payload,
              timestamp: Date.now(),
              duration,
              changedKeys,
              storeName,
            },
          },
          timestamp: Date.now(),
          id: uuid(),
        };

        if (client) {
          client.send(msg);
        } else {
          pendingBuffer.push(msg);
          if (pendingBuffer.length > MAX_BUFFER) {
            pendingBuffer.shift();
          }
        }

        return result;
      },
    {
      _attachClient(c: WSClient) {
        client = c;
        // Flush buffered actions
        for (const msg of pendingBuffer) {
          client.send(msg);
        }
        pendingBuffer = [];
      },
      _detachClient() {
        client = null;
      },
    },
  );

  return middleware;
}
