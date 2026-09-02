import { describe, it, expect } from 'vitest';
import { isMainRuntimeTarget, scanMetroPorts } from '../src/cdp/discovery.js';
import { startFakeMetro, fuseboxTarget, reanimatedTarget, freePort } from './helpers/fake-rn.js';

describe('target classification and Metro scan', () => {
  it('tells the app runtime from library runtimes', () => {
    expect(isMainRuntimeTarget(fuseboxTarget('a', 'ws://x'))).toBe(true);
    expect(isMainRuntimeTarget(reanimatedTarget('b', 'ws://x'))).toBe(false);
    expect(isMainRuntimeTarget({ id: 'c', title: 'Chrome', description: '', type: 'page', webSocketDebuggerUrl: 'ws://x' })).toBe(false);
    expect(isMainRuntimeTarget({ id: 'd', title: 'legacy', description: '', type: 'node', vm: 'Hermes', webSocketDebuggerUrl: 'ws://x' })).toBe(true);
  });

  it('reports only the reachable Metros with their targets', async () => {
    const withApp = await startFakeMetro([fuseboxTarget('app-1', 'ws://x')]);
    const empty = await startFakeMetro([]);
    const closed = await freePort();

    const found = await scanMetroPorts([withApp.port, empty.port, closed]);

    expect(found.map((metro) => metro.port).sort()).toEqual([withApp.port, empty.port].sort());
    expect(found.find((metro) => metro.port === withApp.port)?.targets).toHaveLength(1);
    await withApp.close();
    await empty.close();
  });
});
