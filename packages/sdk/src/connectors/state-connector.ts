import type { SDKMessage } from '@mcp-rn-devtools/shared';
import type { WSClient } from '../bridge/ws-client.js';
import { uuid } from '../utils/uuid.js';

export interface StateStore {
  getState(): unknown;
  subscribe(listener: () => void): () => void;
}

/**
 * Pull-only state channel: snapshots are serialized and sent ONLY when the
 * server asks (request:state). Nothing is pushed on state changes, so the
 * app pays zero serialization cost while nobody is inspecting it.
 */
export function connectStateManager(
  store: StateStore,
  client: WSClient,
  name: string,
): () => void {
  const sendSnapshot = (requestId?: string) => {
    try {
      const msg: SDKMessage = {
        type: 'state:snapshot',
        payload: {
          snapshot: {
            name,
            state: store.getState(),
            timestamp: Date.now(),
          },
          requestId,
        },
        timestamp: Date.now(),
        id: uuid(),
      };
      client.send(msg);
    } catch {
      // ignore serialization errors
    }
  };

  return client.onMessage((msg) => {
    if (msg.type === 'request:state') {
      const payload = msg.payload as { name?: string; requestId?: string };
      if (!payload.name || payload.name === name) {
        sendSnapshot(payload.requestId);
      }
    }
  });
}
