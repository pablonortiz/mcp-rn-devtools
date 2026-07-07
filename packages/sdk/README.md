# mcp-rn-devtools-sdk

**Optional enhancer** for [mcp-rn-devtools](https://www.npmjs.com/package/mcp-rn-devtools).

> **You probably don't need this package.** The MCP server works zero-config: it discovers Redux stores, reads AsyncStorage, records dispatched actions, and inspects React Navigation by injecting a runtime agent over CDP — with no changes to your app. Install this SDK only for what the agent can't reach:

- **Zustand / custom stores** — stores living in closures aren't discoverable from outside
- **MMKV** — pass your instance for key/value reading
- **Per-component render profiling** — `<RNDevtoolsProfiler>` wrapper
- **Navigation timing** — screen transition metrics over time
- **A second capture channel** for logs/errors/network that survives CDP drops

## Installation

```bash
npm install mcp-rn-devtools-sdk --save-dev
```

## Usage

```tsx
import { RNDevtoolsProvider } from 'mcp-rn-devtools-sdk';

// Wrap your app
<RNDevtoolsProvider>
  <App />
</RNDevtoolsProvider>
```

### With Zustand / custom stores

```tsx
const useAuthStore = create((set) => ({ /* ... */ }));

<RNDevtoolsProvider stateManagers={{ auth: useAuthStore }}>
  <App />
</RNDevtoolsProvider>
```

State snapshots are pull-only: serialized only when a tool asks — zero overhead while idle.

### With MMKV

```tsx
import { MMKV } from 'react-native-mmkv';
const storage = new MMKV();

<RNDevtoolsProvider mmkv={storage}>
  <App />
</RNDevtoolsProvider>
```

### With React Navigation (richer channel)

```tsx
import { RNDevtoolsProvider } from 'mcp-rn-devtools-sdk';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';

const navigationRef = useNavigationContainerRef();

<RNDevtoolsProvider navigationRef={navigationRef}>
  <NavigationContainer ref={navigationRef}>
    <App />
  </NavigationContainer>
</RNDevtoolsProvider>
```

The dev machine host is auto-detected from the bundle URL (`SourceCode.scriptURL`) — works on emulators, physical devices, and `adb reverse` without configuration.

## Production Safety

The SDK checks `__DEV__` at the top level. In production builds, `<RNDevtoolsProvider>` renders only its children with zero overhead. Metro's dead code elimination removes the dev implementation.

## License

MIT
