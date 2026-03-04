import { describe, it, expect } from 'vitest';
import { findHermesTarget, type CDPTarget } from '../src/cdp/discovery.js';

describe('findHermesTarget', () => {
  it('should return null for empty targets', () => {
    expect(findHermesTarget([])).toBeNull();
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
    expect(findHermesTarget(targets)).toBeNull();
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

    const result = findHermesTarget(targets);
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

    const result = findHermesTarget(targets);
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

    const result = findHermesTarget(targets);
    expect(result!.id).toBe('page2');
  });
});
