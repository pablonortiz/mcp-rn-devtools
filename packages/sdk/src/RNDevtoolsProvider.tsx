import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { isDev } from './utils/dev-guard.js';
import { WSClient } from './bridge/ws-client.js';
import { installNetworkInterceptor } from './interceptors/network-interceptor.js';
import { connectNavigation } from './connectors/navigation-connector.js';
import { createProfilerCallback } from './connectors/profiler-connector.js';
import { connectStateManager, type StateStore } from './connectors/state-connector.js';
import { connectAsyncStorage, connectMMKV, type AsyncStorageLike, type MMKVLike } from './connectors/storage-connector.js';
import type { DevtoolsMiddleware } from './connectors/redux-middleware.js';
import { DevtoolsContext } from './context.js';
import { SDK_WS_PORT } from '@mcp-rn-devtools/shared';

interface NavigationContainerRef {
  getRootState: () => any;
  getCurrentRoute: () => { name: string; key: string; params?: Record<string, unknown> } | undefined;
  addListener: (event: string, callback: (...args: any[]) => void) => () => void;
}

export interface RNDevtoolsProviderProps {
  children: ReactNode;
  navigationRef?: React.RefObject<NavigationContainerRef | null>;
  /** WebSocket port on the dev machine. Default: 8098 */
  port?: number;
  /** Override the dev machine host. Auto-detected: `localhost` on iOS, `10.0.2.2` on Android emulator. */
  host?: string;
  /** Redux/Zustand stores for state inspection. Keys are store names. */
  stateManagers?: Record<string, StateStore>;
  /** AsyncStorage instance for storage reading */
  asyncStorage?: AsyncStorageLike;
  /** MMKV instance for storage reading */
  mmkv?: MMKVLike;
  /** Redux devtools middlewares to auto-connect. Created via createDevtoolsMiddleware(). */
  reduxMiddlewares?: DevtoolsMiddleware[];
}

function DevtoolsProviderInner({
  children,
  navigationRef,
  port = SDK_WS_PORT,
  host,
  stateManagers,
  asyncStorage,
  mmkv,
  reduxMiddlewares,
}: RNDevtoolsProviderProps) {
  const clientRef = useRef<WSClient | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const client = new WSClient(port, host);
    clientRef.current = client;

    // Install network interceptor
    const uninstallNetwork = installNetworkInterceptor(client);

    // Connect
    client.connect();

    // Poll connected state
    const interval = setInterval(() => {
      setConnected(client.connected);
    }, 1000);

    return () => {
      clearInterval(interval);
      uninstallNetwork();
      client.disconnect();
      clientRef.current = null;
    };
  }, [port, host]);

  // Navigation connector
  useEffect(() => {
    const client = clientRef.current;
    if (!client || !navigationRef?.current) return;

    const disconnect = connectNavigation(navigationRef.current, client);
    return disconnect;
  }, [navigationRef, connected]);

  // State manager connectors
  useEffect(() => {
    const client = clientRef.current;
    if (!client || !connected || !stateManagers) return;

    const disconnectors: Array<() => void> = [];
    for (const [name, store] of Object.entries(stateManagers)) {
      disconnectors.push(connectStateManager(store, client, name));
    }
    return () => disconnectors.forEach((d) => d());
  }, [stateManagers, connected]);

  // AsyncStorage connector
  useEffect(() => {
    const client = clientRef.current;
    if (!client || !connected || !asyncStorage) return;

    return connectAsyncStorage(asyncStorage, client);
  }, [asyncStorage, connected]);

  // MMKV connector
  useEffect(() => {
    const client = clientRef.current;
    if (!client || !connected || !mmkv) return;

    return connectMMKV(mmkv, client);
  }, [mmkv, connected]);

  // Redux middleware auto-connect
  useEffect(() => {
    const client = clientRef.current;
    if (!client || !connected || !reduxMiddlewares?.length) return;

    for (const mw of reduxMiddlewares) {
      mw._attachClient(client);
    }
    return () => {
      for (const mw of reduxMiddlewares) {
        mw._detachClient();
      }
    };
  }, [reduxMiddlewares, connected]);

  // Profiler callback for root-level tracking
  const profilerCallback = React.useMemo(() => {
    const client = clientRef.current;
    if (!client) return undefined;
    return createProfilerCallback(client);
  }, [connected]);

  const wrappedChildren = profilerCallback
    ? React.createElement(React.Profiler, { id: 'Root', onRender: profilerCallback }, children)
    : children;

  return (
    <DevtoolsContext.Provider value={{ connected, client: clientRef.current }}>
      {wrappedChildren}
    </DevtoolsContext.Provider>
  );
}

export function RNDevtoolsProvider(props: RNDevtoolsProviderProps) {
  if (!isDev()) {
    return <>{props.children}</>;
  }

  return <DevtoolsProviderInner {...props} />;
}
