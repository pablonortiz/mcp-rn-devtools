import { describe, it, expect } from 'vitest';
import { targetKey, describeTargetApp } from '../src/cdp/target-key.js';
import { fuseboxTarget, reanimatedTarget } from './helpers/fake-rn.js';

describe('target identity', () => {
  it('uses logicalDeviceId, shared by both runtimes of an app', () => {
    const main = fuseboxTarget('dev-1', 'ws://x', { logicalDeviceId: 'abc123' });
    const worklets = { ...reanimatedTarget('dev-2', 'ws://x'), reactNative: { capabilities: {}, logicalDeviceId: 'abc123' } };
    expect(targetKey(main)).toBe('abc123');
    expect(targetKey(worklets)).toBe('abc123');
  });

  it('falls back to app + device for older runtimes', () => {
    expect(targetKey({ id: '1', title: 'Hermes React Native', description: '', type: 'node', vm: 'Hermes', webSocketDebuggerUrl: 'ws://x' })).toBe('Hermes React Native@');
    expect(targetKey({ id: '1', title: 't', description: '', type: 'node', appId: 'com.a', deviceName: 'Pixel', webSocketDebuggerUrl: 'ws://x' })).toBe('com.a@Pixel');
  });

  it('describes the app on its device', () => {
    expect(describeTargetApp(fuseboxTarget('1', 'ws://x', { appId: 'in.janis.wms.beta', deviceName: 'Pixel 8a - 15 - API 35' }))).toBe('in.janis.wms.beta @ Pixel 8a - 15 - API 35');
  });
});
