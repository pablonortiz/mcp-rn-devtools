# mcp-rn-devtools

[![CI](https://img.shields.io/github/actions/workflow/status/pablonortiz/mcp-rn-devtools/ci.yml?branch=master&style=flat-square&label=CI)](https://github.com/pablonortiz/mcp-rn-devtools/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/mcp-rn-devtools?style=flat-square&color=CB3837)](https://www.npmjs.com/package/mcp-rn-devtools)
[![npm version](https://img.shields.io/npm/v/mcp-rn-devtools-sdk?style=flat-square&color=CB3837&label=sdk)](https://www.npmjs.com/package/mcp-rn-devtools-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

An MCP server that gives Claude (or any MCP host) real-time access to your running React Native app — **including your Redux state and AsyncStorage, with zero app changes**. Console logs, errors, network, state, storage, action log, navigation, performance profiling, and more.

## Why this one

- **True zero-config state access.** A runtime agent injected over the Chrome DevTools Protocol walks the React fiber tree to discover your Redux store — no SDK, no middleware, no exposing the store on a global. Reading AsyncStorage works the same way (native module proxy). Install the server, ask Claude about your state.
- **Headless.** No desktop app to keep open, no toggle to remember. Works in fully autonomous agent workflows and CI.
- **Secrets redacted by default.** Tokens, passwords, auth headers, and JWT-shaped strings are masked server-side before anything reaches the LLM (`MCP_RN_NO_REDACT=1` to opt out).
- **Built for agent loops.** `clear_buffers` → reproduce → read. `wait_for_log` blocks until the app emits a matching log. `get_state_diff` shows exactly what changed between two moments.

## How It Works

```
Claude / MCP Host
       │ MCP (stdio)
       ▼
  mcp-rn-devtools (server)
    ├── CDP WebSocket ──► RN App (Hermes / Metro)   ← zero config
    │     └── runtime agent (injected): Redux discovery,
    │         AsyncStorage, action log, navigation
    └── SDK WebSocket ◄── mcp-rn-devtools-sdk        ← optional enhancer
```

**Layer 1 — CDP + runtime agent (zero config):** Connects via Chrome DevTools Protocol through Metro's debugger proxy. Captures console logs, errors, warnings, and network requests, and injects a runtime agent that discovers Redux stores / React Navigation / React Query by walking the fiber tree, reads and writes AsyncStorage through the native module proxy, and records every dispatched action. Also provides JS evaluation, memory/CPU profiling, and source map resolution. **No app changes needed.**

**Layer 2 — SDK (optional enhancer):** Install `mcp-rn-devtools-sdk` for what the agent can't reach: Zustand/custom stores, MMKV, per-component render profiling, navigation timing, and a second capture channel that survives CDP drops.

## Installation

### With Claude Code

```bash
claude mcp add rn-devtools -- npx -y mcp-rn-devtools
```

Or add `.mcp.json` to your project root (shared with your team):

```json
{
  "mcpServers": {
    "rn-devtools": {
      "command": "npx",
      "args": ["-y", "mcp-rn-devtools"]
    }
  }
}
```

### With Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "rn-devtools": {
      "command": "npx",
      "args": ["-y", "mcp-rn-devtools"]
    }
  }
}
```

### Manual

```bash
npm install -g mcp-rn-devtools
mcp-rn-devtools --version
```

## Quick Start

1. **Start your React Native app** — Metro must be running, Hermes engine (default since RN 0.70).
2. **Add the MCP server** to your Claude config (see above).
3. **Ask Claude** about your app:
   - *"What's in my Redux store right now?"*
   - *"Read the AsyncStorage key persist:root"*
   - *"Clear the buffers, I'll reproduce the bug — then show me what happened"*
   - *"Dispatch auth/logout and show me the state diff"*
   - *"Profile the CPU for 3 seconds and show me the hot functions"*

## Available Tools

> **Source legend:** **agent** = zero config, injected via CDP. **CDP** = zero config, protocol-level. **SDK** = requires `mcp-rn-devtools-sdk` in the app. Read-only tools are annotated with `readOnlyHint` so MCP hosts can auto-allow them.

### State & Actions

| Tool | Source | Description |
|------|--------|-------------|
| `get_app_state` | agent + SDK | Redux store state with dot-path access and depth control. Stores discovered automatically |
| `get_state_diff` | agent + SDK | What changed in the store since the last call (baseline → diff workflow) |
| `get_action_log` | agent + SDK | Dispatched actions with duration and changed slices — recorded automatically, no middleware |
| `dispatch_action` | agent | Dispatch a Redux action to reproduce states or trigger flows |

### Storage

| Tool | Source | Description |
|------|--------|-------------|
| `get_storage_keys` | agent + SDK | List AsyncStorage (zero-config) or MMKV (SDK) keys with search |
| `get_storage_value` | agent + SDK | Read a storage value — secrets redacted by default |

### Logging & Errors

| Tool | Source | Description |
|------|--------|-------------|
| `get_console_logs` | CDP + SDK | Console output with level filter and search; capped for the LLM by default, `full=true` for everything |
| `get_errors` | CDP + SDK | JS errors and exceptions with stack traces (5 frames by default, `full=true` for all) |
| `get_warnings` | CDP + SDK | LogBox warnings from console.warn, deduplicated across debugger reconnects |
| `wait_for_log` | CDP + SDK | Block until a log matching a pattern appears — synchronize with app activity |

### Network

| Tool | Source | Description |
|------|--------|-------------|
| `get_network_requests` | CDP + SDK | HTTP requests; `verbose` adds headers/bodies with secrets redacted, capped unless `full=true` |
| `get_failed_requests` | CDP + SDK | Requests with status >= 400 or network errors, response bodies capped unless `full=true` |

### Diagnostics

| Tool | Source | Description |
|------|--------|-------------|
| `health_check` | — | Verdict first — `READY` or `BLOCKED: cause → fix` — then version, debugger owner, stores, counts |
| `list_targets` | — | Targets on every Metro port (8081–8085) with who holds each one (→ this instance, ⊙ another instance, ✗ library runtime) |
| `select_target` | — | Pin a target by id (optionally with `metro_port`) or by `app` id prefix; takes it from the instance holding it; library runtimes (Reanimated) are refused |
| `clear_buffers` | — | Reset captured data before reproducing a scenario |

### Navigation

| Tool | Source | Description |
|------|--------|-------------|
| `get_navigation_state` | agent + SDK | Current route and stack (React Navigation), discovered automatically |
| `get_navigation_timing` | SDK | Screen transition timing with per-route summary |

### Memory & Performance

| Tool | Source | Description |
|------|--------|-------------|
| `get_memory_usage` | CDP | Current heap usage (used / total / percentage) |
| `take_heap_snapshot` | CDP | Heap snapshot summary — object count, top retainers by size |
| `get_cpu_profile` | CDP | CPU profile for N seconds — hot functions sorted by self time |
| `force_gc` | CDP | Trigger garbage collection, return before/after heap comparison |
| `get_render_profile` | SDK | Component render events — mount/update durations, slow renders |

### Advanced

| Tool | Source | Description |
|------|--------|-------------|
| `evaluate_js` | CDP | Execute JavaScript in the app: `global` and `globalThis` both work, `await_promise` settles Promises in-app |
| `resolve_source_location` | CDP | Resolve bundled line:column to original source via Metro source maps |

### Building on top of the core

The server exports its building blocks (`ConnectionManager`, `SDKBridgeServer`, the injected agent bridge, adb helpers) so tools can extend it **in the same process** — Hermes admits a single debugger, so extensions must share the CDP session rather than compete for it. Unrecognized SDK-channel messages are re-emitted as `sdk-message` events, and `sendToClient()` lets extensions answer.

The first product built this way is [**tapfix**](https://www.npmjs.com/package/tapfix): a live QA loop for React Native (mark issues on-device or from a cockpit web UI, and an embedded coding agent fixes them on the fly). Its MCP server is a superset of this one.

## Multiple sessions and multiple apps

Hermes admits **one** debugger per app instance, and every Claude Code session starts its own `mcp-rn-devtools` process. Ownership is settled **per app on a device**, not per machine:

- **Sessions on different apps coexist.** Two emulators, two apps, two sessions: each holds its own debugger. Instances register in `~/.mcp-rn-devtools/instances/` and ask each other to yield through a per-instance control endpoint — only the one holding *that* app is asked.
- **The debugger follows the session in use** for the *same* app. An instance attaches on its first tool call (`lazy`, the default); if a sibling holds that app, it yields and gets it back on its own next tool call. An instance kicked by a sibling does not fight back.
- **A session attaches to its own app.** The server reads the app id from the repo it runs in (`android/app/build.gradle` `applicationId`, the iOS bundle id, or Expo's `app.json`; `MCP_RN_APP` overrides) and finds that app across Metro ports 8081–8085 — a session in the wms repo attaches to wms even while picking runs on 8081. `select_target` also takes an `app` id.
- **No orphans.** The server exits when its MCP client goes away (stdin closes or the parent process dies).
- `health_check` shows the session app, who holds the debugger, the other instances and their apps, and who serves the SDK channel. `list_targets` marks targets held by other instances with ⊙.

Extensions that record continuously (tapfix) opt into `connectMode: 'eager'`. Instances older than 0.5 (no registry) are still asked to yield over the SDK port.

## Secret Redaction

Every tool that outputs app data (state, storage values, network headers/bodies, action payloads) masks secrets **server-side, before the data reaches the LLM**:

- Values under sensitive keys (`token`, `password`, `authorization`, `apiKey`, `session`, `cookie`, …) → `[REDACTED]`
- JWT-shaped strings and `Bearer …` tokens anywhere in text → masked

Redaction is a blocklist (defence in depth, not a guarantee) — audit what your app stores before pointing any LLM at it. Opt out with `MCP_RN_NO_REDACT=1`.

## SDK Setup (optional)

The runtime agent covers Redux, AsyncStorage, actions, and navigation with zero config. Install the SDK only if you need Zustand/custom stores, MMKV, render profiling, or navigation timing:

```bash
npm install mcp-rn-devtools-sdk --save-dev
```

```tsx
import { RNDevtoolsProvider } from 'mcp-rn-devtools-sdk';

export default function App() {
  return (
    <RNDevtoolsProvider>
      <YourApp />
    </RNDevtoolsProvider>
  );
}
```

### With Zustand / custom stores

```tsx
const useAuthStore = create((set) => ({ /* ... */ }));

<RNDevtoolsProvider stateManagers={{ auth: useAuthStore }}>
  <YourApp />
</RNDevtoolsProvider>
```

State snapshots are **pull-only**: they're serialized only when a tool asks, so the SDK adds zero overhead while idle.

### With MMKV

```tsx
import { MMKV } from 'react-native-mmkv';
const storage = new MMKV();

<RNDevtoolsProvider mmkv={storage}>
  <YourApp />
</RNDevtoolsProvider>
```

### Per-Component Render Profiling

```tsx
import { RNDevtoolsProfiler } from 'mcp-rn-devtools-sdk';

<RNDevtoolsProfiler id="UserList">
  <UserList />
</RNDevtoolsProfiler>
```

### Provider Props

| Prop | Type | Description |
|------|------|-------------|
| `navigationRef` | `RefObject` | React Navigation container ref for richer route tracking |
| `stateManagers` | `Record<string, StateStore>` | Zustand/custom stores for state inspection |
| `reduxMiddlewares` | `DevtoolsMiddleware[]` | Middlewares created via `createDevtoolsMiddleware()` |
| `asyncStorage` | `AsyncStorageLike` | AsyncStorage instance (also available zero-config via agent) |
| `mmkv` | `MMKVLike` | MMKV instance for storage reading |
| `port` | `number` | WebSocket port (default: `8098`) |
| `host` | `string` | Dev machine host — auto-detected from the bundle URL (`SourceCode.scriptURL`), works on emulators, physical devices, and `adb reverse` |

> The SDK automatically strips itself from production builds via `__DEV__` checks — zero overhead in release.

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `METRO_PORT` | `8081` | Metro bundler port (when it has no app, ports 8082–8085 are checked too) |
| `SDK_PORT` | `8098` | SDK WebSocket port — also marks which instance owns the debugger |
| `MCP_RN_CONNECT` | `lazy` | `lazy` attaches on the first tool call; `eager` attaches at startup |
| `MCP_RN_APP` | from the repo | App id prefix(es) this session works on, comma-separated (overrides the cwd detection) |
| `MCP_RN_STATE_DIR` | `~/.mcp-rn-devtools/instances` | Where instances register themselves for per-app ownership |
| `MCP_RN_NO_REDACT` | - | Disable secret redaction |
| `MCP_RN_NO_UPDATE_CHECK` | - | Skip the npm "newer version" lookup in `health_check` |
| `MCP_RN_DEBUG` | - | Enable debug logging |

## Architecture Notes

- **Target selection:** RN 0.76+ (Fusebox) no longer advertises `vm: 'Hermes'` — the server picks the main runtime by `reactNative.capabilities.prefersFuseboxFrontend` and skips secondary runtimes like Reanimated's. Legacy targets still work via the `vm` field.
- **Kick-and-poll:** CDP's `awaitPromise` can't resolve React Native's polyfilled Promises, so async in-app operations (AsyncStorage) fire a callback that writes to a result slot, which the server polls.
- **Clock skew:** log/error entries carry a server-clock `receivedAt` — device clocks can drift seconds from the host, which would break "wait for new logs" cuts.
- **Reconnection:** exponential backoff, agent re-injected automatically after every bundle reload. A pinned target that keeps failing is unpinned after 3 attempts.
- **Console replay:** `Runtime.enable` replays the runtime's console backlog on every reconnect; entries are deduplicated by (timestamp, message) so warnings do not inflate.
- **`global` in the evaluate scope:** Hermes exposes `globalThis` but not `global` to `Runtime.evaluate` (Metro only passes `global` to module factories). Injected scripts resolve the global object themselves and `evaluate_js` aliases `global` for the duration of the call.
- **Multi-Metro:** a known session app is searched across ports 8081–8085 regardless of what the configured port serves. Without a session app: when nothing listens on the configured port and exactly one other port has an app, the server switches to it; a running Metro without an app is left alone (the app is about to appear there), and with several candidates it asks you to `select_target`.
- **Target identity:** ownership is keyed by `reactNative.logicalDeviceId` (RN 0.73+: a stable hash of app + device, shared by the app's main and Reanimated runtimes), falling back to app id + device name.
- **Action log caveat:** the agent wraps `store.dispatch` at discovery time; components that captured a direct `dispatch` reference *before* discovery bypass the log (rare — discovery runs at connect).

## Compatibility

- **React Native:** 0.71+ (validated against 0.80 / bridgeless / Fusebox)
- **Engine:** Hermes (default since RN 0.70)
- **Platforms:** iOS, Android
- **Node.js:** 20+
- **MCP Hosts:** Claude Code, Claude Desktop, or any MCP-compatible client

## Development

```bash
mise install          # node 22 + pnpm 9 from .mise.toml (pnpm 10+ breaks the build)
pnpm install
pnpm build            # shared → server → sdk
pnpm test             # vitest, includes fake Metro/Hermes integration tests
pnpm typecheck && pnpm lint
```

Release: bump `version` in the three `packages/*/package.json`, push, and publish a GitHub Release — `publish.yml` runs CI and `pnpm -r publish`.

## License

MIT
