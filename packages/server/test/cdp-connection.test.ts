import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { CDPConnection } from '../src/cdp/connection.js';

const RESPONSE_DELAY = 50;

describe('CDPConnection', () => {
  let server: WebSocketServer;
  let port: number;

  beforeEach(async () => {
    server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    server.on('connection', (socket) => {
      socket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        setTimeout(() => {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ id: msg.id, result: { ok: true } }));
          }
        }, RESPONSE_DELAY);
      });
    });
    await new Promise((resolve) => server.once('listening', resolve));
    port = (server.address() as { port: number }).port;
  });

  afterEach(() => {
    server.close();
    for (const client of server.clients) client.terminate();
  });

  const url = () => `ws://127.0.0.1:${port}`;

  const waitForStaleClose = () => new Promise((r) => setTimeout(r, 150));

  it('connects and resolves send() with the command result', async () => {
    const cdp = new CDPConnection();
    await cdp.connect(url(), port);
    expect(cdp.connected).toBe(true);

    const result = await cdp.send('Runtime.enable');
    expect(result).toEqual({ ok: true });

    cdp.disconnect();
  });

  it('ignores the stale socket close after a reconnect (does not clobber state)', async () => {
    const cdp = new CDPConnection();
    await cdp.connect(url(), port);

    let disconnectedEvents = 0;
    cdp.on('disconnected', () => disconnectedEvents++);

    // select_target flow: disconnect old socket, immediately connect a new one.
    // The old socket's close event arrives async, after the new one is live.
    cdp.disconnect();
    await cdp.connect(url(), port);
    await waitForStaleClose();

    expect(cdp.connected).toBe(true);
    expect(disconnectedEvents).toBe(0);

    cdp.disconnect();
  });

  it('does not reject pending requests of the new connection when the stale close arrives', async () => {
    const cdp = new CDPConnection();
    await cdp.connect(url(), port);

    cdp.disconnect();
    await cdp.connect(url(), port);

    // Pending while the stale close lands (server responds after RESPONSE_DELAY)
    const result = await cdp.send('Debugger.enable');
    expect(result).toEqual({ ok: true });

    cdp.disconnect();
  });

  it('still emits disconnected when the CURRENT socket closes', async () => {
    const cdp = new CDPConnection();
    await cdp.connect(url(), port);

    const disconnected = new Promise((resolve) => cdp.once('disconnected', resolve));
    for (const client of server.clients) client.close();
    await disconnected;

    expect(cdp.connected).toBe(false);
  });

  it('rejects pending requests when the current connection drops', async () => {
    const cdp = new CDPConnection();
    await cdp.connect(url(), port);

    const pending = cdp.send('Runtime.enable');
    for (const client of server.clients) client.terminate();

    await expect(pending).rejects.toThrow('CDP connection closed');
    expect(cdp.connected).toBe(false);
  });

  it('rejects connect() when nothing is listening', async () => {
    server.close();
    const cdp = new CDPConnection();
    await expect(cdp.connect(url(), port)).rejects.toThrow();
    expect(cdp.connected).toBe(false);
  });
});
