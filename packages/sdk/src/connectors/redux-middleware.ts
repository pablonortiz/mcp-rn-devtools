import type { SDKMessage } from '@mcp-rn-devtools/shared';
import type { WSClient } from '../bridge/ws-client.js';
import { uuid } from '../utils/uuid.js';

let actionCounter = 0;

/**
 * Creates a Redux middleware that logs dispatched actions to the devtools server.
 *
 * Usage:
 * ```ts
 * import { createDevtoolsMiddleware } from 'mcp-rn-devtools-sdk';
 *
 * // In your store configuration, pass the WSClient from the DevtoolsContext:
 * const middleware = createDevtoolsMiddleware(client, 'main');
 * const store = configureStore({ middleware: (getDefault) => getDefault().concat(middleware) });
 * ```
 */
export function createDevtoolsMiddleware(client: WSClient, storeName: string = 'redux') {
  return (storeAPI: { getState: () => unknown }) =>
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
      client.send(msg);

      return result;
    };
}
