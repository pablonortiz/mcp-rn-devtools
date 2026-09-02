import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConnectionManager } from '../src/managers/connection-manager.js';
import { SDKBridgeServer } from '../src/sdk-bridge/sdk-server.js';
import { ConnectionOwnership } from '../src/ownership.js';
import { startFakeHermes, startFakeMetro, fuseboxTarget, freePort, waitFor, type FakeHermes, type FakeMetro } from './helpers/fake-rn.js';

interface Stack {
  cm: ConnectionManager;
  bridge: SDKBridgeServer;
  ownership: ConnectionOwnership;
}

describe('ConnectionOwnership — the debugger follows the session in use', () => {
  let hermes: FakeHermes;
  let metro: FakeMetro;
  let sdkPort: number;
  const stacks: Stack[] = [];

  const make = (): Stack => {
    const cm = new ConnectionManager({ metroPort: metro.port, scanPorts: [], reconnect: { minMs: 20, maxMs: 40 } });
    const bridge = new SDKBridgeServer(cm);
    const stack = { cm, bridge, ownership: new ConnectionOwnership(cm, bridge) };
    stacks.push(stack);
    return stack;
  };

  beforeEach(async () => {
    hermes = await startFakeHermes();
    metro = await startFakeMetro([fuseboxTarget('app-1', hermes.url)]);
    sdkPort = await freePort();
  });

  afterEach(async () => {
    for (const { cm, bridge } of stacks.splice(0)) {
      bridge.stop();
      cm.shutdown();
    }
    await metro.close();
    await hermes.close();
  });

  it('a lazy instance claims the port and connects on its first tool call', async () => {
    const a = make();
    expect(a.cm.connected).toBe(false);

    await a.ownership.ensure();

    expect(a.bridge.holdsPort).toBe(true);
    expect(a.cm.connected).toBe(true);
  });

  it('a sibling that gets used takes the debugger over, and the first one gets it back when used again', async () => {
    const a = make();
    const b = make();
    await a.bridge.start(sdkPort);
    await a.ownership.ensure();
    expect(a.cm.connected).toBe(true);

    await b.bridge.start(sdkPort);
    expect(a.bridge.yielded).toBe(true);
    expect(a.cm.connected).toBe(false);
    await b.ownership.ensure();
    expect(b.cm.connected).toBe(true);

    await a.ownership.ensure();
    expect(a.bridge.holdsPort).toBe(true);
    expect(a.cm.connected).toBe(true);
    await waitFor(() => b.bridge.yielded && !b.cm.connected);
  });

  it('parallel tool calls never make the instance yield to itself', async () => {
    const a = make();

    await Promise.all([a.ownership.ensure(), a.ownership.ensure(), a.ownership.ensure()]);

    expect(a.bridge.holdsPort).toBe(true);
    expect(a.bridge.yielded).toBe(false);
    expect(a.cm.connected).toBe(true);
    expect(hermes.connections).toHaveLength(1);
  });

  it('connect: false only claims the port', async () => {
    const a = make();
    await a.bridge.start(sdkPort);
    await a.ownership.ensure({ connect: false });
    expect(a.bridge.holdsPort).toBe(true);
    expect(a.cm.connected).toBe(false);
  });
});
