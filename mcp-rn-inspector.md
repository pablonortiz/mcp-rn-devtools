# mcp-rn-inspector

An MCP server that gives Claude real-time access to React Native app internals during local development — errors, performance, logs, network, and state. The DevTools Claude never had.

## Problem

When developing React Native apps with Claude, it can only help reactively: you paste an error, describe a performance issue, or copy logs manually. Claude has no way to see what's actually happening inside the running app.

## Solution

An MCP server that connects to the running RN app and exposes its internals as tools Claude can query at any time. Think of it as giving Claude a permanent Flipper/DevTools session.

## Scope

This project focuses on the **non-visual** side of debugging. For visual interaction (screenshots, taps, swipes), there's already [mcp-mobile-interaction](https://github.com/pablonortiz/mcp-mobile-interaction). Together, they give Claude full observability over a React Native app.

## Architecture

Two layers:

### Layer 1 — CDP (zero config)

React Native apps running on Hermes expose a Chrome DevTools Protocol WebSocket. The MCP server connects directly to it. No changes to the app required.

This layer covers:
- Console output (log, warn, error)
- JavaScript exceptions and stack traces
- Hermes CPU profiling (sampling profiler)
- Heap snapshots (memory leak detection)
- Source maps for readable stack traces

### Layer 2 — Lightweight SDK (optional)

A small provider (`<RNInspectorProvider>`) the developer wraps around their app entry point. Communicates with the MCP server via a local WebSocket. Covers everything CDP can't reach.

This layer covers:
- Network requests and responses (interceptor)
- React Navigation state (current route, stack, params)
- Storage contents (AsyncStorage, MMKV)
- Custom metrics and markers the developer defines
- Component render counts and slow renders

```
┌─────────────┐     CDP WebSocket       ┌─────────────┐      MCP       ┌─────────┐
│   RN App    │◄───────────────────────►│  MCP Server  │◄─────────────►│  Claude  │
│  (Hermes)   │                         │              │               │          │
└──────┬──────┘                         └─────────────┘               └─────────┘
       │            Local WebSocket          ▲
       │  ┌──────────────────┐               │
       └──│  SDK (optional)  │───────────────┘
          └──────────────────┘
```

## Tools exposed to Claude

### Errors & Warnings
- `get_errors` — List current Red Box errors and unhandled exceptions
- `get_warnings` — List active LogBox warnings
- `get_native_crashes` — Recent native crash logs (Logcat / os_log)

### Logs
- `get_console_logs` — Console output with level filtering and search
- `get_metro_logs` — Metro bundler output (build errors, slow modules)
- `stream_logs` — Subscribe to live log stream with filters

### Performance
- `get_fps` — Current JS thread and UI thread frame rates
- `detect_jank` — Identify frame drops and their likely cause
- `get_startup_time` — Time to interactive measurement
- `profile_cpu` — Run Hermes sampling profiler for N seconds and return results
- `take_heap_snapshot` — Capture memory heap and identify potential leaks
- `get_memory_usage` — Current heap size and allocation trends

### Network
- `get_network_requests` — List HTTP requests with status, timing, size
- `get_slow_requests` — Requests exceeding a time threshold
- `get_failed_requests` — Requests with error status codes
- `inspect_request` — Full details of a specific request (headers, body, response)

### App State
- `get_navigation_state` — Current React Navigation route, stack, and params
- `get_storage` — Read AsyncStorage or MMKV contents (with key filtering)
- `get_redux_state` — Current Redux/Zustand store snapshot (if connected)

### Diagnostics
- `health_check` — Overall app health summary (errors, fps, memory, slow requests)
- `get_bundle_info` — JS bundle size and load time

## Usage

### Layer 1 only (zero config)

```json
{
  "mcpServers": {
    "rn-inspector": {
      "command": "npx",
      "args": ["mcp-rn-inspector"]
    }
  }
}
```

The server auto-discovers the Hermes debugger running locally. No changes to the app.

### With Layer 2 SDK

```bash
npm install mcp-rn-inspector-sdk --save-dev
```

```tsx
import { RNInspectorProvider } from 'mcp-rn-inspector-sdk';

export default function App() {
  return (
    <RNInspectorProvider>
      <Navigation />
    </RNInspectorProvider>
  );
}
```

The SDK only activates in `__DEV__` mode. It's stripped from production builds automatically.

## Tech Stack

- **MCP Server:** TypeScript, `@modelcontextprotocol/sdk`
- **CDP Client:** `chrome-remote-interface` or direct WebSocket
- **SDK:** TypeScript, React Native compatible
- **Metro integration:** Metro bundler config plugin or log parser

## Key Design Principles

1. **Layer 1 must work with zero setup.** Connect and go. This is what makes people try it.
2. **SDK is dev-only.** No risk of shipping debug code to production.
3. **Tools return structured data, not raw dumps.** Claude should get clean, actionable information.
4. **Privacy-aware.** No data leaves the local machine. Everything stays between the device, the MCP server, and Claude.

## Differentiation

- **Not Flipper.** Flipper requires a GUI and manual inspection. This is headless and AI-first.
- **Not React Native DevTools.** Same idea — built for humans, not for LLMs.
- **Not logging libraries.** Those produce text for humans to read. This produces structured data for Claude to act on.
- **Complements mcp-mobile-interaction.** That project is the eyes (visual). This project is the nervous system (internals).

## Milestones

### v0.1 — CDP Foundation
- Connect to Hermes debugger automatically
- `get_console_logs`, `get_errors`, `get_warnings`
- `profile_cpu`, `take_heap_snapshot`

### v0.2 — SDK + Network
- SDK package with `<RNInspectorProvider>`
- Network interceptor
- `get_network_requests`, `get_slow_requests`, `get_failed_requests`

### v0.3 — State & Navigation
- React Navigation integration
- Storage inspection (AsyncStorage, MMKV)
- Redux/Zustand connector

### v0.4 — Diagnostics & DX
- `health_check` aggregate tool
- Metro bundler log parsing
- Auto-reconnect on app reload
- `stream_logs` with live filtering
