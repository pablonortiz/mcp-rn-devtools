import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type { QAReportPayload } from '@mcp-rn-devtools/shared';
import { QAAgentRunner } from '../src/agent/qa-agent-runner.js';
import { writeConfig } from '../src/agent/qa-config.js';
import { QAReportManager, type QAEnricher } from '../src/managers/qa-report-manager.js';
import type { ConnectionManager } from '../src/managers/connection-manager.js';

vi.mock('../src/utils/adb-screenshot.js', () => ({
  captureAdbScreenshot: vi.fn().mockResolvedValue(false),
}));

const relaunchAppMock = vi.fn().mockResolvedValue(true);
vi.mock('../src/utils/adb.js', () => ({
  relaunchApp: (packageId: string) => relaunchAppMock(packageId),
}));

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  kill = vi.fn(() => this.emit('close', 143));
}

const spawnMock = vi.fn();
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const APP = 'in.janis.picking.beta';

const enricher: QAEnricher = {
  getNavigationState: vi.fn().mockResolvedValue({ currentRoute: { name: 'home' } }),
  getAppState: vi.fn().mockResolvedValue(null),
};

function makePayload(note: string): QAReportPayload {
  return {
    note,
    mode: 'fix-now',
    element: {
      frame: { top: 0, left: 0, width: 100, height: 40 },
      hierarchy: ['App', 'Home', 'Card'],
      selectedIndex: 2,
      selectedName: 'Card',
      componentStack: 'at Card',
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
    agentBridge: { getState: vi.fn().mockResolvedValue(null) },
    actionManager: { getActions: () => [] },
    networkManager: { getRequests: () => [] },
    logManager: { getLogs: () => [] },
    errorManager: { getErrors: () => [] },
  });
  Object.defineProperty(cm, 'qaReportManager', { value: new QAReportManager(cm) });
  return cm;
}

/** Drives one fake claude turn: capture the prompt, emit stream-json, close. */
function scriptTurn(child: FakeChild, sessionId: string, resultText: string): Promise<string> {
  return new Promise((resolvePrompt) => {
    const chunks: Buffer[] = [];
    child.stdin.on('data', (chunk) => chunks.push(chunk));
    child.stdin.on('end', () => {
      const prompt = Buffer.concat(chunks).toString();
      child.stdout.write(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: sessionId })}\n`);
      child.stdout.write(
        `${JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Edit', input: { file_path: '/repo/src/Card.js' } },
              { type: 'text', text: resultText },
            ],
          },
        })}\n`,
      );
      child.stdout.write(
        `${JSON.stringify({ type: 'result', subtype: 'success', session_id: sessionId, duration_ms: 5000, total_cost_usd: 0.03, result: resultText })}\n`,
      );
      setImmediate(() => child.emit('close', 0));
      resolvePrompt(prompt);
    });
  });
}

describe('QAAgentRunner', () => {
  let baseDir: string;
  let repoDir: string;
  let cm: ConnectionManager;
  let runner: QAAgentRunner;

  beforeEach(async () => {
    spawnMock.mockReset();
    relaunchAppMock.mockClear();
    baseDir = await mkdtemp(path.join(tmpdir(), 'qa-agent-'));
    repoDir = await mkdtemp(path.join(tmpdir(), 'qa-repo-'));
    process.env.RN_QA_REPORTS_DIR = baseDir;
    process.env.QA_AGENT_CLAUDE_BIN = '/fake/claude';
    cm = makeConnectionManager();
    runner = new QAAgentRunner(cm);
  });

  afterEach(async () => {
    runner.stop();
    delete process.env.RN_QA_REPORTS_DIR;
    delete process.env.QA_AGENT_CLAUDE_BIN;
    await rm(baseDir, { recursive: true, force: true });
    await rm(repoDir, { recursive: true, force: true });
  });

  it('refuses to start without a repo mapping', async () => {
    const result = await runner.start(APP);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No repo mapped');
  });

  it('processes a captured report: preamble prompt, session capture, resolve state, app reload', async () => {
    await writeConfig(baseDir, { apps: { [APP]: repoDir } });
    expect((await runner.start(APP)).ok).toBe(true);
    expect(runner.state.status).toBe('waiting');

    const child = new FakeChild();
    spawnMock.mockReturnValueOnce(child);
    const promptPromise = scriptTurn(child, 'sess-1', 'Card arreglada');

    const turnDone = new Promise<void>((resolve) => {
      runner.on('activity', (activity) => {
        if (activity.kind === 'turn-done') resolve();
      });
    });

    await cm.qaReportManager.capture(makePayload('La card no tiene el width total'), APP, enricher);
    const prompt = await promptPromise;
    await turnDone;
    await vi.waitFor(() => {
      if (runner.state.status !== 'waiting') throw new Error('still processing');
    });

    expect(prompt).toContain('Sos el agente de QA en vivo');
    expect(prompt).toContain('La card no tiene el width total');
    expect(runner.state.sessionId).toBe('sess-1');
    expect(relaunchAppMock).toHaveBeenCalledWith(APP);

    const [bin, args, options] = spawnMock.mock.calls[0];
    expect(bin).toBe('/fake/claude');
    expect(args).toContain('--permission-mode');
    expect(args).toContain('--strict-mcp-config');
    expect(args).not.toContain('--resume');
    expect(options.cwd).toBe(repoDir);

    const kinds = runner.state.activities.map((activity) => activity.kind);
    expect(kinds).toContain('tool-use');
    expect(kinds).toContain('agent-text');
    expect(kinds).toContain('turn-done');
  });

  it('chat turns resume the same session without the preamble', async () => {
    await writeConfig(baseDir, { apps: { [APP]: repoDir } });
    await runner.start(APP);

    const first = new FakeChild();
    spawnMock.mockReturnValueOnce(first);
    const firstPrompt = scriptTurn(first, 'sess-9', 'ok');
    await cm.qaReportManager.capture(makePayload('algo'), APP, enricher);
    await firstPrompt;
    await vi.waitFor(() => {
      if (runner.state.sessionId !== 'sess-9' || runner.state.status !== 'waiting') throw new Error('not ready');
    });

    const second = new FakeChild();
    spawnMock.mockReturnValueOnce(second);
    const secondPrompt = scriptTurn(second, 'sess-9', 'entendido');
    runner.send('no era esa card, es la de abajo');
    const prompt = await secondPrompt;

    expect(prompt).not.toContain('Sos el agente de QA en vivo');
    expect(prompt).toContain('no era esa card');
    const [, args] = spawnMock.mock.calls[1];
    expect(args).toContain('--resume');
    expect(args).toContain('sess-9');
  });

  it('stop kills the running turn and removes the presence file', async () => {
    await writeConfig(baseDir, { apps: { [APP]: repoDir } });
    await runner.start(APP);
    await vi.waitFor(async () => {
      await stat(path.join(baseDir, '.listener'));
    });

    runner.stop();
    expect(runner.state.status).toBe('off');
    await vi.waitFor(async () => {
      const gone = await stat(path.join(baseDir, '.listener')).catch(() => null);
      if (gone) throw new Error('presence file still there');
    });
  });

  it('ignores reports from other apps', async () => {
    await writeConfig(baseDir, { apps: { [APP]: repoDir } });
    await runner.start(APP);

    await cm.qaReportManager.capture(makePayload('de otra app'), 'in.janis.wms.beta', enricher);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('saved reports (mode queue) are NOT auto-processed, but enqueueReport runs them on demand', async () => {
    await writeConfig(baseDir, { apps: { [APP]: repoDir } });
    await runner.start(APP);

    const saved = await cm.qaReportManager.capture(
      { ...makePayload('lo guardo para después'), mode: 'queue' },
      APP,
      enricher,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(spawnMock).not.toHaveBeenCalled();
    expect(runner.state.activities.some((activity) => activity.text.includes('guardado'))).toBe(true);

    const child = new FakeChild();
    spawnMock.mockReturnValueOnce(child);
    const promptPromise = scriptTurn(child, 'sess-2', 'hecho');
    expect(runner.enqueueReport(saved).ok).toBe(true);
    const prompt = await promptPromise;
    expect(prompt).toContain('lo guardo para después');
  });

  it('enqueuePendingAll queues every pending report of the app once', async () => {
    await writeConfig(baseDir, { apps: { [APP]: repoDir } });
    await cm.qaReportManager.capture({ ...makePayload('primero'), mode: 'queue' }, APP, enricher);
    await cm.qaReportManager.capture({ ...makePayload('segundo'), mode: 'queue' }, APP, enricher);
    await cm.qaReportManager.capture({ ...makePayload('de otra app'), mode: 'queue' }, 'in.janis.wms.beta', enricher);

    expect((await runner.enqueuePendingAll()).ok).toBe(false); // agente apagado

    await runner.start(APP);
    const firstChild = new FakeChild();
    const secondChild = new FakeChild();
    spawnMock.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
    const firstPrompt = scriptTurn(firstChild, 'sess-3', 'ok');
    const secondPrompt = scriptTurn(secondChild, 'sess-3', 'ok');

    const result = await runner.enqueuePendingAll();
    expect(result).toMatchObject({ ok: true, queued: 2 });

    expect(await firstPrompt).toContain('primero');
    expect(await secondPrompt).toContain('segundo');
  });
});
