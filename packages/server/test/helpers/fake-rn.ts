import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import type { CDPTarget } from '../../src/cdp/discovery.js';

export interface FakeHermesOptions {
  /** CDP methods this runtime never answers (a Reanimated target hangs on Debugger.enable). */
  ignore?: string[];
  /** Value returned for a Runtime.evaluate expression; defaults mimic a healthy app. */
  respond?: (expression: string) => unknown;
  /** Close every connection as soon as it opens (a target that dies on attach). */
  dropOnConnect?: boolean;
  /** Like Hermes: a new debugger connection kicks the previous one. */
  singleDebugger?: boolean;
}

export interface FakeHermes {
  url: string;
  connections: WebSocket[];
  evaluations: string[];
  /** Drops every debugger connection (what an app reload does). */
  dropAll(): void;
  close(): Promise<void>;
}

/** Answers the core's own injected scripts the way a running app with a Redux store would. */
export function healthyAppResponses(expression: string): unknown {
  if (expression.includes('a.summaryJson()')) {
    return JSON.stringify({ stores: ['redux'], queryClient: false, navigation: true, pendingActions: 0 });
  }
  if (expression.includes('a.discover()')) {
    return JSON.stringify({ hasHook: true, stores: ['redux'], queryClient: false, navigation: true, visited: 100 });
  }
  if (expression.includes('XMLHttpRequest.prototype')) return true;
  if (expression.includes('arr.splice')) return '[]';
  return 'installed';
}

export async function startFakeHermes(options: FakeHermesOptions = {}): Promise<FakeHermes> {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  const { port } = wss.address() as AddressInfo;
  const connections: WebSocket[] = [];
  const evaluations: string[] = [];
  const ignored = new Set(options.ignore ?? []);
  const respond = options.respond ?? healthyAppResponses;

  wss.on('connection', (ws) => {
    if (options.singleDebugger) {
      for (const previous of connections) if (previous.readyState === previous.OPEN) previous.close();
    }
    connections.push(ws);
    if (options.dropOnConnect) {
      ws.close();
      return;
    }
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as { id: number; method: string; params?: { expression?: string } };
      if (ignored.has(msg.method)) return;
      if (msg.method === 'Runtime.evaluate') {
        const expression = msg.params?.expression ?? '';
        evaluations.push(expression);
        const value = respond(expression);
        ws.send(JSON.stringify({ id: msg.id, result: { result: { type: typeof value, value } } }));
        return;
      }
      ws.send(JSON.stringify({ id: msg.id, result: {} }));
    });
  });

  return {
    url: `ws://127.0.0.1:${port}/inspector/debug`,
    connections,
    evaluations,
    dropAll() {
      for (const ws of connections) ws.close();
    },
    close: () =>
      new Promise((resolve) => {
        for (const ws of connections) ws.terminate();
        wss.close(() => resolve());
      }),
  };
}

export interface FakeMetro {
  port: number;
  targets: CDPTarget[];
  close(): Promise<void>;
}

export async function startFakeMetro(initialTargets: CDPTarget[] = []): Promise<FakeMetro> {
  const metro: FakeMetro = { port: 0, targets: initialTargets, close: async () => undefined };
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/json')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(metro.targets));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  metro.port = (server.address() as AddressInfo).port;
  metro.close = () => new Promise((resolve) => server.close(() => resolve()));
  return metro;
}

export interface TargetIdentity {
  appId?: string;
  deviceName?: string;
  logicalDeviceId?: string;
}

export function fuseboxTarget(id: string, webSocketDebuggerUrl: string, identity: TargetIdentity = {}): CDPTarget {
  const appId = identity.appId ?? 'com.example.app';
  const deviceName = identity.deviceName ?? 'emulator - 15 - API 35';
  return {
    id,
    title: `${appId} (${deviceName.split(' ')[0]})`,
    description: 'React Native Bridgeless [C++ connection]',
    appId,
    deviceName,
    type: 'node',
    webSocketDebuggerUrl,
    reactNative: {
      capabilities: { prefersFuseboxFrontend: true },
      logicalDeviceId: identity.logicalDeviceId ?? `${appId}@${deviceName}`,
    },
  };
}

export function reanimatedTarget(id: string, webSocketDebuggerUrl: string): CDPTarget {
  return {
    id,
    title: 'com.example.app (emulator)',
    description: 'Reanimated UI runtime [C++ connection]',
    type: 'node',
    webSocketDebuggerUrl,
    reactNative: { capabilities: { prefersFuseboxFrontend: false } },
  };
}

/** A TCP port that nothing listens on right now. */
export async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not met in time');
    await sleep(15);
  }
}
