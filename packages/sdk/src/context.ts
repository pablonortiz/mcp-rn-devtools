import { createContext } from 'react';
import type { WSClient } from './bridge/ws-client.js';

export interface DevtoolsContextValue {
  connected: boolean;
  client: WSClient | null;
}

export const DevtoolsContext = createContext<DevtoolsContextValue>({
  connected: false,
  client: null,
});
