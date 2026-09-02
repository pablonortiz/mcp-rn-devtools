import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildHealthReport } from '../src/tools/health-report.js';
import { createStackFactory } from './helpers/stack.js';
import { startFakeHermes, startFakeMetro, fuseboxTarget, freePort, sleep, waitFor, type FakeHermes, type FakeMetro } from './helpers/fake-rn.js';

describe('ownership per target — sessions on different apps coexist', () => {
  let hermesX: FakeHermes;
  let hermesY: FakeHermes;
  let metro: FakeMetro;
  let sdkPort: number;
  let factory: ReturnType<typeof createStackFactory>;

  beforeEach(async () => {
    hermesX = await startFakeHermes({ singleDebugger: true });
    hermesY = await startFakeHermes({ singleDebugger: true });
    metro = await startFakeMetro([
      fuseboxTarget('x-1', hermesX.url, { appId: 'com.x.beta', deviceName: 'Pixel A', logicalDeviceId: 'device-x' }),
      fuseboxTarget('y-1', hermesY.url, { appId: 'com.y.beta', deviceName: 'Pixel B', logicalDeviceId: 'device-y' }),
    ]);
    sdkPort = await freePort();
    factory = createStackFactory();
  });

  afterEach(async () => {
    factory.cleanup();
    await metro.close();
    await hermesX.close();
    await hermesY.close();
  });

  const quietProbes = {
    probeMetro: async () => ({ reachable: false, targets: [] }),
    scanMetroPorts: async () => [],
    readDevServerHint: async () => null,
    latestVersion: async () => null,
  };

  it('two sessions hold two apps at the same time', async () => {
    const a = await factory.make({ metroPort: metro.port, sdkPort, sessionAppIds: ['com.x'], label: 'A' });
    const b = await factory.make({ metroPort: metro.port, sdkPort, sessionAppIds: ['com.y'], label: 'B' });

    await a.ownership.ensure();
    await b.ownership.ensure();

    expect(a.connectionManager.currentTarget?.appId).toBe('com.x.beta');
    expect(b.connectionManager.currentTarget?.appId).toBe('com.y.beta');
    expect(a.connectionManager.connected).toBe(true);
    expect(b.connectionManager.connected).toBe(true);
    expect(a.registry.others().map((record) => record.target?.appId)).toEqual(['com.y.beta']);
  });

  it('a third session on app X takes it only from the session holding X', async () => {
    const a = await factory.make({ metroPort: metro.port, sdkPort, sessionAppIds: ['com.x'], label: 'A' });
    const b = await factory.make({ metroPort: metro.port, sdkPort, sessionAppIds: ['com.y'], label: 'B' });
    const c = await factory.make({ metroPort: metro.port, sdkPort, sessionAppIds: ['com.x'], label: 'C' });
    await a.ownership.ensure();
    await b.ownership.ensure();

    await c.ownership.ensure();

    expect(c.connectionManager.connected).toBe(true);
    expect(a.connectionManager.connected).toBe(false);
    expect(b.connectionManager.connected).toBe(true);

    await a.ownership.ensure();
    expect(a.connectionManager.connected).toBe(true);
    await waitFor(() => !c.connectionManager.connected);
    expect(b.connectionManager.connected).toBe(true);
  });

  it('an instance kicked by a sibling does not fight back', async () => {
    const a = await factory.make({ metroPort: metro.port, sdkPort, sessionAppIds: ['com.x'], label: 'A' });
    const intruder = await factory.make({ metroPort: metro.port, sdkPort, sessionAppIds: ['com.x'], label: 'I' });
    await a.ownership.ensure();

    // Attach without asking (what a pre-0.5 instance would do); Hermes drops A
    await intruder.connectionManager.connect();
    await waitFor(() => !a.connectionManager.connected);
    await sleep(250);

    expect(intruder.connectionManager.connected).toBe(true);
    expect(hermesX.connections).toHaveLength(2);
    expect(a.registry.holderOf('device-x')?.label).toBe('I');
  });

  it('select_target-style claim yields only the target asked for', async () => {
    const a = await factory.make({ metroPort: metro.port, sdkPort, sessionAppIds: ['com.x'], label: 'A' });
    const b = await factory.make({ metroPort: metro.port, sdkPort, sessionAppIds: ['com.y'], label: 'B' });
    const c = await factory.make({ metroPort: metro.port, sdkPort, label: 'C' });
    await a.ownership.ensure();
    await b.ownership.ensure();

    const [wanted] = await c.connectionManager.findTargetsForApp(['com.y']);
    await c.ownership.claimTarget(wanted);
    await c.connectionManager.connectToTarget(wanted.target.id, wanted.metroPort);

    expect(c.connectionManager.currentTarget?.appId).toBe('com.y.beta');
    expect(b.connectionManager.connected).toBe(false);
    expect(a.connectionManager.connected).toBe(true);
  });

  it('health report shows the session app, the owner and the other instances', async () => {
    const a = await factory.make({ metroPort: metro.port, sdkPort, sessionAppIds: ['com.x'], label: 'A' });
    const b = await factory.make({ metroPort: metro.port, sdkPort, sessionAppIds: ['com.y'], label: 'B' });
    await a.ownership.ensure();
    await b.ownership.ensure();

    const report = await buildHealthReport(a.connectionManager, a.sdkBridge, quietProbes, { registry: a.registry, sessionApp: a.sessionApp });

    expect(report).toContain('Session app: com.x (options)');
    expect(report).toContain('Debugger owner: this instance — com.x.beta @ Pixel A');
    expect(report).toMatch(/Other instances:\n\s+B .* → com\.y\.beta @ Pixel B \(connected\)/);
  });

  it('without a session app, a lazy instance behaves like before (whatever the Metro serves)', async () => {
    const a = await factory.make({ metroPort: metro.port, sdkPort, label: 'A' });
    await a.ownership.ensure();
    expect(a.connectionManager.connected).toBe(true);
    expect(a.connectionManager.currentTarget?.appId).toBe('com.x.beta');
  });
});
