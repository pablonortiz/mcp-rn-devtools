# mcp-rn-devtools-sdk

**Optional enhancer** for [mcp-rn-devtools](https://www.npmjs.com/package/mcp-rn-devtools).

> **You probably don't need this package.** The MCP server works zero-config: it discovers Redux stores, reads AsyncStorage, records dispatched actions, and inspects React Navigation by injecting a runtime agent over CDP — with no changes to your app. Install this SDK only for what the agent can't reach:

- **QA capture overlay** — `qaOverlay` mounts a draggable QA button: tap any element on screen, annotate what's wrong, and the report (element + note + runtime context + screenshot) lands in a queue the MCP tools expose to your coding agent
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

### QA capture overlay

```tsx
<RNDevtoolsProvider qaOverlay>
  <App />
</RNDevtoolsProvider>
```

A draggable **QA** button appears in dev builds. Tapping it enters selection mode: tap any
element (the selection snaps to the touched view — arrows walk up/down the component
hierarchy), write what's wrong, and send it as **Guardar** (queue it) or **Corregir ya**
(fix now). The server enriches the report with navigation, app state, recent
actions/network/logs/errors and a device screenshot, and persists it to
`.qa-reports/pending/<id>/` where the `qa_*` MCP tools pick it up.

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
