import type { SDKMessage } from '@mcp-rn-devtools/shared';
import type { WSClient } from '../bridge/ws-client.js';
import { uuid } from '../utils/uuid.js';

export interface StateStore {
  getState(): unknown;
  subscribe(listener: () => void): () => void;
}

export function connectStateManager(
  store: StateStore,
  client: WSClient,
  name: string,
): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const sendSnapshot = () => {
    try {
      const state = store.getState();
      const msg: SDKMessage = {
        type: 'state:snapshot',
        payload: {
          snapshot: {
            name,
            state,
            timestamp: Date.now(),
          },
        },
        timestamp: Date.now(),
        id: uuid(),
      };
      client.send(msg);
    } catch {
      // ignore serialization errors
    }
  };

  // Send initial snapshot
  sendSnapshot();

  // Subscribe to state changes with debounce
  const unsubscribe = store.subscribe(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(sendSnapshot, 300);
  });

  // Listen for server requests
  const unsubscribeMessages = client.onMessage((msg) => {
    if (msg.type === 'request:state') {
      const payload = msg.payload as { name?: string };
      if (!payload.name || payload.name === name) {
        sendSnapshot();
      }
    }
  });

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    unsubscribe();
    unsubscribeMessages();
  };
}
