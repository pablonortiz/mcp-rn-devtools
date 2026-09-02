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

  async function twoMetros(): Promise<{ hermes: FakeHermes; picking: FakeMetro; wms: FakeMetro }> {
    const hermes = await startFakeHermes();
    const picking = await startFakeMetro([fuseboxTarget('p-1', hermes.url, { appId: 'in.janis.picking.beta', logicalDeviceId: 'p' })]);
    const wms = await startFakeMetro([fuseboxTarget('w-1', hermes.url, { appId: 'in.janis.wms.beta', logicalDeviceId: 'w' })]);
    cleanups.push(() => hermes.close(), () => picking.close(), () => wms.close());
    return { hermes, picking, wms };
  }

  it('finds the session app on another Metro even though the configured one is alive with a different app', async () => {
    const { picking, wms } = await twoMetros();
    const cm = new ConnectionManager({ metroPort: picking.port, scanPorts: [picking.port, wms.port], sessionAppIds: ['in.janis.wms'] });
    managers.push(cm);

    const resolved = await cm.resolveTarget();

    expect(resolved?.via).toBe('session-app');
    expect(resolved?.target.appId).toBe('in.janis.wms.beta');
    expect(resolved?.metroPort).toBe(wms.port);
  });

  it('prefers the configured Metro when the session app is there', async () => {
    const { picking, wms } = await twoMetros();
    const cm = new ConnectionManager({ metroPort: picking.port, scanPorts: [picking.port, wms.port], sessionAppIds: ['in.janis.picking'] });
    managers.push(cm);

    const resolved = await cm.resolveTarget();
    expect(resolved?.target.appId).toBe('in.janis.picking.beta');
    expect(resolved?.metroPort).toBe(picking.port);
  });

  it('falls back to the plain Metro heuristic when the session app is not running', async () => {
    const { picking, wms } = await twoMetros();
    const cm = new ConnectionManager({ metroPort: picking.port, scanPorts: [picking.port, wms.port], sessionAppIds: ['in.janis.delivery'] });
    managers.push(cm);

    const resolved = await cm.resolveTarget();
    expect(resolved?.via).toBe('metro');
    expect(resolved?.target.appId).toBe('in.janis.picking.beta');
  });

  it('a pinned target wins over the session app', async () => {
    const { picking, wms } = await twoMetros();
    const cm = new ConnectionManager({ metroPort: picking.port, scanPorts: [picking.port, wms.port], sessionAppIds: ['in.janis.wms'] });
    managers.push(cm);
    await cm.connectToTarget('p-1');

    const resolved = await cm.resolveTarget();
    expect(resolved?.via).toBe('pinned');
    expect(resolved?.target.id).toBe('p-1');
  });

  it('connect() follows the resolver across Metros', async () => {
    const { picking, wms } = await twoMetros();
    const cm = new ConnectionManager({ metroPort: picking.port, scanPorts: [picking.port, wms.port], sessionAppIds: ['in.janis.wms'] });
    managers.push(cm);

    await cm.connect();

    expect(cm.connected).toBe(true);
    expect(cm.metroPort).toBe(wms.port);
    expect(cm.currentTargetKey).toBe('w');
  });

  it('still switches Metro for an unknown app only when the configured port is dead', async () => {
    const { wms } = await twoMetros();
    const dead = await freePort();
    const cm = new ConnectionManager({ metroPort: dead, scanPorts: [dead, wms.port] });
    managers.push(cm);
    expect((await cm.resolveTarget())?.via).toBe('other-metro');
  });
});
