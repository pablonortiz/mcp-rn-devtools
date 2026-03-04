import type {
  ConsoleLogEntry,
  ErrorEntry,
  NavigationState,
  NetworkRequest,
  RenderProfileEntry,
  StateSnapshot,
  StorageBackend,
  StorageEntry,
} from './types.js';

export interface SDKMessage {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
  id: string;
}

// SDK → Server messages
export interface HandshakeMessage extends SDKMessage {
  type: 'handshake';
  payload: {
    sdkVersion: string;
    appName?: string;
    rnVersion?: string;
  };
}

export interface NetworkRequestMessage extends SDKMessage {
  type: 'network:request';
  payload: {
    request: Omit<NetworkRequest, 'source'>;
  };
}

export interface NetworkResponseMessage extends SDKMessage {
  type: 'network:response';
  payload: {
    request: Omit<NetworkRequest, 'source'>;
  };
}

export interface ConsoleLogMessage extends SDKMessage {
  type: 'console:log';
  payload: {
    entry: Omit<ConsoleLogEntry, 'source'>;
  };
}

export interface ErrorReportMessage extends SDKMessage {
  type: 'error:report';
  payload: {
    error: Omit<ErrorEntry, 'source'>;
  };
}

export interface NavigationStateMessage extends SDKMessage {
  type: 'navigation:state';
  payload: {
    state: NavigationState;
  };
}

export interface PongMessage extends SDKMessage {
  type: 'pong';
  payload: Record<string, never>;
}

// Phase 5b: Render profile (SDK → Server)
export interface RenderProfileMessage extends SDKMessage {
  type: 'render:profile';
  payload: {
    entry: RenderProfileEntry;
  };
}

// Phase 5c: State snapshot (SDK → Server)
export interface StateSnapshotMessage extends SDKMessage {
  type: 'state:snapshot';
  payload: {
    snapshot: StateSnapshot;
  };
}

// Phase 5d: Storage responses (SDK → Server)
export interface StorageKeysMessage extends SDKMessage {
  type: 'storage:keys';
  payload: {
    backend: StorageBackend;
    keys: string[];
    requestId: string;
  };
}

export interface StorageValueMessage extends SDKMessage {
  type: 'storage:value';
  payload: {
    backend: StorageBackend;
    entry: StorageEntry;
    requestId: string;
  };
}

// Server → SDK messages
export interface HandshakeAckMessage extends SDKMessage {
  type: 'handshake:ack';
  payload: {
    serverVersion: string;
  };
}

export interface PingMessage extends SDKMessage {
  type: 'ping';
  payload: Record<string, never>;
}

export interface RequestNavigationStateMessage extends SDKMessage {
  type: 'request:navigation-state';
  payload: Record<string, never>;
}

// Phase 5c: Request state (Server → SDK)
export interface RequestStateMessage extends SDKMessage {
  type: 'request:state';
  payload: {
    name?: string;
  };
}

// Phase 5d: Request storage (Server → SDK)
export interface RequestStorageKeysMessage extends SDKMessage {
  type: 'request:storage-keys';
  payload: {
    backend: StorageBackend;
    requestId: string;
  };
}

export interface RequestStorageValueMessage extends SDKMessage {
  type: 'request:storage-value';
  payload: {
    backend: StorageBackend;
    key: string;
    requestId: string;
  };
}

export type SDKToServerMessage =
  | HandshakeMessage
  | NetworkRequestMessage
  | NetworkResponseMessage
  | ConsoleLogMessage
  | ErrorReportMessage
  | NavigationStateMessage
  | PongMessage
  | RenderProfileMessage
  | StateSnapshotMessage
  | StorageKeysMessage
  | StorageValueMessage;

export type ServerToSDKMessage =
  | HandshakeAckMessage
  | PingMessage
  | RequestNavigationStateMessage
  | RequestStateMessage
  | RequestStorageKeysMessage
  | RequestStorageValueMessage;
