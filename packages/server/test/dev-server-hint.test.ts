import { describe, it, expect } from 'vitest';
import { parseDevServerHint } from '../src/utils/dev-server-hint.js';

describe('parseDevServerHint', () => {
  it('reads the host:port RN failed to reach', () => {
    const logcat = [
      '09-02 01:10:00.000  1234  1234 W ReactNativeJS: something else',
      '09-02 01:10:01.000  1234  1234 E ReactNative: The packager does not seem to be running. Failed to connect to /10.0.2.2:8083',
    ].join('\n');
    expect(parseDevServerHint(logcat)).toEqual({
      host: '10.0.2.2',
      port: 8083,
      line: '09-02 01:10:01.000  1234  1234 E ReactNative: The packager does not seem to be running. Failed to connect to /10.0.2.2:8083',
    });
  });

  it('reads the dev server URL from the bundle-load error', () => {
    const logcat = 'E unknown:ReactNative: Could not connect to development server.\nURL: http://10.0.2.2:8082/index.bundle?platform=android';
    expect(parseDevServerHint(logcat)).toMatchObject({ host: '10.0.2.2', port: 8082 });
  });

  it('prefers the most recent mention', () => {
    const logcat = 'Failed to connect to /10.0.2.2:8082\nlater: Cannot connect to Metro. URL: 10.0.2.2:8084';
    expect(parseDevServerHint(logcat)).toMatchObject({ port: 8084 });
  });

  it('returns null when nothing matches', () => {
    expect(parseDevServerHint('W ActivityManager: nothing relevant')).toBeNull();
  });
});
