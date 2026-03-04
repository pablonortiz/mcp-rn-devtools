import { describe, it, expect, beforeEach } from 'vitest';
import { LogManager } from '../src/managers/log-manager.js';

describe('LogManager', () => {
  let manager: LogManager;

  beforeEach(() => {
    manager = new LogManager();
  });

  it('should add log entries from CDP', () => {
    manager.addFromCDP({
      type: 'log',
      args: [{ type: 'string', value: 'Hello world' }],
      timestamp: Date.now(),
    });

    const logs = manager.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe('Hello world');
    expect(logs[0].level).toBe('log');
    expect(logs[0].source).toBe('cdp');
  });

  it('should skip error and warning types', () => {
    manager.addFromCDP({
      type: 'error',
      args: [{ type: 'string', value: 'Error message' }],
      timestamp: Date.now(),
    });

    manager.addFromCDP({
      type: 'warning',
      args: [{ type: 'string', value: 'Warning message' }],
      timestamp: Date.now(),
    });

    expect(manager.getLogs()).toHaveLength(0);
  });

  it('should handle info and debug types', () => {
    manager.addFromCDP({
      type: 'info',
      args: [{ type: 'string', value: 'Info message' }],
      timestamp: Date.now(),
    });

    manager.addFromCDP({
      type: 'debug',
      args: [{ type: 'string', value: 'Debug message' }],
      timestamp: Date.now(),
    });

    const logs = manager.getLogs();
    expect(logs).toHaveLength(2);
    expect(logs[0].level).toBe('info');
    expect(logs[1].level).toBe('debug');
  });

  it('should filter by level', () => {
    manager.addFromCDP({
      type: 'log',
      args: [{ type: 'string', value: 'Log 1' }],
      timestamp: Date.now(),
    });
    manager.addFromCDP({
      type: 'info',
      args: [{ type: 'string', value: 'Info 1' }],
      timestamp: Date.now(),
    });

    const infoLogs = manager.getLogs({ level: 'info' });
    expect(infoLogs).toHaveLength(1);
    expect(infoLogs[0].level).toBe('info');
  });

  it('should filter by search string', () => {
    manager.addFromCDP({
      type: 'log',
      args: [{ type: 'string', value: 'Hello world' }],
      timestamp: Date.now(),
    });
    manager.addFromCDP({
      type: 'log',
      args: [{ type: 'string', value: 'Goodbye world' }],
      timestamp: Date.now(),
    });

    const results = manager.getLogs({ search: 'hello' });
    expect(results).toHaveLength(1);
    expect(results[0].message).toBe('Hello world');
  });

  it('should respect limit', () => {
    for (let i = 0; i < 10; i++) {
      manager.addFromCDP({
        type: 'log',
        args: [{ type: 'string', value: `Log ${i}` }],
        timestamp: Date.now(),
      });
    }

    const results = manager.getLogs({ limit: 3 });
    expect(results).toHaveLength(3);
    expect(results[0].message).toBe('Log 7');
  });

  it('should filter by since timestamp', () => {
    const now = Date.now();
    manager.addFromCDP({
      type: 'log',
      args: [{ type: 'string', value: 'Old log' }],
      timestamp: now - 10000,
    });
    manager.addFromCDP({
      type: 'log',
      args: [{ type: 'string', value: 'New log' }],
      timestamp: now,
    });

    const results = manager.getLogs({ since: now - 5000 });
    expect(results).toHaveLength(1);
    expect(results[0].message).toBe('New log');
  });

  it('should respect buffer size limit', () => {
    for (let i = 0; i < 600; i++) {
      manager.addFromCDP({
        type: 'log',
        args: [{ type: 'string', value: `Log ${i}` }],
        timestamp: Date.now(),
      });
    }

    expect(manager.count).toBe(500);
  });

  it('should format multiple args', () => {
    manager.addFromCDP({
      type: 'log',
      args: [
        { type: 'string', value: 'User:' },
        { type: 'object', description: '{name: "John"}' },
        { type: 'number', value: 42 },
      ],
      timestamp: Date.now(),
    });

    const logs = manager.getLogs();
    expect(logs[0].message).toBe('User: {name: "John"} 42');
  });

  it('should add entries from SDK', () => {
    manager.addFromSDK({
      id: 'sdk-1',
      timestamp: Date.now(),
      level: 'log',
      message: 'SDK log',
      args: [],
    });

    const logs = manager.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].source).toBe('sdk');
  });

  it('should clear all entries', () => {
    manager.addFromCDP({
      type: 'log',
      args: [{ type: 'string', value: 'test' }],
      timestamp: Date.now(),
    });

    manager.clear();
    expect(manager.count).toBe(0);
  });
});
