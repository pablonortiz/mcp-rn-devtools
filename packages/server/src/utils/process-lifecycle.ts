import { logger } from './logger.js';

type StreamEvents = 'end' | 'close';

export interface LifecycleOptions {
  stdin?: { on(event: StreamEvents, listener: () => void): unknown; off(event: StreamEvents, listener: () => void): unknown };
  parentPid?: () => number;
  exit?: (code: number) => void;
  checkIntervalMs?: number;
}

/**
 * An MCP stdio server outlives a parent that dies without signalling: the
 * transport never watches stdin, and the reconnect timers keep the event loop
 * alive. Ending with the parent keeps stale instances from holding the
 * debugger for days.
 */
export function exitWhenOrphaned(shutdown: () => void, options: LifecycleOptions = {}): () => void {
  const stdin = options.stdin ?? process.stdin;
  const parentPid = options.parentPid ?? (() => process.ppid);
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const initialParent = parentPid();
  let done = false;

  const finish = (reason: string) => {
    if (done) return;
    done = true;
    logger.info(`Shutting down: ${reason}`);
    try {
      shutdown();
    } catch (e) {
      logger.error('Shutdown failed', (e as Error).message);
    }
    exit(0);
  };

  const onStdinEnd = () => finish('stdin closed (MCP client gone)');
  stdin.on('end', onStdinEnd);
  stdin.on('close', onStdinEnd);

  const timer = setInterval(() => {
    const current = parentPid();
    if (current !== initialParent || current === 1) finish(`parent process ${initialParent} is gone`);
  }, options.checkIntervalMs ?? 10_000);
  timer.unref();

  return () => {
    clearInterval(timer);
    stdin.off('end', onStdinEnd);
    stdin.off('close', onStdinEnd);
  };
}
