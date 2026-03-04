import { describe, it, expect, beforeEach } from 'vitest';
import { ErrorManager } from '../src/managers/error-manager.js';

describe('ErrorManager', () => {
  let manager: ErrorManager;

  beforeEach(() => {
    manager = new ErrorManager();
  });

  it('should capture errors from CDP console.error', () => {
    manager.addFromCDP({
      type: 'error',
      args: [{ type: 'string', value: 'TypeError: undefined is not a function' }],
      timestamp: Date.now(),
    });

    const errors = manager.getErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('TypeError: undefined is not a function');
    expect(errors[0].source).toBe('cdp');
    expect(errors[0].isFatal).toBe(false);
  });

  it('should capture warnings from CDP console.warn', () => {
    manager.addFromCDP({
      type: 'warning',
      args: [{ type: 'string', value: 'Deprecated: use newMethod instead' }],
      timestamp: Date.now(),
    });

    const warnings = manager.getWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toBe('Deprecated: use newMethod instead');
  });

  it('should not capture regular logs', () => {
    manager.addFromCDP({
      type: 'log',
      args: [{ type: 'string', value: 'Normal log' }],
      timestamp: Date.now(),
    });

    expect(manager.getErrors()).toHaveLength(0);
    expect(manager.getWarnings()).toHaveLength(0);
  });

  it('should capture stack traces', () => {
    manager.addFromCDP({
      type: 'error',
      args: [{ type: 'string', value: 'Error' }],
      stackTrace: {
        callFrames: [
          {
            functionName: 'handlePress',
            url: 'http://localhost:8081/index.bundle',
            lineNumber: 42,
            columnNumber: 10,
            scriptId: '1',
          },
        ],
      },
      timestamp: Date.now(),
    });

    const errors = manager.getErrors();
    expect(errors[0].stack).toHaveLength(1);
    expect(errors[0].stack![0].functionName).toBe('handlePress');
  });

  it('should filter errors by search', () => {
    manager.addFromCDP({
      type: 'error',
      args: [{ type: 'string', value: 'TypeError: x is undefined' }],
      timestamp: Date.now(),
    });
    manager.addFromCDP({
      type: 'error',
      args: [{ type: 'string', value: 'RangeError: invalid array length' }],
      timestamp: Date.now(),
    });

    const results = manager.getErrors({ search: 'TypeError' });
    expect(results).toHaveLength(1);
  });

  it('should track counts', () => {
    manager.addFromCDP({
      type: 'error',
      args: [{ type: 'string', value: 'Error 1' }],
      timestamp: Date.now(),
    });
    manager.addFromCDP({
      type: 'error',
      args: [{ type: 'string', value: 'Error 2' }],
      timestamp: Date.now(),
    });
    manager.addFromCDP({
      type: 'warning',
      args: [{ type: 'string', value: 'Warning 1' }],
      timestamp: Date.now(),
    });

    expect(manager.errorsCount).toBe(2);
    expect(manager.warningsCount).toBe(1);
  });

  it('should get recent errors', () => {
    for (let i = 0; i < 10; i++) {
      manager.addFromCDP({
        type: 'error',
        args: [{ type: 'string', value: `Error ${i}` }],
        timestamp: Date.now(),
      });
    }

    const recent = manager.getRecentErrors(3);
    expect(recent).toHaveLength(3);
    expect(recent[0].message).toBe('Error 7');
  });

  it('should add errors from SDK', () => {
    manager.addErrorFromSDK({
      id: 'sdk-err-1',
      timestamp: Date.now(),
      message: 'SDK fatal error',
      isFatal: true,
    });

    const errors = manager.getErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0].source).toBe('sdk');
    expect(errors[0].isFatal).toBe(true);
  });

  it('should respect buffer limit', () => {
    for (let i = 0; i < 250; i++) {
      manager.addFromCDP({
        type: 'error',
        args: [{ type: 'string', value: `Error ${i}` }],
        timestamp: Date.now(),
      });
    }

    expect(manager.errorsCount).toBe(200);
  });
});
