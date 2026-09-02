import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConnectionManager } from '../src/managers/connection-manager.js';
import {
  startFakeHermes,
  startFakeMetro,
  fuseboxTarget,
  reanimatedTarget,
  freePort,
  sleep,
  waitFor,
  type FakeHermes,
  type FakeMetro,
} from './helpers/fake-rn.js';

describe('ConnectionManager', () => {
  let hermes: FakeHermes;
  let metro: FakeMetro;
  const managers: ConnectionManager[] = [];
  const extra: Array<{ close(): Promise<void> }> = [];

  const make = (options: ConstructorParameters<typeof ConnectionManager>[0] = {}) => {
    const cm = new ConnectionManager({
      metroPort: metro.port,
      scanPorts: [],
      reconnect: { minMs: 20, maxMs: 40 },
      ...(typeof options === 'number' ? { metroPort: options } : options),
    });
    managers.push(cm);
    return cm;
  };

  beforeEach(async () => {
    hermes = await startFakeHermes();
    metro = await startFakeMetro([fuseboxTarget('app-1', hermes.url), reanimatedTarget('app-2', hermes.url)]);
  });

  afterEach(async () => {
    for (const cm of managers.splice(0)) cm.shutdown();
    for (const server of extra.splice(0)) await server.close();
    await metro.close();
    await hermes.close();
  });

  it('attaches to the main runtime and installs both injected scripts', async () => {
    const cm = make();
    await cm.connect();

    expect(cm.connected).toBe(true);
    expect(cm.currentTarget?.id).toBe('app-1');
    expect(cm.networkManager.interceptorInstalled).toBe(true);
    expect(hermes.evaluations.some((expression) => expression.includes("return 'installed'"))).toBe(true);
  });

  it('shares one attempt between concurrent connect() calls', async () => {
    const cm = make();
    await Promise.all([cm.connect(), cm.connect(), cm.connect()]);
    expect(hermes.connections).toHaveLength(1);
  });

  it('refuses to pin a library runtime and names the usable targets', async () => {
    const cm = make();
    await expect(cm.connectToTarget('app-2')).rejects.toThrow(/not the app's JS runtime.*app-1/);
    expect(cm.connected).toBe(false);
  });

  it('lists the available targets when the id is unknown', async () => {
    const cm = make();
    await expect(cm.connectToTarget('nope')).rejects.toThrow(/not found on Metro.*app-1/);
  });

  it('suspend() drops the debugger and stops reconnecting', async () => {
    const cm = make();
    await cm.connect();
    cm.suspend();

    expect(cm.connected).toBe(false);
    expect(cm.currentTarget).toBeNull();
    await sleep(150);
    expect(hermes.connections).toHaveLength(1);

    await cm.connect();
    expect(cm.connected).toBe(true);
  });

  it('reconnects when the app drops the connection (reload)', async () => {
    const cm = make();
    await cm.connect();
    hermes.dropAll();
    await waitFor(() => !cm.connected);
    await waitFor(() => cm.connected, 3000);
    expect(hermes.connections).toHaveLength(2);
  });

  it('switches to the only other Metro with an app when the configured port has no Metro at all', async () => {
    const dead = await freePort();
    const cm = make({ metroPort: dead, scanPorts: [dead, metro.port] });

    await cm.connect();

    expect(cm.connected).toBe(true);
    expect(cm.metroPort).toBe(metro.port);
  });

  it('stays on a running Metro that has no app yet (the app is about to appear there)', async () => {
    const empty = await startFakeMetro([]);
    extra.push(empty);
    const cm = make({ metroPort: empty.port, scanPorts: [empty.port, metro.port] });

    await cm.connect();

    expect(cm.connected).toBe(false);
    expect(cm.metroPort).toBe(empty.port);
  });

  it('does not guess between several Metros with apps', async () => {
    const dead = await freePort();
    const other = await startFakeMetro([fuseboxTarget('app-9', hermes.url)]);
    extra.push(other);
    const cm = make({ metroPort: dead, scanPorts: [dead, metro.port, other.port] });

    await cm.connect();

    expect(cm.connected).toBe(false);
    expect(cm.metroPort).toBe(dead);
  });

  it('tool calls during the reconnect loop share one attempt — never two debugger sockets', async () => {
    metro.targets = [];
    const cm = make();
    await cm.connect();
    expect(cm.connected).toBe(false);

    metro.targets = [fuseboxTarget('app-1', hermes.url)];
    await Promise.all([cm.connect(), cm.connect(), sleep(5).then(() => cm.connect())]);
    await sleep(150);

    expect(cm.connected).toBe(true);
    expect(hermes.connections).toHaveLength(1);
  });

  it('unpins a target that keeps failing', async () => {
    const dying = await startFakeHermes({ dropOnConnect: true });
    extra.push(dying);
    metro.targets = [fuseboxTarget('app-1', dying.url)];
    const cm = make();

    await expect(cm.connectToTarget('app-1')).rejects.toThrow();
    expect(cm.pinnedTargetId).toBe('app-1');
    await waitFor(() => cm.pinnedTargetId === null, 4000);
  });
});
