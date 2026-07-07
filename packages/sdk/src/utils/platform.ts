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
  const scriptURL = (NativeModules as { SourceCode?: { scriptURL?: string } })
    ?.SourceCode?.scriptURL;
  const host = scriptURL?.match(/^https?:\/\/([^:/]+)/)?.[1];
  if (host) return host;

  if (Platform.OS === 'android') {
    return '10.0.2.2';
  }
  return 'localhost';
}
