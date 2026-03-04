export type LogLevel = 'log' | 'info' | 'debug' | 'warn' | 'error';

export interface StackFrame {
  functionName?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  scriptId?: string;
}

export interface ConsoleLogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  args: unknown[];
  stackTrace?: StackFrame[];
  source: 'cdp' | 'sdk';
}

export interface ErrorEntry {
  id: string;
  timestamp: number;
  message: string;
  stack?: StackFrame[];
  isFatal: boolean;
  componentStack?: string;
  source: 'cdp' | 'sdk';
}

export interface NetworkRequest {
  id: string;
  url: string;
  method: string;
  status: number | null;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string | null;
  responseBody?: string | null;
  startTime: number;
  endTime?: number;
  duration?: number;
  error?: string;
  source: 'cdp' | 'sdk';
}

export interface NavigationState {
  currentRoute: {
    name: string;
    key: string;
    params?: Record<string, unknown>;
  };
  stack: Array<{
    name: string;
    key: string;
    params?: Record<string, unknown>;
  }>;
  index: number;
  type: string;
  stale: boolean;
}

export interface HealthCheckResult {
  connected: boolean;
  sdkConnected: boolean;
  engine: string;
  errorsCount: number;
  warningsCount: number;
  failedRequestsCount: number;
  totalRequestsCount: number;
  recentErrors: ErrorEntry[];
  uptime: number;
}

// Phase 5a: Memory/Performance
export interface HeapUsage {
  usedSize: number;
  totalSize: number;
}

export interface HeapSnapshotSummary {
  totalSize: number;
  totalObjects: number;
  topRetainers: Array<{
    name: string;
    size: number;
    count: number;
  }>;
}

export interface CPUProfileFunction {
  functionName: string;
  url: string;
  lineNumber: number;
  selfTime: number;
  totalTime: number;
}

// Phase 5b: Render Tracking
export interface RenderProfileEntry {
  id: string;
  component: string;
  phase: 'mount' | 'update' | 'nested-update';
  actualDuration: number;
  baseDuration: number;
  startTime: number;
  commitTime: number;
  timestamp: number;
}

// Phase 5c: State Inspection
export interface StateSnapshot {
  name: string;
  state: unknown;
  timestamp: number;
}

// Redux action log
export interface ReduxActionEntry {
  id: string;
  actionType: string;
  payload?: unknown;
  timestamp: number;
  duration: number;
  changedKeys: string[];
  storeName: string;
}

// Phase 5d: Storage
export type StorageBackend = 'async-storage' | 'mmkv';

export interface StorageEntry {
  key: string;
  value: string | null;
  backend: StorageBackend;
}
