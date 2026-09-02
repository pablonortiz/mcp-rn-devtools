import { describe, it, expect, afterEach, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { ConnectionManager } from '../src/managers/connection-manager.js';
import { SDKBridgeServer } from '../src/sdk-bridge/sdk-server.js';
import { freePort, sleep, waitFor } from './helpers/fake-rn.js';

async function sendTakeover(port: number, instance: string): Promise<void> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });
  ws.send(JSON.stringify({ type: 'takeover', payload: { pid: process.pid, instance }, timestamp: Date.now(), id: 't' }));
  await sleep(100);
  ws.terminate();
}

describe('SDKBridgeServer ownership', () => {
  const bridges: SDKBridgeServer[] = [];
  const managers: ConnectionManager[] = [];

  const make = () => {
    const cm = new ConnectionManager({ metroPort: 1, scanPorts: [] });
    const bridge = new SDKBridgeServer(cm);
    managers.push(cm);
    bridges.push(bridge);
    return { cm, bridge };
  };

  afterEach(() => {
    for (const bridge of bridges.splice(0)) bridge.stop();
    for (const cm of managers.splice(0)) cm.shutdown();
  });

  it('the newest instance takes the port and the holder yields and suspends', async () => {
    const port = await freePort();
    const older = make();
    const suspend = vi.spyOn(older.cm, 'suspend');
    await older.bridge.start(port);
    expect(older.bridge.holdsPort).toBe(true);

    const newer = make();
    await newer.bridge.start(port);

    expect(newer.bridge.holdsPort).toBe(true);
    expect(older.bridge.holdsPort).toBe(false);
    expect(older.bridge.yielded).toBe(true);
    expect(suspend).toHaveBeenCalledTimes(1);
  });

  it('a yielded instance reclaims the port and the other one yields in turn', async () => {
    const port = await freePort();
    const first = make();
    const second = make();
    await first.bridge.start(port);
    await second.bridge.start(port);
    expect(first.bridge.yielded).toBe(true);

    expect(await first.bridge.reclaim()).toBe(true);

    expect(first.bridge.holdsPort).toBe(true);
    expect(first.bridge.yielded).toBe(false);
    await waitFor(() => second.bridge.yielded && !second.bridge.holdsPort);
  });

  it('a lazy start leaves the holder alone until reclaim()', async () => {
    const port = await freePort();
    const holder = make();
    const lazy = make();
    await holder.bridge.start(port);

    await lazy.bridge.start(port, { takeover: false });

    expect(lazy.bridge.holdsPort).toBe(false);
    expect(lazy.bridge.portConflict).toBe(true);
    expect(lazy.bridge.incompatibleHolder).toBe(false);
    expect(holder.bridge.holdsPort).toBe(true);
    expect(holder.bridge.yielded).toBe(false);

    expect(await lazy.bridge.reclaim()).toBe(true);
    expect(holder.bridge.yielded).toBe(true);
  });

  it('ignores a takeover request from itself (parallel tool calls racing to bind)', async () => {
    const port = await freePort();
    const only = make();
    await only.bridge.start(port);

    await sendTakeover(port, only.bridge.instanceId);
    expect(only.bridge.yielded).toBe(false);
    expect(only.bridge.holdsPort).toBe(true);

    await sendTakeover(port, 'some-other-instance');
    expect(only.bridge.yielded).toBe(true);
  });

  it('flags a holder that does not answer the takeover', async () => {
    const squatter = new WebSocketServer({ port: 0, host: '0.0.0.0' });
    await new Promise<void>((resolve) => squatter.once('listening', () => resolve()));
    squatter.on('connection', () => undefined);
    const port = (squatter.address() as { port: number }).port;
    const late = make();

    await late.bridge.start(port);

    expect(late.bridge.holdsPort).toBe(false);
    expect(late.bridge.incompatibleHolder).toBe(true);
    await new Promise<void>((resolve) => squatter.close(() => resolve()));
  });

  it('reclaim() is a no-op while holding the port', async () => {
    const port = await freePort();
    const only = make();
    await only.bridge.start(port);
    expect(await only.bridge.reclaim()).toBe(true);
    expect(only.bridge.yielded).toBe(false);
  });
});
