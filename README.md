# mcp-rn-devtools

MCP server that gives Claude (or any MCP host) real-time access to your running React Native app's internals — console logs, errors, warnings, network requests, and navigation state.

## How it works

```
Claude / MCP Host
       │ MCP (stdio)
       ▼
  mcp-rn-devtools (server)
    ├── CDP WebSocket ──► RN App (Hermes / Metro)
    └── SDK WebSocket ◄── mcp-rn-devtools-sdk (optional)
```

**Layer 1 (zero config):** The server connects to your app via Chrome DevTools Protocol (CDP) through Metro's inspector proxy. No app changes needed. Covers console logs, errors, warnings, network requests, and health checks.

**Layer 2 (optional SDK):** Install `mcp-rn-devtools-sdk` in your app for more robust network interception, navigation state, and future features.

## Quick Start

### 1. Add to your MCP config

```json
{
  "mcpServers": {
    "rn-devtools": {
      "command": "npx",
      "args": ["mcp-rn-devtools"]
    }
  }
}
```

### 2. Start your React Native app

Make sure Metro is running and your app is using Hermes (default since RN 0.70).

### 3. Ask Claude about your app

- "What errors is my app showing?"
- "Show me the recent network requests"
- "Are there any warnings I should fix?"
- "What's the health status of my running app?"

## Available Tools

| Tool | Description |
|------|-------------|
| `get_console_logs` | Console output with level filter and search |
| `get_errors` | JS errors and exceptions with stack traces |
| `get_warnings` | LogBox warnings |
| `get_network_requests` | HTTP requests with status, timing, URL |
| `get_failed_requests` | Requests with status >= 400 or network errors |
| `get_navigation_state` | Current route, stack, params (requires SDK) |
| `health_check` | Connection status, error/warning/request counts |

## Optional: SDK Setup

For enhanced network capture and navigation state:

```bash
npm install mcp-rn-devtools-sdk --save-dev
```

```tsx
import { RNDevtoolsProvider } from 'mcp-rn-devtools-sdk';

// Basic (network interception only)
<RNDevtoolsProvider>
  <App />
</RNDevtoolsProvider>

// With navigation (React Navigation)
<RNDevtoolsProvider navigationRef={navigationRef}>
  <NavigationContainer ref={navigationRef}>
    <App />
  </NavigationContainer>
</RNDevtoolsProvider>
```

The SDK automatically strips itself from production builds via `__DEV__` checks.

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `METRO_PORT` | `8081` | Metro bundler port |
| `SDK_PORT` | `8098` | SDK WebSocket port |
| `MCP_RN_DEBUG` | - | Enable debug logging |

## Compatibility

- **React Native:** 0.71+
- **Engine:** Hermes only (auto-detected)
- **Platforms:** iOS, Android
- **Node.js:** 18+

## License

MIT
