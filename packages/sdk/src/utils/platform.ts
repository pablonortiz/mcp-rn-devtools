import { NativeModules, Platform } from 'react-native';

/**
 * Returns the host of the dev machine for connecting back to it.
 *
 * Primary source: the URL the device actually used to load the JS bundle
 * (`SourceCode.scriptURL`). This covers every topology with one rule:
 * iOS simulator (localhost), Android emulator (10.0.2.2), physical devices
 * via LAN IP, and `adb reverse` (localhost).
 *
 * Fallback (embedded bundle → file:// scriptURL): platform defaults.
 */
export function getDefaultHost(): string {
  const scriptURL = getScriptURL();
  const host = scriptURL?.match(/^https?:\/\/([^:/]+)/)?.[1];
  if (host) return host;

  if (Platform.OS === 'android') {
    return '10.0.2.2';
  }
  return 'localhost';
}

/**
 * Application id, from the `app=` query param Metro puts in the bundle URL
 * (e.g. "in.janis.picking.beta"). Null on embedded bundles.
 */
export function getAppId(): string | null {
  const scriptURL = getScriptURL();
  const appId = scriptURL?.match(/[?&]app=([^&]+)/)?.[1];
  return appId ? decodeURIComponent(appId) : null;
}

interface SourceCodeModule {
  scriptURL?: string;
  getConstants?: () => { scriptURL?: string };
}

function getScriptURL(): string | undefined {
  const sourceCode = (NativeModules as { SourceCode?: SourceCodeModule })?.SourceCode;
  // Legacy modules expose scriptURL as a property; TurboModules via getConstants()
  return sourceCode?.scriptURL ?? sourceCode?.getConstants?.().scriptURL;
}
