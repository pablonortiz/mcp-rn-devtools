# mcp-rn-devtools

[![CI](https://img.shields.io/github/actions/workflow/status/pablonortiz/mcp-rn-devtools/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/pablonortiz/mcp-rn-devtools/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/mcp-rn-devtools?style=flat-square&color=CB3837)](https://www.npmjs.com/package/mcp-rn-devtools)
[![npm version](https://img.shields.io/npm/v/mcp-rn-devtools-sdk?style=flat-square&color=CB3837&label=sdk)](https://www.npmjs.com/package/mcp-rn-devtools-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

An MCP server that gives Claude (or any MCP host) real-time access to your running React Native app — console logs, errors, network, state, storage, performance profiling, and more. Zero config for basics, optional SDK for full power.

## How It Works

```
Claude / MCP Host
       │ MCP (stdio)
       ▼
  mcp-rn-devtools (server)
    ├── CDP WebSocket ──► RN App (Hermes / Metro)   ← zero config
    └── SDK WebSocket ◄── mcp-rn-devtools-sdk        ← optional, in-app
```

**Layer 1 — CDP (zero config):** Connects to your app via Chrome DevTools Protocol through Metro's debugger proxy. Captures console logs, errors, warnings, network requests, and provides JS evaluation, memory profiling, CPU profiling, and source map resolution. No app changes needed.

**Layer 2 — SDK (optional):** Install `mcp-rn-devtools-sdk` in your app for navigation state, Redux/Zustand state inspection, AsyncStorage/MMKV reading, render profiling, and more reliable console/error capture through a dual-channel architecture.

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
```

## Quick Start

1. **Start your React Native app** — Metro must be running, Hermes engine (default since RN 0.70).
2. **Add the MCP server** to your Claude config (see above).
3. **Ask Claude** about your app:
   - *"What errors is my app showing?"*
   - *"Show me the recent network requests"*
   - *"What's the current navigation state?"*
   - *"Profile the CPU for 3 seconds and show me the hot functions"*

## Available Tools

### Logging & Errors

| Tool | Source | Description |
|------|--------|-------------|
| `get_console_logs` | CDP + SDK | Console output (log, info, debug) with level filter and search |
| `get_errors` | CDP + SDK | JS errors and exceptions with stack traces |
| `get_warnings` | CDP + SDK | LogBox warnings from console.warn |
| `health_check` | CDP + SDK | Connection status, error/warning/request counts, uptime |

### Network

| Tool | Source | Description |
|------|--------|-------------|
| `get_network_requests` | CDP + SDK | HTTP requests with URL, method, status, timing, headers |
| `get_failed_requests` | CDP + SDK | Requests with status >= 400 or network errors |

### Memory & Performance

| Tool | Source | Description |
|------|--------|-------------|
| `get_memory_usage` | CDP | Current heap usage (used / total / percentage) |
| `take_heap_snapshot` | CDP | Heap snapshot summary — object count, top retainers by size |
| `get_cpu_profile` | CDP | CPU profile for N seconds — hot functions sorted by self time |
| `force_gc` | CDP | Trigger garbage collection, return before/after heap comparison |

### Navigation

| Tool | Source | Description |
|------|--------|-------------|
| `get_navigation_state` | SDK | Current route, stack, params (React Navigation) |
| `get_navigation_timing` | SDK | Screen transition timing with per-route summary |

### State & Storage

| Tool | Source | Description |
|------|--------|-------------|
| `get_app_state` | SDK | Redux/Zustand store state with dot-path access (e.g. `auth.user.name`) |
| `get_action_log` | SDK | Redux action dispatch history with filtering and summary |
| `get_storage_keys` | SDK | List AsyncStorage or MMKV keys with search |
| `get_storage_value` | SDK | Read a specific storage value |

### Render Profiling

| Tool | Source | Description |
|------|--------|-------------|
| `get_render_profile` | SDK | Component render events — mount/update durations, slow renders, per-component summary |

### Advanced

| Tool | Source | Description |
|------|--------|-------------|
| `evaluate_js` | CDP | Execute JavaScript in the app's global scope |
| `resolve_source_location` | CDP | Resolve bundled line:column to original source file via Metro source maps |

> **Source legend:** **CDP** = works without SDK (zero config). **SDK** = requires the SDK installed in the app. **CDP + SDK** = dual-channel, captures from both sources.

## SDK Setup

Install the SDK for navigation, state, storage, render profiling, and more reliable log/error capture:

```bash
npm install mcp-rn-devtools-sdk --save-dev
# or
yarn add mcp-rn-devtools-sdk --dev
```

### Basic Usage

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

### With Navigation (React Navigation)

```tsx
import { RNDevtoolsProvider } from 'mcp-rn-devtools-sdk';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';

export default function App() {
  const navigationRef = useNavigationContainerRef();

  return (
    <RNDevtoolsProvider navigationRef={navigationRef}>
      <NavigationContainer ref={navigationRef}>
        <YourNavigator />
      </NavigationContainer>
    </RNDevtoolsProvider>
  );
}
```

### With State Inspection (Redux / Zustand)

```tsx
import { RNDevtoolsProvider, createDevtoolsMiddleware } from 'mcp-rn-devtools-sdk';

// Redux — create middleware before store
const devtoolsMiddleware = createDevtoolsMiddleware('main');
const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefault) => getDefault().concat(devtoolsMiddleware),
});

// Zustand — pass store directly
const useAuthStore = create((set) => ({ /* ... */ }));

export default function App() {
  return (
    <RNDevtoolsProvider
      stateManagers={{ redux: store, auth: useAuthStore }}
      reduxMiddlewares={[devtoolsMiddleware]}
    >
      <YourApp />
    </RNDevtoolsProvider>
  );
}
```

### With Storage

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MMKV } from 'react-native-mmkv';

const storage = new MMKV();

<RNDevtoolsProvider asyncStorage={AsyncStorage} mmkv={storage}>
  <YourApp />
</RNDevtoolsProvider>
```

### Per-Component Render Profiling

The SDK automatically tracks renders at the root level. For per-component granularity:

```tsx
import { RNDevtoolsProfiler } from 'mcp-rn-devtools-sdk';

<RNDevtoolsProfiler id="UserList">
  <UserList />
</RNDevtoolsProfiler>
```

### Provider Props

| Prop | Type | Description |
|------|------|-------------|
| `navigationRef` | `RefObject` | React Navigation container ref for route tracking |
| `stateManagers` | `Record<string, StateStore>` | Redux/Zustand stores for state inspection |
| `reduxMiddlewares` | `DevtoolsMiddleware[]` | Middlewares created via `createDevtoolsMiddleware()` |
| `asyncStorage` | `AsyncStorageLike` | AsyncStorage instance for storage reading |
| `mmkv` | `MMKVLike` | MMKV instance for storage reading |
| `port` | `number` | WebSocket port (default: `8098`) |
| `host` | `string` | Dev machine host (auto-detected: `localhost` iOS, `10.0.2.2` Android) |

> The SDK automatically strips itself from production builds via `__DEV__` checks — zero overhead in release.

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `METRO_PORT` | `8081` | Metro bundler port |
| `SDK_PORT` | `8098` | SDK WebSocket port |
| `MCP_RN_DEBUG` | - | Enable debug logging |

## Architecture

The server uses two communication channels:

- **CDP (Chrome DevTools Protocol):** Connects through Metro's inspector proxy (`/json` endpoint) to the Hermes engine. Provides console events, JS evaluation, heap/CPU profiling, and source maps. The server calls `Debugger.enable` to transition Hermes from `RunningDetached` to `Running` state, then `Runtime.enable` for console event capture. Reconnects automatically with exponential backoff if the connection drops.

- **SDK WebSocket:** A lightweight bridge running on a separate port. The React Native SDK sends console logs, errors, network requests, navigation state, render events, state snapshots, and storage data. This provides a reliable second channel — if CDP drops, the SDK channel keeps working.

Both channels feed into shared managers (LogManager, ErrorManager, NetworkManager, etc.), and tools query these managers regardless of which channel provided the data.

## Compatibility

- **React Native:** 0.71+
- **Engine:** Hermes (default since RN 0.70)
- **Platforms:** iOS, Android
- **Node.js:** 18+
- **MCP Hosts:** Claude Code, Claude Desktop, or any MCP-compatible client

## License

MIT
