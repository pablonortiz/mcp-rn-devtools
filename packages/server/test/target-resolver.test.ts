import { describe, it, expect, afterEach } from 'vitest';
import { ConnectionManager } from '../src/managers/connection-manager.js';
import { startFakeHermes, startFakeMetro, fuseboxTarget, freePort, type FakeHermes, type FakeMetro } from './helpers/fake-rn.js';

describe('target resolution with a session app', () => {
  const cleanups: Array<() => Promise<void>> = [];
  const managers: ConnectionManager[] = [];

  afterEach(async () => {
    for (const cm of managers.splice(0)) cm.shutdown();
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function twoMetros(): Promise<{ hermes: FakeHermes; shop: FakeMetro; stock: FakeMetro }> {
    const hermes = await startFakeHermes();
    const shop = await startFakeMetro([fuseboxTarget('p-1', hermes.url, { appId: 'com.example.shop.beta', logicalDeviceId: 'p' })]);
    const stock = await startFakeMetro([fuseboxTarget('w-1', hermes.url, { appId: 'com.example.stock.beta', logicalDeviceId: 'w' })]);
    cleanups.push(() => hermes.close(), () => shop.close(), () => stock.close());
    return { hermes, shop, stock };
  }

  it('finds the session app on another Metro even though the configured one is alive with a different app', async () => {
    const { shop, stock } = await twoMetros();
    const cm = new ConnectionManager({ metroPort: shop.port, scanPorts: [shop.port, stock.port], sessionAppIds: ['com.example.stock'] });
    managers.push(cm);

    const resolved = await cm.resolveTarget();

    expect(resolved?.via).toBe('session-app');
    expect(resolved?.target.appId).toBe('com.example.stock.beta');
    expect(resolved?.metroPort).toBe(stock.port);
  });

  it('prefers the configured Metro when the session app is there', async () => {
    const { shop, stock } = await twoMetros();
    const cm = new ConnectionManager({ metroPort: shop.port, scanPorts: [shop.port, stock.port], sessionAppIds: ['com.example.shop'] });
    managers.push(cm);

    const resolved = await cm.resolveTarget();
    expect(resolved?.target.appId).toBe('com.example.shop.beta');
    expect(resolved?.metroPort).toBe(shop.port);
  });

  it('falls back to the plain Metro heuristic when the session app is not running', async () => {
    const { shop, stock } = await twoMetros();
    const cm = new ConnectionManager({ metroPort: shop.port, scanPorts: [shop.port, stock.port], sessionAppIds: ['com.example.courier'] });
    managers.push(cm);

    const resolved = await cm.resolveTarget();
    expect(resolved?.via).toBe('metro');
    expect(resolved?.target.appId).toBe('com.example.shop.beta');
  });

  it('a pinned target wins over the session app', async () => {
    const { shop, stock } = await twoMetros();
    const cm = new ConnectionManager({ metroPort: shop.port, scanPorts: [shop.port, stock.port], sessionAppIds: ['com.example.stock'] });
    managers.push(cm);
    await cm.connectToTarget('p-1');

    const resolved = await cm.resolveTarget();
    expect(resolved?.via).toBe('pinned');
    expect(resolved?.target.id).toBe('p-1');
  });

  it('connect() follows the resolver across Metros', async () => {
    const { shop, stock } = await twoMetros();
    const cm = new ConnectionManager({ metroPort: shop.port, scanPorts: [shop.port, stock.port], sessionAppIds: ['com.example.stock'] });
    managers.push(cm);

    await cm.connect();

    expect(cm.connected).toBe(true);
    expect(cm.metroPort).toBe(stock.port);
    expect(cm.currentTargetKey).toBe('w');
  });

  it('still switches Metro for an unknown app only when the configured port is dead', async () => {
    const { stock } = await twoMetros();
    const dead = await freePort();
    const cm = new ConnectionManager({ metroPort: dead, scanPorts: [dead, stock.port] });
    managers.push(cm);
    expect((await cm.resolveTarget())?.via).toBe('other-metro');
  });
});
