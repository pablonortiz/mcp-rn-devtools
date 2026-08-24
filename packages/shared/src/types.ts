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
  /** Server-clock arrival time — device clocks can skew; use this for "newer than" cuts. */
  receivedAt?: number;
  level: LogLevel;
  message: string;
  args: unknown[];
  stackTrace?: StackFrame[];
  source: 'cdp' | 'sdk';
}

export interface ErrorEntry {
  id: string;
  timestamp: number;
  /** Server-clock arrival time — device clocks can skew; use this for "newer than" cuts. */
  receivedAt?: number;
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

// QA capture loop
export type QAReportMode = 'queue' | 'fix-now';
export type QAReportStatus = 'pending' | 'resolved';

export interface QAElementFrame {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** What the on-device overlay knows about the selected element at capture time. */
export interface QAReportElement {
  /** Screen-absolute frame of the selected hierarchy level, in dp. */
  frame: QAElementFrame;
  /** Component names from root to touched leaf, as reported by the renderer. */
  hierarchy: string[];
  /** Index into `hierarchy` of the level the user confirmed. */
  selectedIndex: number;
  selectedName: string;
  componentStack: string;
  /** Safe-serialized props of the selected level (functions/elements dropped). */
  props: Record<string, unknown>;
  /** Flattened style of the selected level, when the element has one. */
  style: Record<string, unknown> | null;
  /** JSX source location when the renderer still provides one (pre-React 19). */
  source: { fileName?: string; lineNumber?: number; columnNumber?: number } | null;
}

export interface QAReportPayload {
  note: string;
  mode: QAReportMode;
  element: QAReportElement;
  screen: { width: number; height: number; scale: number };
}

/** A captured report after server-side enrichment, as persisted to disk. */
export interface QAReport {
  id: string;
  createdAt: string;
  status: QAReportStatus;
  note: string;
  mode: QAReportMode;
  element: QAReportElement;
  screen: { width: number; height: number; scale: number };
  /** NavigationState when it came from the SDK; the agent's looser shape otherwise. */
  navigation: unknown;
  appState: unknown | null;
  recentActions: ReduxActionEntry[];
  recentNetwork: Array<Pick<NetworkRequest, 'url' | 'method' | 'status' | 'duration' | 'error'>>;
  recentLogs: Array<Pick<ConsoleLogEntry, 'level' | 'message' | 'timestamp'>>;
  recentErrors: Array<Pick<ErrorEntry, 'message' | 'isFatal' | 'timestamp' | 'componentStack'>>;
  /** File name of the screenshot inside the report directory, when captured. */
  screenshot: string | null;
  /** Filled by qa_resolve_report: what was done about it. */
  resolution?: string;
}

// Phase 5d: Storage
export type StorageBackend = 'async-storage' | 'mmkv';

export interface StorageEntry {
  key: string;
  value: string | null;
  backend: StorageBackend;
}
