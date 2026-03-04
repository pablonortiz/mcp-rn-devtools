# mcp-rn-devtools — Implementation Plan

## Context

Building an MCP server + optional SDK that gives Claude real-time access to React Native app internals during local development. The project fills the gap between Claude's code assistance and runtime observability — today, developers must manually paste errors, describe perf issues, or copy logs. This tool lets Claude query the running app directly.

The name is **mcp-rn-devtools** (server) and **mcp-rn-devtools-sdk** (SDK).

---

## Architecture Overview

```
┌───────────────────────────────┐
│     Claude / MCP Host         │
└──────────────┬────────────────┘
               │ MCP (stdio)
┌──────────────▼────────────────┐
│      mcp-rn-devtools          │
│         (server)              │
│  McpServer → ConnectionMgr   │
│    ├── LogManager             │
│    ├── ErrorManager           │
│    ├── NetworkManager         │
│    ├── CDPConnection          │
│    └── SDKBridgeServer        │
└───┬───────────────────┬───────┘
    │ CDP WebSocket     │ WS :8098
    │ :8081             │
┌───▼───────────────┐  ┌▼──────────────────┐
│  RN App (Hermes)  │  │ mcp-rn-devtools-sdk│
│  Metro Inspector  │  │ <RNDevtoolsProvider>│
│  Proxy            │  │  ├─ NetworkIntercept│
└───────────────────┘  │  └─ NavigationConn  │
                       └─────────────────────┘
```

**Hybrid approach:**
- **Layer 1 (CDP, zero config):** Server connects to Hermes via CDP WebSocket. No app changes. Covers logs, errors, warnings, network (injected), health check.
- **Layer 2 (SDK, optional):** `<RNDevtoolsProvider>` in the app. More robust network, navigation state, and future features (Redux, storage, render tracking).

---

## Key Technical Findings

### Hermes CDP
- Hermes implements 4 CDP domains: **Runtime**, **Debugger**, **HeapProfiler**, **Profiler**
- **`Runtime.exceptionThrown` does NOT exist in Hermes.** Errors appear as `console.error` via `Runtime.consoleAPICalled` with `type: "error"`. Use `Debugger.setPauseOnExceptions("uncaught")` + `Debugger.paused` with `reason: "exception"` as alternative.
- `Runtime.evaluate` works even when the domain is NOT enabled. Has full access to RN global scope (`require`, `global`, `__DEV__`).
- Hermes caches up to 1000 console messages. On `Runtime.enable`, all buffered messages are replayed.
- LogBox warnings flow through `console.warn` → captured via `Runtime.consoleAPICalled` with `type: "warning"`.
- RedBox errors flow through `ExceptionsManager` → appear as `console.error`.

### CDP Discovery (stable across all RN versions)
- `GET http://localhost:8081/json/list` → JSON array of debuggable targets
- Filter for `vm === "Hermes"` to find the right target
- Connect WebSocket to `webSocketDebuggerUrl` from the target
- **RN 0.76+**: Must set `Origin: http://localhost:8081` header on WebSocket connection

### Three eras of debugging architecture
| Era | RN Versions | Inspector Package |
|-----|-------------|-------------------|
| Legacy | 0.71-0.72 | `metro-inspector-proxy` |
| Transition | 0.73-0.75 | Same + experimental debugger |
| Modern | 0.76+ | `@react-native/dev-middleware` |

The `/json/list` response format is consistent. Modern adds `reactNative.capabilities` and `appId` fields, but the core fields (`id`, `title`, `webSocketDebuggerUrl`, `vm`) are the same.

### RN Networking Internals
- `fetch()` is a polyfill (whatwg-fetch) built on top of `XMLHttpRequest`
- `XMLHttpRequest` in RN is a custom polyfill wrapping `RCTNetworking` native module
- Patching `XMLHttpRequest.prototype` captures both `fetch()` and direct XHR calls
- Hermes does NOT implement the CDP `Network` domain

### Engine Support
- **Only Hermes** is supported. JSC uses WebKit Inspector Protocol (incompatible with CDP). JSC was removed from RN core in 0.81.
- Server auto-detects engine and warns if no Hermes target found.

---

## Decisions

| Decision | Value |
|----------|-------|
| Package names | `mcp-rn-devtools` + `mcp-rn-devtools-sdk` |
| RN compatibility | 0.71+ through latest (0.84+) |
| Engine | Hermes only (auto-detect) |
| Platforms | iOS + Android |
| Package manager | pnpm monorepo |
| App connections | 1 at a time |
| SDK WS port | 8098 |
| Auto-reconnect | Yes, polls `/json/list` every 500ms |
| Security | localhost-only, no extra auth |
| License | MIT |
| Distribution | npm, open source, `npx mcp-rn-devtools` |

---

## Monorepo Structure

```
mcp-rn-devtools/
  pnpm-workspace.yaml
  package.json
  tsconfig.base.json
  .gitignore
  .npmrc
  LICENSE
  README.md
  packages/
    shared/                     (internal, not published)
      package.json
      tsconfig.json
      src/
        index.ts
        types.ts                (ConsoleLogEntry, ErrorEntry, NetworkRequest, etc.)
        constants.ts            (ports, buffer sizes, global keys)
        protocol.ts             (SDK<->Server message types)
    server/
      package.json
      tsconfig.json
      tsup.config.ts
      README.md
      src/
        index.ts                (entry: create server, start stdio transport)
        cli.ts                  (bin entry with shebang)
        server.ts               (McpServer setup)
        cdp/
          discovery.ts          (query /json/list, find Hermes target)
          connection.ts         (CDPConnection class: WebSocket, send/receive, events)
        managers/
          connection-manager.ts (orchestrates CDP + SDK + reconnect)
          log-manager.ts        (circular buffer, console log events)
          error-manager.ts      (errors + warnings buffer)
          network-manager.ts    (CDP injection + SDK data + polling)
        tools/
          index.ts              (register all tools)
          get-console-logs.ts
          get-errors.ts
          get-warnings.ts
          get-network-requests.ts
          get-failed-requests.ts
          health-check.ts
          get-navigation-state.ts
        sdk-bridge/
          sdk-server.ts         (WebSocket server on :8098)
        utils/
          logger.ts
    sdk/
      package.json
      tsconfig.json
      tsup.config.ts
      README.md
      src/
        index.ts                (public exports)
        RNDevtoolsProvider.tsx  (main provider, __DEV__ guard)
        context.ts              (React context)
        bridge/
          ws-client.ts          (WebSocket client to :8098, auto-reconnect)
        interceptors/
          network-interceptor.ts (XHR monkey-patch)
        connectors/
          navigation-connector.ts (extract navigation state from ref)
        utils/
          dev-guard.ts
          uuid.ts               (simple UUID, no crypto dep)
```

---

## Shared Types (`packages/shared/src/types.ts`)

```typescript
export type LogLevel = 'log' | 'info' | 'debug' | 'warn' | 'error';

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
  currentRoute: { name: string; key: string; params?: Record<string, unknown> };
  stack: Array<{ name: string; key: string; params?: Record<string, unknown> }>;
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
```

---

## SDK <-> Server Protocol

WebSocket on `ws://localhost:8098`. JSON messages with envelope:
```typescript
{ type: string; payload: object; timestamp: number; id: string; }
```

**SDK → Server:** `handshake`, `network:request`, `network:response`, `console:log`, `error:report`, `navigation:state`, `pong`

**Server → SDK:** `handshake:ack`, `ping`, `request:navigation-state`

---

## CDP Connection Strategy

### Discovery
1. Query `http://localhost:{metroPort}/json/list` (try localhost, 127.0.0.1, [::1])
2. Find target with `vm === "Hermes"`, skip synthetic pages (ID ending in `-1`)
3. Connect WebSocket to `webSocketDebuggerUrl`
4. For RN 0.76+: set `Origin: http://localhost:{metroPort}` header

### After Connect
1. `Runtime.enable` → triggers replay of up to 1000 buffered console messages
2. Listen for `Runtime.consoleAPICalled` → route to LogManager + ErrorManager
3. Inject network interceptor via `Runtime.evaluate` (if SDK not connected)
4. Start polling injected global every 2s for new network requests

### Error Capture (critical nuance)
Since Hermes does NOT implement `Runtime.exceptionThrown`:
- Errors are captured via `Runtime.consoleAPICalled` where `type === "error"`
- The ErrorManager listens for these and classifies them
- SDK can also report errors with `isFatal: true` for RedBox detection

### Reconnection
On WebSocket close:
1. Stop all polling
2. Start polling `/json/list` every 500ms (up to 60 attempts = 30s)
3. On target found → reconnect, re-enable domains, re-inject interceptors
4. Non-blocking: does not affect app reload speed

### Cross-version Compatibility
- The `/json/list` endpoint and `/inspector/debug` WebSocket path are stable 0.71-0.84+
- Target selection heuristic: filter `vm === "Hermes"`, prefer targets with `nativePageReloads` capability (0.76+), skip synthetic page IDs
- Page description format varies (0.76+ has `capabilities`), but core fields are consistent

---

## Network Interception

### Layer 1 (CDP injection)
Inject via `Runtime.evaluate` a script that:
1. Patches `XMLHttpRequest.prototype.open/setRequestHeader/send`
2. Stores completed requests in `global.__RN_DEVTOOLS_NETWORK__`
3. Server polls this array every 2s, drains it

### Layer 2 (SDK)
- Direct XHR monkey-patching inside the app process
- Reports requests in real-time via WebSocket
- Survives app reloads (SDK auto-reconnects)
- When SDK is connected, server stops CDP polling (SDK is preferred source)

---

## SDK Design

### Zero config wrap
```tsx
<RNDevtoolsProvider>
  <App />
</RNDevtoolsProvider>
```
Network interception works automatically. No props needed.

### Optional integrations
```tsx
<RNDevtoolsProvider
  navigationRef={navigationRef}        // React Navigation
  // Future: storage, stateManagement
>
```

### Production safety
- `RNDevtoolsProvider` checks `__DEV__` at the top level
- If false, renders `<>{children}</>` with zero overhead
- Metro's dead code elimination removes the dev implementation from production bundles
- SDK never imports AsyncStorage, MMKV, Redux, or Zustand directly

---

## MVP Tools

| Tool | Layer | Description |
|------|-------|-------------|
| `get_console_logs` | 1 (CDP) | Console output with level filter and search |
| `get_errors` | 1 (CDP) | JS errors and exceptions with stack traces |
| `get_warnings` | 1 (CDP) | LogBox warnings (captured via console.warn) |
| `get_network_requests` | 1+2 | HTTP requests with status, timing, URL |
| `get_failed_requests` | 1+2 | Requests with status >= 400 or network errors |
| `get_navigation_state` | 2 (SDK) | Current route, stack, params |
| `health_check` | 1+2 | Aggregate: connection status, error/warning/request counts |

---

## Build & Publish

- **Server:** tsup, ESM only, target node18. `bin` entry for `npx mcp-rn-devtools`. Peer deps: `@modelcontextprotocol/sdk`, `zod`.
- **SDK:** tsup, ESM + CJS, target es2020, platform neutral. Peer deps: `react >=18`, `react-native >=0.71`.
- **Shared:** Internal only, consumed at build time via `workspace:*`. tsup bundles types inline.

---

## Implementation Phases

### Phase 1: Foundation
- Monorepo scaffolding (pnpm workspace, tsconfig, shared package)
- Server skeleton (package.json, tsup, cli entry)
- CDP discovery + connection
- LogManager + `get_console_logs` tool
- McpServer with stdio transport
- **Validate:** `get_console_logs` returns real console output from a running RN app

### Phase 2: Remaining Layer 1 Tools
- ErrorManager (capture `console.error` events, NOT `exceptionThrown`)
- Warning routing (console.warn → ErrorManager)
- NetworkManager with CDP injection + polling
- Register: `get_errors`, `get_warnings`, `get_network_requests`, `get_failed_requests`, `health_check`
- Reconnection logic
- Unit tests for all managers
- **Validate:** All 6 Layer 1 tools work. Reconnection works on reload.

### Phase 3: SDK Package
- SDK skeleton (package.json, tsup, tsconfig)
- WebSocket client with auto-reconnect
- Network interceptor (XHR monkey-patch)
- Navigation connector
- `RNDevtoolsProvider` with `__DEV__` guard
- Server-side: SDKBridgeServer on port 8098
- Wire SDK bridge into ConnectionManager
- Register `get_navigation_state` tool
- Unit tests for SDK components
- **Validate:** SDK connects, network shows `source: 'sdk'`, navigation state works, production build strips SDK.

### Phase 4: Polish & Publish
- Comprehensive unit tests
- Smoke test for CI (mocked CDP)
- README.md (root + per-package)
- TESTING.md (manual integration test protocol)
- LICENSE, .github/workflows/ci.yml
- npm publish
- **Validate:** `npx mcp-rn-devtools` works from clean install. `npm i mcp-rn-devtools-sdk --save-dev` works.

---

## Verification Plan

1. **Unit tests (vitest):** Managers, discovery, CDP connection (mocked WS), tools (mocked managers), SDK interceptors, navigation connector
2. **Smoke test:** Server starts in disconnected mode, all tools return valid responses with "not connected" messages
3. **Integration test (manual, with user's RN apps):**
   - Test Layer 1 on RN 0.71.6 app (if Hermes) and RN 0.80.2 app
   - Test Layer 2 on RN 0.80.2 app
   - Verify: logs, errors, warnings, network, health check, navigation, reconnection
4. **Cross-era:** Confirm `/json/list` discovery works on 0.71 and 0.80

---

## Post-MVP (future, to discuss)

- CPU profiling (`Profiler.start/stop`)
- Heap snapshots (`HeapProfiler.takeHeapSnapshot`)
- Memory usage (`Runtime.getHeapUsage`)
- Redux/Zustand state inspection
- AsyncStorage/MMKV reading
- Component render tracking (React Profiler)
- Metro bundler log parsing
- Live log streaming with filters
- FPS monitoring / jank detection
- Bundle size info
