import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type { QAReportPayload } from '@mcp-rn-devtools/shared';
import { QAReportManager, type QAEnricher } from '../src/managers/qa-report-manager.js';
import type { ConnectionManager } from '../src/managers/connection-manager.js';

vi.mock('../src/utils/adb-screenshot.js', () => ({
  captureAdbScreenshot: vi.fn().mockResolvedValue(false),
}));

function makePayload(overrides: Partial<QAReportPayload> = {}): QAReportPayload {
  return {
    note: 'La card no ocupa el width total',
    mode: 'queue',
    element: {
      frame: { top: 100, left: 16, width: 328, height: 120 },
      hierarchy: ['App', 'HomeScreen', 'PickingCard'],
      selectedIndex: 2,
      selectedName: 'PickingCard',
      componentStack: 'at PickingCard\nat HomeScreen',
      props: { testID: 'picking-card' },
      style: { borderRadius: 4, width: 328 },
      source: null,
    },
    screen: { width: 360, height: 800, scale: 2.625 },
    ...overrides,
  };
}

function makeConnectionManager(): ConnectionManager {
  return {
    connected: false,
    agentBridge: { getState: vi.fn().mockResolvedValue(null) },
    actionManager: { getActions: () => [{ id: 'a1', actionType: 'cart/add', timestamp: 1, duration: 1, changedKeys: [], storeName: 'redux' }] },
    networkManager: { getRequests: () => [{ id: 'n1', url: 'https://api/x', method: 'GET', status: 200, duration: 12, startTime: 1, source: 'cdp' }] },
    logManager: { getLogs: () => [{ id: 'l1', level: 'log', message: 'hello', args: [], timestamp: 1, source: 'cdp' }] },
    errorManager: { getErrors: () => [] },
  } as unknown as ConnectionManager;
}

const enricher: QAEnricher = {
  getNavigationState: vi.fn().mockResolvedValue({ currentRoute: { name: 'Home' } }),
  getAppState: vi.fn().mockResolvedValue({ session: { userToken: 'abc' } }),
};

describe('QAReportManager', () => {
  let baseDir: string;
  let manager: QAReportManager;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(tmpdir(), 'qa-reports-'));
    process.env.RN_QA_REPORTS_DIR = baseDir;
    manager = new QAReportManager(makeConnectionManager());
  });

  afterEach(async () => {
    delete process.env.RN_QA_REPORTS_DIR;
    await rm(baseDir, { recursive: true, force: true });
  });

  it('captures a report enriched with navigation, state and buffers, persisted to pending/', async () => {
    const report = await manager.capture(makePayload(), enricher);

    expect(report.status).toBe('pending');
    expect(report.navigation).toEqual({ currentRoute: { name: 'Home' } });
    expect(report.recentActions).toHaveLength(1);
    expect(report.recentNetwork[0]).toEqual({ url: 'https://api/x', method: 'GET', status: 200, duration: 12, error: undefined });
    expect(report.screenshot).toBeNull();

    const persisted = JSON.parse(
      await readFile(path.join(baseDir, 'pending', report.id, 'report.json'), 'utf-8'),
    );
    expect(persisted.note).toBe('La card no ocupa el width total');
  });

  it('redacts sensitive values in the enriched app state', async () => {
    const report = await manager.capture(makePayload(), enricher);
    expect((report.appState as { session: unknown }).session).toBe('[REDACTED]');
  });

  it('prefers the CDP agent state over the SDK when connected', async () => {
    const cm = makeConnectionManager();
    Object.defineProperty(cm, 'connected', { value: true });
    (cm.agentBridge.getState as ReturnType<typeof vi.fn>).mockResolvedValue({
      found: true,
      data: { cart: { items: 2 } },
    });
    manager = new QAReportManager(cm);

    const report = await manager.capture(makePayload(), enricher);
    expect(report.appState).toEqual({ cart: { items: 2 } });
  });

  it('lists by status and resolves reports into resolved/', async () => {
    const captured = await manager.capture(makePayload(), enricher);
    expect(await manager.list('pending')).toHaveLength(1);

    const resolved = await manager.resolve(captured.id, 'width 100% aplicado');
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolution).toBe('width 100% aplicado');
    expect(await manager.list('pending')).toHaveLength(0);
    expect(await manager.list('resolved')).toHaveLength(1);

    await expect(stat(path.join(baseDir, 'resolved', captured.id, 'report.json'))).resolves.toBeTruthy();
    await expect(stat(path.join(baseDir, 'pending', captured.id))).rejects.toThrow();
  });

  it('reloads persisted reports from disk in a fresh instance', async () => {
    const captured = await manager.capture(makePayload(), enricher);

    const freshManager = new QAReportManager(makeConnectionManager());
    const loaded = await freshManager.get(captured.id);
    expect(loaded?.note).toBe(captured.note);
  });

  it('waitForNext resolves with the next captured report and times out otherwise', async () => {
    const waiting = manager.waitForNext(5000);
    const captured = await manager.capture(makePayload({ mode: 'fix-now' }), enricher);
    await expect(waiting).resolves.toMatchObject({ id: captured.id, mode: 'fix-now' });

    await expect(manager.waitForNext(50)).resolves.toBeNull();
  });
});
