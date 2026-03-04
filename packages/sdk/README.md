# mcp-rn-devtools-sdk

React Native SDK for [mcp-rn-devtools](https://www.npmjs.com/package/mcp-rn-devtools). Adds enhanced network interception and navigation state reporting to your running app.

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

### With React Navigation

```tsx
import { RNDevtoolsProvider } from 'mcp-rn-devtools-sdk';
import { NavigationContainer } from '@react-navigation/native';

const navigationRef = useNavigationContainerRef();

<RNDevtoolsProvider navigationRef={navigationRef}>
  <NavigationContainer ref={navigationRef}>
    <App />
  </NavigationContainer>
</RNDevtoolsProvider>
```

## Production Safety

The SDK checks `__DEV__` at the top level. In production builds, `<RNDevtoolsProvider>` renders only its children with zero overhead. Metro's dead code elimination removes the dev implementation.

## License

MIT
