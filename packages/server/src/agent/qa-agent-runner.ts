import { spawn, execFile, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { stat, writeFile, rm } from 'fs/promises';
import { createInterface } from 'readline';
import path from 'path';
import type { QAReport } from '@mcp-rn-devtools/shared';
import type { ConnectionManager } from '../managers/connection-manager.js';
import { readConfig } from './qa-config.js';
import { buildChatPrompt, buildReportPrompt, buildSessionPreamble } from './prompts.js';
import { relaunchApp } from '../utils/adb.js';

const execFileAsync = promisify(execFile);

export type AgentStatus = 'off' | 'waiting' | 'processing';

export interface AgentActivity {
  kind: 'agent-text' | 'tool-use' | 'turn-start' | 'turn-done' | 'error' | 'info';
  text: string;
  timestamp: number;
}

type QueueItem = { kind: 'report'; report: QAReport } | { kind: 'chat'; text: string };

const TURN_TIMEOUT_MS = 15 * 60 * 1000;
const TURN_RETRY_DELAY_MS = 5000;
const PRESENCE_TOUCH_MS = 30_000;
const ACTIVITY_BUFFER = 200;
const ALLOWED_TOOLS = [
  'Read',
  'Edit',
  'Write',
  'Grep',
  'Glob',
  'Bash(curl*)',
  'Bash(npm run lint*)',
  'Bash(npm test*)',
  'Bash(npx jest*)',
  'Bash(npx eslint*)',
].join(',');

/**
 * Headless fix agent for the QA capture loop. Runs `claude -p` (the user's
 * Claude Code CLI — subscription auth, no API key) once per report or chat
 * message, resuming one persistent session per QA run so context carries over.
 * Zero cost while idle: it just listens for 'captured' events in-process.
 *
 * Emits: 'status' (state object), 'activity' (AgentActivity).
 */
export class QAAgentRunner extends EventEmitter {
  private status: AgentStatus = 'off';
  private app: string | null = null;
  private repo: string | null = null;
  private sessionId: string | null = null;
  private queue: QueueItem[] = [];
  private currentReportId: string | null = null;
  private child: ChildProcess | null = null;
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private activities: AgentActivity[] = [];
  private claudeBin: string | null = null;

  private readonly onCaptured = (report: QAReport) => {
    if (this.status === 'off' || report.app !== this.app) return;
    // "Guardar" (queue) means: keep testing, act later — only fix-now auto-runs
    if (report.mode !== 'fix-now') {
      this.pushActivity('info', `Report guardado (no se procesa ahora): ${report.id} — "${report.note.slice(0, 60)}"`);
      return;
    }
    this.queue.push({ kind: 'report', report });
    this.pushActivity('info', `Report en cola: ${report.id} — "${report.note.slice(0, 60)}"`);
    void this.pump();
  };

  constructor(private cm: ConnectionManager) {
    super();
  }

  get state() {
    return {
      status: this.status,
      app: this.app,
      repo: this.repo,
      sessionId: this.sessionId,
      queueLength: this.queue.length,
      activities: this.activities,
    };
  }

  async start(app: string): Promise<{ ok: boolean; error?: string }> {
    if (this.status !== 'off') return { ok: false, error: 'agent already running' };

    const config = await readConfig(this.cm.qaReportManager.baseDir);
    const repo = config.apps[app];
    if (!repo) {
      return { ok: false, error: `No repo mapped for "${app}" — set it in the cockpit config` };
    }
    const repoStat = await stat(repo).catch(() => null);
    if (!repoStat?.isDirectory()) {
      return { ok: false, error: `Mapped repo does not exist: ${repo}` };
    }

    this.claudeBin = await findClaudeBin();
    if (!this.claudeBin) {
      return { ok: false, error: 'claude CLI not found in PATH (set QA_AGENT_CLAUDE_BIN)' };
    }

    this.app = app;
    this.repo = repo;
    this.sessionId = null;
    this.status = 'waiting';
    this.cm.qaReportManager.on('captured', this.onCaptured);
    this.startPresence();
    this.pushActivity('info', `Agente iniciado — ${app} → ${repo}`);
    this.emitStatus();
    return { ok: true };
  }

  stop(): void {
    if (this.status === 'off') return;
    this.cm.qaReportManager.off('captured', this.onCaptured);
    this.stopPresence();
    this.child?.kill('SIGTERM');
    this.child = null;
    this.queue = [];
    this.status = 'off';
    this.pushActivity('info', 'Agente detenido');
    this.emitStatus();
  }

  send(text: string): { ok: boolean; error?: string } {
    if (this.status === 'off') return { ok: false, error: 'agent is off' };
    this.queue.push({ kind: 'chat', text });
    void this.pump();
    return { ok: true };
  }

  /** Explicitly queue a saved (mode: queue) report for fixing — the cockpit's per-card button. */
  enqueueReport(report: QAReport): { ok: boolean; error?: string } {
    if (this.status === 'off') return { ok: false, error: 'agent is off' };
    if (report.app !== this.app) return { ok: false, error: `agent is running for ${this.app}` };
    this.queue.push({ kind: 'report', report });
    this.pushActivity('info', `Report en cola (a pedido): ${report.id}`);
    void this.pump();
    return { ok: true };
  }

  /** Queues every pending report of the agent's app (skipping queued/in-flight ones). */
  async enqueuePendingAll(): Promise<{ ok: boolean; queued: number; error?: string }> {
    if (this.status === 'off') return { ok: false, queued: 0, error: 'agent is off' };

    const pending = await this.cm.qaReportManager.list('pending', this.app!);
    const alreadyQueued = new Set(
      this.queue
        .filter((item): item is { kind: 'report'; report: QAReport } => item.kind === 'report')
        .map((item) => item.report.id),
    );
    if (this.currentReportId) alreadyQueued.add(this.currentReportId);

    const fresh = pending.filter((report) => !alreadyQueued.has(report.id));
    for (const report of fresh) this.queue.push({ kind: 'report', report });
    if (fresh.length > 0) {
      this.pushActivity('info', `${fresh.length} pendiente(s) encolados para corregir`);
      this.emitStatus();
      void this.pump();
    }
    return { ok: true, queued: fresh.length };
  }

  private async pump(): Promise<void> {
    if (this.status !== 'waiting' || this.queue.length === 0) return;

    const item = this.queue.shift()!;
    this.status = 'processing';
    this.currentReportId = item.kind === 'report' ? item.report.id : null;
    this.emitStatus();

    const label = item.kind === 'report' ? `report ${item.report.id}` : 'mensaje del tester';
    this.pushActivity('turn-start', `Procesando ${label}…`);

    try {
      await this.runTurnWithRetry(item);
      if (item.kind === 'report' && this.app) {
        const reloaded = await relaunchApp(this.app);
        if (reloaded) this.pushActivity('info', 'App recargada para reflejar el fix');
      }
    } catch (e) {
      this.pushActivity('error', `Turno falló: ${(e as Error).message}`);
    }

    this.currentReportId = null;
    // stop() may have flipped the status while the turn was awaited
    if ((this.status as AgentStatus) !== 'off') {
      this.status = 'waiting';
      this.emitStatus();
      void this.pump();
    }
  }

  /** Transient API failures (5xx, dropped connections) kill the turn — retry once. */
  private async runTurnWithRetry(item: QueueItem): Promise<void> {
    try {
      await this.runTurn(item);
    } catch (e) {
      if ((this.status as AgentStatus) === 'off') throw e;
      this.pushActivity('info', `Turno falló (${(e as Error).message.slice(0, 120)}) — reintento en 5s…`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, TURN_RETRY_DELAY_MS));
      if ((this.status as AgentStatus) === 'off') throw e;
      await this.runTurn(item);
    }
  }

  private runTurn(item: QueueItem): Promise<void> {
    const body =
      item.kind === 'report'
        ? buildReportPrompt(item.report, this.cm.qaReportManager.reportDir(item.report))
        : buildChatPrompt(item.text, this.pendingIdsSnapshot());
    const prompt = this.sessionId ? body : `${buildSessionPreamble()}\n\n---\n\n${body}`;

    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'acceptEdits',
      '--strict-mcp-config',
      '--allowedTools',
      ALLOWED_TOOLS,
    ];
    if (this.sessionId) args.push('--resume', this.sessionId);

    return new Promise((resolve, reject) => {
      const child = spawn(this.claudeBin!, args, {
        cwd: this.repo!,
        env: sanitizedEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.child = child;

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`turn timed out after ${TURN_TIMEOUT_MS / 60000} min`));
      }, TURN_TIMEOUT_MS);

      let stderrTail = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-2000);
      });

      const lines = createInterface({ input: child.stdout! });
      lines.on('line', (line) => this.handleStreamLine(line));

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        this.child = null;
        if (code === 0) resolve();
        else reject(new Error(`claude exited with code ${code}: ${stderrTail.slice(-400)}`));
      });

      child.stdin?.write(prompt);
      child.stdin?.end();
    });
  }

  private handleStreamLine(line: string): void {
    let msg: Record<string, any>;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    if (msg.type === 'system' && msg.subtype === 'init') {
      if (!this.sessionId) {
        this.sessionId = msg.session_id as string;
        this.pushActivity('info', `Sesión del agente: ${this.sessionId}`);
        this.emitStatus();
      }
      return;
    }

    if (msg.type === 'assistant') {
      const content: Array<Record<string, any>> = msg.message?.content ?? [];
      for (const block of content) {
        if (block.type === 'text' && block.text?.trim()) {
          this.pushActivity('agent-text', block.text.trim());
        } else if (block.type === 'tool_use') {
          this.pushActivity('tool-use', formatToolUse(block.name, block.input ?? {}, this.repo));
        }
      }
      return;
    }

    if (msg.type === 'result') {
      this.sessionId = (msg.session_id as string) ?? this.sessionId;
      const seconds = msg.duration_ms ? `${Math.round(msg.duration_ms / 1000)}s` : '';
      const cost = typeof msg.total_cost_usd === 'number' ? ` · $${msg.total_cost_usd.toFixed(2)}` : '';
      this.pushActivity(
        'turn-done',
        msg.subtype === 'success' ? `Turno completo ${seconds}${cost}` : `Turno terminó: ${msg.subtype}`,
      );
    }
  }

  private pendingIdsSnapshot(): string[] {
    return this.queue
      .filter((item): item is { kind: 'report'; report: QAReport } => item.kind === 'report')
      .map((item) => item.report.id);
  }

  private startPresence(): void {
    const presencePath = path.join(this.cm.qaReportManager.baseDir, '.listener');
    const touch = () => void writeFile(presencePath, 'qa-agent-runner').catch(() => null);
    touch();
    this.presenceTimer = setInterval(touch, PRESENCE_TOUCH_MS);
  }

  private stopPresence(): void {
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = null;
    void rm(path.join(this.cm.qaReportManager.baseDir, '.listener'), { force: true }).catch(() => null);
  }

  private pushActivity(kind: AgentActivity['kind'], text: string): void {
    const activity: AgentActivity = { kind, text, timestamp: Date.now() };
    this.activities.push(activity);
    if (this.activities.length > ACTIVITY_BUFFER) this.activities.shift();
    this.emit('activity', activity);
  }

  private emitStatus(): void {
    const { activities: _omit, ...state } = this.state;
    this.emit('status', state);
  }
}

function formatToolUse(name: string, input: Record<string, any>, repo: string | null): string {
  const relative = (file: unknown) =>
    typeof file === 'string' && repo ? path.relative(repo, file) : String(file ?? '');
  switch (name) {
    case 'Edit':
    case 'Write':
      return `✏️ ${name} ${relative(input.file_path)}`;
    case 'Read':
      return `📖 Read ${relative(input.file_path)}`;
    case 'Bash':
      return `$ ${String(input.command ?? '').slice(0, 120)}`;
    case 'Grep':
    case 'Glob':
      return `🔎 ${name} ${String(input.pattern ?? '')}`;
    default:
      return `🔧 ${name}`;
  }
}

/**
 * The MCP server often runs as a child of a Claude Code session, so its env
 * carries that session's internals (CLAUDECODE, CLAUDE_CODE_SESSION_ID,
 * messaging sockets…). A nested `claude -p` inheriting them misbehaves —
 * strip everything CLAUDE* so the agent starts as a clean top-level CLI.
 */
function sanitizedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CLAUDE')) continue;
    env[key] = value;
  }
  return env;
}

async function findClaudeBin(): Promise<string | null> {
  if (process.env.QA_AGENT_CLAUDE_BIN) return process.env.QA_AGENT_CLAUDE_BIN;
  try {
    const { stdout } = await execFileAsync('which', ['claude']);
    const bin = stdout.trim();
    return bin || null;
  } catch {
    return null;
  }
}
