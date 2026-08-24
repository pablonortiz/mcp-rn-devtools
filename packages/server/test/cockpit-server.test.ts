import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { CockpitServer } from '../src/cockpit/cockpit-server.js';
import { QAReportManager, type QAEnricher } from '../src/managers/qa-report-manager.js';
import type { ConnectionManager } from '../src/managers/connection-manager.js';
import type { SDKBridgeServer } from '../src/sdk-bridge/sdk-server.js';
import type { QAReportPayload } from '@mcp-rn-devtools/shared';

vi.mock('../src/utils/adb-screenshot.js', () => ({
  captureAdbScreenshot: vi.fn().mockResolvedValue(false),
}));

const enricher: QAEnricher = {
  getNavigationState: vi.fn().mockResolvedValue({ currentRoute: { name: 'Home' } }),
  getAppState: vi.fn().mockResolvedValue(null),
};

function makePayload(): QAReportPayload {
  return {
    note: 'La card no ocupa el width total',
    mode: 'queue',
    element: {
      frame: { top: 100, left: 16, width: 328, height: 120 },
      hierarchy: ['App', 'HomeScreen', 'PickingCard'],
      selectedIndex: 2,
      selectedName: 'PickingCard',
      componentStack: 'at PickingCard',
      props: {},
      style: null,
      source: null,
    },
    screen: { width: 360, height: 800, scale: 2.625 },
  };
}

function makeConnectionManager(): ConnectionManager {
  const cm = new EventEmitter() as unknown as ConnectionManager;
  Object.assign(cm, {
    connected: false,
    sdkConnected: true,
    agentBridge: { getState: vi.fn().mockResolvedValue(null) },
    actionManager: { getActions: () => [] },
    networkManager: { getRequests: () => [] },
    logManager: { getLogs: () => [] },
    errorManager: { getErrors: () => [] },
  });
  Object.defineProperty(cm, 'qaReportManager', {
    value: new QAReportManager(cm),
  });
  return cm;
}

describe('CockpitServer', () => {
  let baseDir: string;
  let cm: ConnectionManager;
  let cockpit: CockpitServer;
  let baseUrl: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(tmpdir(), 'qa-cockpit-'));
    process.env.RN_QA_REPORTS_DIR = baseDir;
    cm = makeConnectionManager();
    const sdkBridge = { connectedApp: 'in.janis.picking.beta', yielded: false } as SDKBridgeServer;
    cockpit = new CockpitServer(cm, sdkBridge);
    cockpit.start(0);
    await vi.waitFor(() => {
      if (cockpit.port === null) throw new Error('not listening yet');
    });
    baseUrl = `http://127.0.0.1:${cockpit.port}`;
  });

  afterEach(async () => {
    cockpit.stop();
    delete process.env.RN_QA_REPORTS_DIR;
    await rm(baseDir, { recursive: true, force: true });
  });

  it('serves the cockpit page at /', async () => {
    const response = await fetch(baseUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('QA <span>Cockpit</span>');
  });

  it('reports state with connected app, channels and reports', async () => {
    await cm.qaReportManager.capture(makePayload(), 'in.janis.picking.beta', enricher);

    const state = await (await fetch(`${baseUrl}/api/state`)).json();
    expect(state.app).toBe('in.janis.picking.beta');
    expect(state.sdkConnected).toBe(true);
    expect(state.listenerActive).toBe(false);
    expect(state.reports).toHaveLength(1);
    expect(state.reports[0]).toMatchObject({
      note: 'La card no ocupa el width total',
      selectedName: 'PickingCard',
      route: 'Home',
      status: 'pending',
    });
  });

  it('listenerActive reflects a blocked qa_wait_for_report', async () => {
    const waiting = cm.qaReportManager.waitForNext(200);
    const state = await (await fetch(`${baseUrl}/api/state`)).json();
    expect(state.listenerActive).toBe(true);
    await waiting;
  });

  it('serves a full report by id and 404s unknown ids', async () => {
    const captured = await cm.qaReportManager.capture(makePayload(), 'in.janis.picking.beta', enricher);

    const report = await (await fetch(`${baseUrl}/api/reports/${captured.id}`)).json();
    expect(report.element.hierarchy).toEqual(['App', 'HomeScreen', 'PickingCard']);

    const missing = await fetch(`${baseUrl}/api/reports/nope`);
    expect(missing.status).toBe(404);
  });
});
