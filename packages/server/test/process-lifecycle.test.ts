import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { exitWhenOrphaned } from '../src/utils/process-lifecycle.js';

describe('exitWhenOrphaned', () => {
  it('shuts down and exits when stdin ends, once', () => {
    const stdin = new EventEmitter();
    const shutdown = vi.fn();
    const exit = vi.fn();
    exitWhenOrphaned(shutdown, { stdin, exit, parentPid: () => 42, checkIntervalMs: 60_000 });

    stdin.emit('end');
    stdin.emit('close');

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('exits when the parent process changes', async () => {
    const stdin = new EventEmitter();
    const shutdown = vi.fn();
    const exit = vi.fn();
    let parent = 42;
    exitWhenOrphaned(shutdown, { stdin, exit, parentPid: () => parent, checkIntervalMs: 5 });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(exit).not.toHaveBeenCalled();

    parent = 1;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('exits even if shutdown throws', () => {
    const stdin = new EventEmitter();
    const exit = vi.fn();
    exitWhenOrphaned(() => { throw new Error('boom'); }, { stdin, exit, parentPid: () => 42, checkIntervalMs: 60_000 });
    stdin.emit('end');
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('can be disposed', () => {
    const stdin = new EventEmitter();
    const exit = vi.fn();
    const dispose = exitWhenOrphaned(vi.fn(), { stdin, exit, parentPid: () => 42, checkIntervalMs: 60_000 });
    dispose();
    stdin.emit('end');
    expect(exit).not.toHaveBeenCalled();
  });
});
