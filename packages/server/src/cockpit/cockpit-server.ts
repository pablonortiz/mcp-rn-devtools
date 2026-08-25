import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { readFile } from 'fs/promises';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { QA_COCKPIT_PORT } from '@mcp-rn-devtools/shared';
import type { QAReport } from '@mcp-rn-devtools/shared';
import type { ConnectionManager } from '../managers/connection-manager.js';
import type { SDKBridgeServer } from '../sdk-bridge/sdk-server.js';
import type { QAAgentRunner, AgentActivity } from '../agent/qa-agent-runner.js';
import { readConfig, writeConfig } from '../agent/qa-config.js';
import { relaunchApp } from '../utils/adb.js';
import { logger } from '../utils/logger.js';
import cockpitHtml from './cockpit.html';

const RETRY_MS = 3000;
const MAX_RETRIES = 10;

interface ReportSummary {
  id: string;
  app: string;
  status: string;
  mode: string;
  note: string;
  selectedName: string;
  route: string | null;
  createdAt: string;
  hasScreenshot: boolean;
  resolution?: string;
}

/**
 * The QA Cockpit: a local web page (device timeline + agent status) served by
 * the same process that owns the queue, so the capture loop stops being
 * invisible. HTTP for the page and REST reads, WebSocket for live updates.
 */
export class CockpitServer {
  private httpServer: Server | null = null;
  private wss: WebSocketServer | null = null;
  private retries = 0;
  private unsubscribers: Array<() => void> = [];

  constructor(
    private cm: ConnectionManager,
    private sdkBridge: SDKBridgeServer,
    private runner: QAAgentRunner,
  ) {}

  /** Bound port once listening (useful with an ephemeral port). */
  get port(): number | null {
    const address = this.httpServer?.address() as AddressInfo | null;
    return address?.port ?? null;
  }

  start(port: number = QA_COCKPIT_PORT): void {
    const server = createServer((req, res) => {
      void this.route(req, res).catch((e) => {
        logger.error('Cockpit request failed', (e as Error).message);
        this.json(res, 500, { error: 'internal error' });
      });
    });

    server.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        if (this.retries++ < MAX_RETRIES && !this.sdkBridge.yielded) {
          setTimeout(() => {
            server.close();
            this.start(port);
          }, RETRY_MS);
        } else {
          logger.warn(`Cockpit port ${port} stayed busy — another instance is serving it`);
        }
        return;
      }
      logger.error('Cockpit server error', err.message);
    });

    server.listen(port, '127.0.0.1', () => {
      logger.info(`QA Cockpit at http://localhost:${port}`);
    });

    this.httpServer = server;
    this.wss = new WebSocketServer({ server });
    this.wss.on('connection', (socket) => {
      void this.snapshot().then((data) => {
        socket.send(JSON.stringify({ type: 'snapshot', data }));
      });
    });

    this.subscribe();
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.wss?.close();
    this.httpServer?.close();
    this.wss = null;
    this.httpServer = null;
  }

  private subscribe(): void {
    if (this.unsubscribers.length > 0) return;

    const qa = this.cm.qaReportManager;
    const onCaptured = (report: QAReport) => {
      this.broadcast({ type: 'report:new', report: summarize(report) });
      void this.pushState();
    };
    const onResolved = (report: QAReport) => {
      this.broadcast({ type: 'report:resolved', report: summarize(report) });
    };
    const onWaiters = () => void this.pushState();
    const onSdk = () => void this.pushState();
    const onShutdown = () => this.stop();
    const onAgentStatus = (state: unknown) => {
      this.broadcast({ type: 'agent:status', data: state });
      void this.pushState();
    };
    const onAgentActivity = (activity: AgentActivity) => {
      this.broadcast({ type: 'agent:activity', activity });
    };

    qa.on('captured', onCaptured);
    qa.on('resolved', onResolved);
    qa.on('waiters-changed', onWaiters);
    this.cm.on('sdk-connected-changed', onSdk);
    this.cm.on('shutdown', onShutdown);
    this.runner.on('status', onAgentStatus);
    this.runner.on('activity', onAgentActivity);

    this.unsubscribers = [
      () => qa.off('captured', onCaptured),
      () => qa.off('resolved', onResolved),
      () => qa.off('waiters-changed', onWaiters),
      () => this.cm.off('sdk-connected-changed', onSdk),
      () => this.cm.off('shutdown', onShutdown),
      () => this.runner.off('status', onAgentStatus),
      () => this.runner.off('activity', onAgentActivity),
    ];
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const screenshotMatch = url.pathname.match(/^\/api\/reports\/([^/]+)\/screenshot$/);
    const reportMatch = url.pathname.match(/^\/api\/reports\/([^/]+)$/);

    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(cockpitHtml);
      return;
    }

    if (url.pathname === '/api/state') {
      this.json(res, 200, await this.snapshot());
      return;
    }

    if (screenshotMatch) {
      await this.serveScreenshot(res, screenshotMatch[1]);
      return;
    }

    if (reportMatch) {
      const report = await this.cm.qaReportManager.get(reportMatch[1]);
      if (!report) return this.json(res, 404, { error: 'not found' });
      this.json(res, 200, report);
      return;
    }

    if (url.pathname === '/api/reload' && req.method === 'POST') {
      const app = this.sdkBridge.connectedApp;
      if (!app) return this.json(res, 409, { ok: false, error: 'no app connected' });
      const ok = await relaunchApp(app);
      this.json(res, ok ? 200 : 502, { ok, app });
      return;
    }

    const resolveMatch = url.pathname.match(/^\/api\/reports\/([^/]+)\/resolve$/);
    if (resolveMatch && req.method === 'POST') {
      const body = await readBody(req);
      const report = await this.cm.qaReportManager.resolve(
        resolveMatch[1],
        typeof body.resolution === 'string' ? body.resolution : undefined,
      );
      if (!report) return this.json(res, 404, { ok: false, error: 'not found' });
      this.json(res, 200, { ok: true, id: report.id, status: report.status });
      return;
    }

    if (url.pathname === '/api/agent/state') {
      this.json(res, 200, this.runner.state);
      return;
    }

    if (url.pathname === '/api/agent/start' && req.method === 'POST') {
      const body = await readBody(req);
      const app = (typeof body.app === 'string' && body.app) || this.sdkBridge.connectedApp;
      if (!app) return this.json(res, 409, { ok: false, error: 'no app connected or specified' });
      const result = await this.runner.start(app);
      this.json(res, result.ok ? 200 : 409, result);
      return;
    }

    if (url.pathname === '/api/agent/stop' && req.method === 'POST') {
      this.runner.stop();
      this.json(res, 200, { ok: true });
      return;
    }

    if (url.pathname === '/api/agent/send' && req.method === 'POST') {
      const body = await readBody(req);
      if (typeof body.text !== 'string' || !body.text.trim()) {
        return this.json(res, 400, { ok: false, error: 'text required' });
      }
      this.json(res, 200, this.runner.send(body.text.trim()));
      return;
    }

    if (url.pathname === '/api/config') {
      const baseDir = this.cm.qaReportManager.baseDir;
      if (req.method === 'PUT') {
        const body = await readBody(req);
        const apps = (body.apps ?? {}) as Record<string, string>;
        await writeConfig(baseDir, { apps });
        this.json(res, 200, { ok: true, apps });
        return;
      }
      this.json(res, 200, await readConfig(baseDir));
      return;
    }

    this.json(res, 404, { error: 'not found' });
  }

  private async serveScreenshot(res: ServerResponse, id: string): Promise<void> {
    const report = await this.cm.qaReportManager.get(id);
    if (!report?.screenshot) return this.json(res, 404, { error: 'no screenshot' });

    const file = path.join(this.cm.qaReportManager.reportDir(report), report.screenshot);
    const png = await readFile(file).catch(() => null);
    if (!png) return this.json(res, 404, { error: 'screenshot missing on disk' });

    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600' });
    res.end(png);
  }

  private async snapshot(): Promise<Record<string, unknown>> {
    const reports = await this.cm.qaReportManager.list();
    return {
      ...this.baseState(),
      baseDir: this.cm.qaReportManager.baseDir,
      reports: reports.map(summarize).reverse(),
    };
  }

  private baseState(): Record<string, unknown> {
    const { activities: _omit, ...agent } = this.runner.state;
    return {
      app: this.sdkBridge.connectedApp,
      sdkConnected: this.cm.sdkConnected,
      cdpConnected: this.cm.connected,
      listenerActive: this.cm.qaReportManager.isListenerActive(),
      agent,
    };
  }

  private async pushState(): Promise<void> {
    this.broadcast({ type: 'state', data: this.baseState() });
  }

  private broadcast(message: Record<string, unknown>): void {
    if (!this.wss) return;
    const serialized = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(serialized);
    }
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
    if (Buffer.concat(chunks).length > 1024 * 1024) break;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
  } catch {
    return {};
  }
}

function summarize(report: QAReport): ReportSummary {
  const navigation = report.navigation as { currentRoute?: { name?: string } } | null;
  return {
    id: report.id,
    app: report.app,
    status: report.status,
    mode: report.mode,
    note: report.note,
    selectedName: report.element.selectedName,
    route: navigation?.currentRoute?.name ?? null,
    createdAt: report.createdAt,
    hasScreenshot: Boolean(report.screenshot),
    resolution: report.resolution,
  };
}
