import { describe, it, expect } from 'vitest';
import { findReactNativeTarget, type CDPTarget } from '../src/cdp/discovery.js';

describe('findReactNativeTarget', () => {
  it('should return null for empty targets', () => {
    expect(findReactNativeTarget([])).toBeNull();
  });

  it('should return null when no Hermes targets', () => {
    const targets: CDPTarget[] = [
      {
        id: '1',
        title: 'Chrome',
        description: '',
        type: 'page',
        webSocketDebuggerUrl: 'ws://localhost:8081/inspector/debug?page=1',
      },
    ];
    expect(findReactNativeTarget(targets)).toBeNull();
  });

  it('should find Hermes target', () => {
    const targets: CDPTarget[] = [
      {
        id: '1',
        title: 'Hermes React Native',
        description: '',
        type: 'node',
        vm: 'Hermes',
        webSocketDebuggerUrl: 'ws://localhost:8081/inspector/debug?page=1',
      },
    ];

    const result = findReactNativeTarget(targets);
    expect(result).not.toBeNull();
    expect(result!.vm).toBe('Hermes');
  });

  it('should prefer targets with reactNative capabilities', () => {
    const targets: CDPTarget[] = [
      {
        id: '1',
        title: 'Old Hermes',
        description: '',
        type: 'node',
        vm: 'Hermes',
        webSocketDebuggerUrl: 'ws://localhost:8081/inspector/debug?page=1',
      },
      {
        id: '2',
        title: 'Modern Hermes',
        description: '',
        type: 'node',
        vm: 'Hermes',
        webSocketDebuggerUrl: 'ws://localhost:8081/inspector/debug?page=2',
        reactNative: {
          capabilities: { nativePageReloads: true },
        },
      },
    ];

    const result = findReactNativeTarget(targets);
    expect(result!.id).toBe('2');
  });

  it('should skip synthetic pages (ID ending in -1)', () => {
    const targets: CDPTarget[] = [
      {
        id: 'page-1',
        title: 'Synthetic',
        description: '',
        type: 'node',
        vm: 'Hermes',
        webSocketDebuggerUrl: 'ws://localhost:8081/inspector/debug?page=-1',
      },
      {
        id: 'page2',
        title: 'Real',
        description: '',
        type: 'node',
        vm: 'Hermes',
        webSocketDebuggerUrl: 'ws://localhost:8081/inspector/debug?page=2',
      },
    ];

    const result = findReactNativeTarget(targets);
    expect(result!.id).toBe('page2');
  });

  // RN 0.76+ (Fusebox) no longer sets vm: 'Hermes'. Payload captured from a real
  // RN 0.80 bridgeless app: main runtime has prefersFuseboxFrontend, and Reanimated
  // registers a second runtime that must never be picked.
  it('should find the main runtime on RN 0.76+ targets without vm field', () => {
    const targets: CDPTarget[] = [
      {
        id: 'abc123-1',
        title: 'in.janis.delivery.beta (sdk_gphone16k_arm64)',
        description: 'React Native Bridgeless [C++ connection]',
        type: 'node',
        webSocketDebuggerUrl: 'ws://localhost:8081/inspector/debug?device=abc123&page=1',
        reactNative: {
          logicalDeviceId: 'abc123',
          capabilities: {
            prefersFuseboxFrontend: true,
            nativeSourceCodeFetching: false,
            nativePageReloads: true,
          },
        },
      },
      {
        id: 'abc123-2',
        title: 'in.janis.delivery.beta (sdk_gphone16k_arm64)',
        description: 'Reanimated UI runtime [C++ connection]',
        type: 'node',
        webSocketDebuggerUrl: 'ws://localhost:8081/inspector/debug?device=abc123&page=2',
        reactNative: {
          logicalDeviceId: 'abc123',
          capabilities: {
            prefersFuseboxFrontend: false,
            nativeSourceCodeFetching: false,
            nativePageReloads: false,
          },
        },
      },
    ];

    const result = findReactNativeTarget(targets);
    expect(result!.id).toBe('abc123-1');
  });

  it('should never pick a Reanimated runtime even if it is the only capable one', () => {
    const targets: CDPTarget[] = [
      {
        id: 'abc123-2',
        title: 'app',
        description: 'Reanimated UI runtime [C++ connection]',
        type: 'node',
        webSocketDebuggerUrl: 'ws://localhost:8081/inspector/debug?device=abc123&page=2',
        reactNative: {
          capabilities: { prefersFuseboxFrontend: false },
        },
      },
    ];

    expect(findReactNativeTarget(targets)).toBeNull();
  });
});
