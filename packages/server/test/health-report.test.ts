import { describe, it, expect, afterEach } from 'vitest';
import { ConnectionManager } from '../src/managers/connection-manager.js';
import { SDKBridgeServer } from '../src/sdk-bridge/sdk-server.js';
import { buildHealthReport, type HealthProbes } from '../src/tools/health-report.js';
import { startFakeHermes, startFakeMetro, fuseboxTarget, reanimatedTarget } from './helpers/fake-rn.js';

const quietProbes = (overrides: Partial<HealthProbes> = {}): HealthProbes => ({
  probeMetro: async () => ({ reachable: false, targets: [] }),
  scanMetroPorts: async () => [],
  readDevServerHint: async () => null,
  latestVersion: async () => null,
  ...overrides,
});

const firstLine = (report: string) => report.split('\n')[0];

describe('health report', () => {
  const managers: ConnectionManager[] = [];
  const disconnected = () => {
    const cm = new ConnectionManager({ metroPort: 8081, scanPorts: [8081, 8083] });
    managers.push(cm);
    return { cm, bridge: new SDKBridgeServer(cm) };
  };

  afterEach(() => {
    for (const cm of managers.splice(0)) cm.shutdown();
  });

  it('Metro down → BLOCKED with the start hint', async () => {
    const { cm, bridge } = disconnected();
    const report = await buildHealthReport(cm, bridge, quietProbes());
    expect(firstLine(report)).toMatch(/^BLOCKED: Metro is NOT running on port 8081/);
    expect(report).toContain('Version: ');
    expect(report).toContain('Debugger owner: unbound');
  });

  it('Metro down but an app on another Metro → points at it', async () => {
    const { cm, bridge } = disconnected();
    const probes = quietProbes({
      scanMetroPorts: async () => [{ port: 8083, targets: [fuseboxTarget('wms-1', 'ws://x')] }],
    });
    const report = await buildHealthReport(cm, bridge, probes);
    expect(firstLine(report)).toMatch(/^BLOCKED: Metro is not on :8081, but another Metro has an app/);
    expect(report).toContain(':8083 wms-1');
  });

  it('no targets and the app points elsewhere → names the port from logcat', async () => {
    const { cm, bridge } = disconnected();
    const probes = quietProbes({
      probeMetro: async () => ({ reachable: true, targets: [] }),
      readDevServerHint: async () => ({ host: '10.0.2.2', port: 8083, line: 'Failed to connect to /10.0.2.2:8083' }),
    });
    const report = await buildHealthReport(cm, bridge, probes);
    expect(firstLine(report)).toContain('the app points at 10.0.2.2:8083');
    expect(firstLine(report)).toContain('METRO_PORT=8083');
  });

  it('only a library runtime registered → treated as no app', async () => {
    const { cm, bridge } = disconnected();
    const probes = quietProbes({
      probeMetro: async () => ({ reachable: true, targets: [reanimatedTarget('r-2', 'ws://x')] }),
    });
    const report = await buildHealthReport(cm, bridge, probes);
    expect(firstLine(report)).toMatch(/^BLOCKED: Metro is running but no app registered a debug target/);
  });

  it('targets available but not attached → retry/select hint', async () => {
    const { cm, bridge } = disconnected();
    const probes = quietProbes({
      probeMetro: async () => ({ reachable: true, targets: [fuseboxTarget('app-1', 'ws://x')] }),
    });
    const report = await buildHealthReport(cm, bridge, probes);
    expect(firstLine(report)).toMatch(/^BLOCKED: 1 target\(s\) available but not attached yet/);
  });

  it('tells an unbound-but-reclaimable port from an incompatible holder', async () => {
    const { cm, bridge } = disconnected();
    const asRecord = bridge as unknown as Record<string, unknown>;
    asRecord._portConflict = true;
    expect(await buildHealthReport(cm, bridge, quietProbes())).toContain('takes it on its next tool call');
    asRecord._incompatibleHolder = true;
    expect(await buildHealthReport(cm, bridge, quietProbes())).toContain('does not yield — kill it');
  });

  it('mentions a newer published version', async () => {
    const { cm, bridge } = disconnected();
    const report = await buildHealthReport(cm, bridge, quietProbes({ latestVersion: async () => '99.0.0' }));
    expect(report).toContain('update available: 99.0.0');
  });

  it('connected → READY with stores discovered and capture status', async () => {
    const hermes = await startFakeHermes();
    const metro = await startFakeMetro([fuseboxTarget('app-1', hermes.url)]);
    const cm = new ConnectionManager({ metroPort: metro.port, scanPorts: [] });
    managers.push(cm);
    await cm.connect();

    const report = await buildHealthReport(cm, new SDKBridgeServer(cm), quietProbes());

    expect(firstLine(report)).toMatch(/^READY — com\.example\.app \(emulator\) \(app-1\) on Metro :\d+ · stores \[redux\]/);
    expect(firstLine(report)).toContain('network capture on');
    await metro.close();
    await hermes.close();
  });
});
