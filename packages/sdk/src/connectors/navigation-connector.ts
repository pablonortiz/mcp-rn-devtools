import type { NavigationState, SDKMessage } from '@mcp-rn-devtools/shared';
import type { WSClient } from '../bridge/ws-client.js';
import { uuid } from '../utils/uuid.js';

interface NavigationContainerRef {
  getRootState: () => any;
  getCurrentRoute: () => { name: string; key: string; params?: Record<string, unknown> } | undefined;
  addListener: (event: string, callback: (...args: any[]) => void) => () => void;
}

function extractState(ref: NavigationContainerRef): NavigationState | null {
  try {
    const rootState = ref.getRootState();
    if (!rootState) return null;

    const currentRoute = ref.getCurrentRoute();
    if (!currentRoute) return null;

    const routes: Array<{ name: string; key: string; params?: Record<string, unknown> }> =
      (rootState.routes ?? []).map((r: any) => ({
        name: r.name,
        key: r.key,
        params: r.params,
      }));

    return {
      currentRoute: {
        name: currentRoute.name,
        key: currentRoute.key,
        params: currentRoute.params,
      },
      stack: routes,
      index: rootState.index ?? 0,
      type: rootState.type ?? 'unknown',
      stale: rootState.stale ?? false,
    };
  } catch {
    return null;
  }
}

export function connectNavigation(
  ref: NavigationContainerRef,
  client: WSClient,
): () => void {
  const sendState = () => {
    const state = extractState(ref);
    if (!state) return;

    const msg: SDKMessage = {
      type: 'navigation:state',
      payload: { state },
      timestamp: Date.now(),
      id: uuid(),
    };
    client.send(msg);
  };

  // Send initial state
  sendState();

  // Listen for state changes
  const unsubscribe = ref.addListener('state', () => {
    sendState();
  });

  // Listen for server requests for navigation state
  const unsubscribeMessages = client.onMessage((msg) => {
    if (msg.type === 'request:navigation-state') {
      sendState();
    }
  });

  return () => {
    unsubscribe();
    unsubscribeMessages();
  };
}
