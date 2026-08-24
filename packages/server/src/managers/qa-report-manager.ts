import { EventEmitter } from 'events';
import { mkdir, readdir, readFile, rename, writeFile } from 'fs/promises';
import { homedir } from 'os';
import path from 'path';
import {
  QA_RECENT_ACTIONS,
  QA_RECENT_ERRORS,
  QA_RECENT_LOGS,
  QA_RECENT_NETWORK,
  QA_REPORTS_DIRNAME,
  QA_UNKNOWN_APP,
} from '@mcp-rn-devtools/shared';
import type { QAReport, QAReportPayload, QAReportStatus } from '@mcp-rn-devtools/shared';
import type { ConnectionManager } from './connection-manager.js';
import { captureAdbScreenshot } from '../utils/adb-screenshot.js';
import { redact } from '../utils/redact.js';
import { logger } from '../utils/logger.js';

/** Enrichment hooks the SDK bridge provides at capture time. */
export interface QAEnricher {
  getNavigationState(): Promise<unknown>;
  getAppState(): Promise<unknown>;
}

const SCREENSHOT_DELAY_MS = 600;
const APP_STATE_DEPTH = 3;

/**
 * Receives qa:report captures from the on-device overlay, enriches them with
 * everything the server already observes (navigation, state, network, logs,
 * errors, a device screenshot) and persists them as a reviewable queue,
 * global and keyed by app so reports survive server takeovers and cwd changes:
 * `~/.qa-reports/<app>/pending/<id>/report.json` + `screenshot.png`.
 *
 * Emits: 'captured' (report), 'resolved' (report), 'waiters-changed' (count).
 */
export class QAReportManager extends EventEmitter {
  private reports = new Map<string, QAReport>();
  private waiters: Array<(report: QAReport) => void> = [];
  private loadedFromDisk = false;
  private sequence = 0;

  constructor(private cm: ConnectionManager) {
    super();
  }

  get baseDir(): string {
    return process.env.RN_QA_REPORTS_DIR ?? path.join(homedir(), QA_REPORTS_DIRNAME);
  }

  /** True while a qa_wait_for_report call is blocked waiting for the next report. */
  get hasWaiters(): boolean {
    return this.waiters.length > 0;
  }

  async pendingCount(): Promise<number> {
    return (await this.list('pending')).length;
  }

  async capture(payload: QAReportPayload, app: string, enricher: QAEnricher): Promise<QAReport> {
    const id = this.nextId();
    const appName = sanitizeApp(app);
    const reportDir = path.join(this.baseDir, appName, 'pending', id);
    await mkdir(reportDir, { recursive: true });

    const [navigation, appState, screenshotOk] = await Promise.all([
      enricher.getNavigationState().catch(() => null),
      this.collectAppState(enricher),
      this.collectScreenshot(path.join(reportDir, 'screenshot.png')),
    ]);

    const report: QAReport = {
      id,
      createdAt: new Date().toISOString(),
      app: appName,
      status: 'pending',
      note: payload.note,
      mode: payload.mode,
      element: payload.element,
      screen: payload.screen,
      navigation: redact(navigation),
      appState: redact(appState),
      recentActions: redact(this.cm.actionManager.getActions().slice(-QA_RECENT_ACTIONS)),
      recentNetwork: this.cm.networkManager
        .getRequests()
        .slice(-QA_RECENT_NETWORK)
        .map(({ url, method, status, duration, error }) => ({ url, method, status, duration, error })),
      recentLogs: this.cm.logManager
        .getLogs()
        .slice(-QA_RECENT_LOGS)
        .map(({ level, message, timestamp }) => ({ level, message: message.slice(0, 500), timestamp })),
      recentErrors: this.cm.errorManager
        .getErrors()
        .slice(-QA_RECENT_ERRORS)
        .map(({ message, isFatal, timestamp, componentStack }) => ({
          message: message.slice(0, 1000),
          isFatal,
          timestamp,
          componentStack: componentStack?.slice(0, 2000),
        })),
      screenshot: screenshotOk ? 'screenshot.png' : null,
    };

    await this.persist(report);
    this.reports.set(id, report);
    logger.info(`QA report captured: ${appName}/${id} [${report.mode}] "${report.note.slice(0, 60)}"`);

    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve(report);
    if (waiters.length > 0) this.emit('waiters-changed', 0);
    this.emit('captured', report);

    return report;
  }

  async list(status?: QAReportStatus, app?: string): Promise<QAReport[]> {
    await this.ensureLoaded();
    let all = Array.from(this.reports.values()).sort((a, b) => a.id.localeCompare(b.id));
    if (status) all = all.filter((report) => report.status === status);
    if (app) all = all.filter((report) => report.app === app);
    return all;
  }

  async get(id: string): Promise<QAReport | null> {
    await this.ensureLoaded();
    return this.reports.get(id) ?? null;
  }

  async resolve(id: string, resolution?: string): Promise<QAReport | null> {
    await this.ensureLoaded();
    const report = this.reports.get(id);
    if (!report || report.status === 'resolved') return report ?? null;

    const pendingDir = this.reportDir(report);
    report.status = 'resolved';
    if (resolution) report.resolution = resolution;

    const resolvedDir = this.reportDir(report);
    await mkdir(path.dirname(resolvedDir), { recursive: true });
    await rename(pendingDir, resolvedDir).catch(() => null);
    await this.persist(report);
    this.emit('resolved', report);
    return report;
  }

  /** Resolves with the next report captured after this call; null on timeout. */
  waitForNext(timeoutMs: number): Promise<QAReport | null> {
    return new Promise((resolve) => {
      const waiter = (report: QAReport) => {
        clearTimeout(timer);
        resolve(report);
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((candidate) => candidate !== waiter);
        this.emit('waiters-changed', this.waiters.length);
        resolve(null);
      }, timeoutMs);
      this.waiters.push(waiter);
      this.emit('waiters-changed', this.waiters.length);
    });
  }

  reportDir(report: QAReport): string {
    return path.join(this.baseDir, report.app, report.status, report.id);
  }

  private async collectAppState(enricher: QAEnricher): Promise<unknown> {
    // Zero-config channel first: the agent discovers Redux without app changes
    if (this.cm.connected) {
      const result = await this.cm.agentBridge
        .getState(this.cm.cdp, undefined, undefined, APP_STATE_DEPTH)
        .catch(() => null);
      if (result?.found && !result.missing) return result.data;
    }
    return enricher.getAppState().catch(() => null);
  }

  private async collectScreenshot(outPath: string): Promise<boolean> {
    // Give the overlay panel and the keyboard time to dismiss on-device
    await new Promise((resolveDelay) => setTimeout(resolveDelay, SCREENSHOT_DELAY_MS));
    return captureAdbScreenshot(outPath);
  }

  private async persist(report: QAReport): Promise<void> {
    const dir = this.reportDir(report);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loadedFromDisk) return;
    this.loadedFromDisk = true;

    const apps = await readdir(this.baseDir).catch(() => [] as string[]);
    for (const app of apps) {
      for (const status of ['pending', 'resolved'] as const) {
        const dir = path.join(this.baseDir, app, status);
        const entries = await readdir(dir).catch(() => [] as string[]);
        for (const id of entries) {
          if (this.reports.has(id)) continue;
          const raw = await readFile(path.join(dir, id, 'report.json'), 'utf-8').catch(() => null);
          if (!raw) continue;
          try {
            const report = JSON.parse(raw) as QAReport;
            report.app = report.app ?? app;
            this.reports.set(id, report);
          } catch {
            logger.warn(`Skipping unreadable QA report: ${app}/${status}/${id}`);
          }
        }
      }
    }
  }

  private nextId(): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `${stamp}-${String(++this.sequence).padStart(3, '0')}`;
  }
}

function sanitizeApp(app: string): string {
  const cleaned = app.trim().replace(/[^\w.-]+/g, '_');
  return cleaned || QA_UNKNOWN_APP;
}
