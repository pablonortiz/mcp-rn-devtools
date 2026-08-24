import { mkdir, readdir, readFile, rename, writeFile } from 'fs/promises';
import path from 'path';
import {
  QA_RECENT_ACTIONS,
  QA_RECENT_ERRORS,
  QA_RECENT_LOGS,
  QA_RECENT_NETWORK,
  QA_REPORTS_DIRNAME,
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
 * errors, a device screenshot) and persists them as a reviewable queue:
 * `.qa-reports/pending/<id>/report.json` + `screenshot.png`.
 */
export class QAReportManager {
  private reports = new Map<string, QAReport>();
  private waiters: Array<(report: QAReport) => void> = [];
  private loadedFromDisk = false;
  private sequence = 0;

  constructor(private cm: ConnectionManager) {}

  get baseDir(): string {
    return process.env.RN_QA_REPORTS_DIR ?? path.join(process.cwd(), QA_REPORTS_DIRNAME);
  }

  async capture(payload: QAReportPayload, enricher: QAEnricher): Promise<QAReport> {
    const id = this.nextId();
    const reportDir = path.join(this.baseDir, 'pending', id);
    await mkdir(reportDir, { recursive: true });

    const [navigation, appState, screenshotOk] = await Promise.all([
      enricher.getNavigationState().catch(() => null),
      this.collectAppState(enricher),
      this.collectScreenshot(path.join(reportDir, 'screenshot.png')),
    ]);

    const report: QAReport = {
      id,
      createdAt: new Date().toISOString(),
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
    logger.info(`QA report captured: ${id} [${report.mode}] "${report.note.slice(0, 60)}"`);

    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve(report);

    return report;
  }

  async list(status?: QAReportStatus): Promise<QAReport[]> {
    await this.ensureLoaded();
    const all = Array.from(this.reports.values()).sort((a, b) => a.id.localeCompare(b.id));
    return status ? all.filter((report) => report.status === status) : all;
  }

  async get(id: string): Promise<QAReport | null> {
    await this.ensureLoaded();
    return this.reports.get(id) ?? null;
  }

  async resolve(id: string, resolution?: string): Promise<QAReport | null> {
    await this.ensureLoaded();
    const report = this.reports.get(id);
    if (!report || report.status === 'resolved') return report ?? null;

    report.status = 'resolved';
    if (resolution) report.resolution = resolution;

    const pendingDir = path.join(this.baseDir, 'pending', id);
    const resolvedDir = path.join(this.baseDir, 'resolved', id);
    await mkdir(path.dirname(resolvedDir), { recursive: true });
    await rename(pendingDir, resolvedDir).catch(() => null);
    await this.persist(report);
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
        resolve(null);
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  reportDir(report: QAReport): string {
    return path.join(this.baseDir, report.status, report.id);
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

    for (const status of ['pending', 'resolved'] as const) {
      const dir = path.join(this.baseDir, status);
      const entries = await readdir(dir).catch(() => [] as string[]);
      for (const id of entries) {
        if (this.reports.has(id)) continue;
        const raw = await readFile(path.join(dir, id, 'report.json'), 'utf-8').catch(() => null);
        if (!raw) continue;
        try {
          this.reports.set(id, JSON.parse(raw) as QAReport);
        } catch {
          logger.warn(`Skipping unreadable QA report: ${status}/${id}`);
        }
      }
    }
  }

  private nextId(): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `${stamp}-${String(++this.sequence).padStart(3, '0')}`;
  }
}
