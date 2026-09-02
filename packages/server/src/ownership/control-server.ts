import { WebSocketServer, WebSocket } from 'ws';
import type { AddressInfo } from 'net';
import { logger } from '../utils/logger.js';

export type YieldAnswer = 'yielded' | 'declined';
export type YieldOutcome = YieldAnswer | 'unresponsive';

export interface ControlHandlers {
  /** Another instance wants this target's debugger: yield if we hold it, decline otherwise. */
  onYield(key: string, from: string): YieldAnswer;
  onStatus(): unknown;
}

const YIELD_TIMEOUT_MS = 2000;

/**
 * Per-instance control endpoint (localhost, ephemeral port). Sibling instances
 * ask here for a specific target instead of fighting over the SDK port, and
 * get a real answer instead of a timed guess.
 */
export class ControlServer {
  private wss: WebSocketServer | null = null;

  constructor(private readonly handlers: ControlHandlers) {}

  get port(): number | null {
    return this.wss ? (this.wss.address() as AddressInfo).port : null;
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
      wss.once('listening', () => {
        this.wss = wss;
        wss.on('error', (err) => logger.error('Control server error', err.message));
        wss.on('connection', (socket) => socket.on('message', (raw) => this.handle(socket, raw.toString())));
        resolve((wss.address() as AddressInfo).port);
      });
      wss.once('error', reject);
    });
  }

  stop(): void {
    this.wss?.close();
    this.wss = null;
  }

  private handle(socket: WebSocket, raw: string): void {
    let message: { type?: string; key?: string; from?: string };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.type === 'yield' && typeof message.key === 'string') {
      const answer = this.handlers.onYield(message.key, message.from ?? '');
      socket.send(JSON.stringify({ type: answer }));
      return;
    }
    if (message.type === 'status') {
      socket.send(JSON.stringify({ type: 'status', record: this.handlers.onStatus() }));
    }
  }
}

/** Asks the instance at `port` to release `key`; resolves with its answer or 'unresponsive'. */
export function requestYield(port: number, key: string, from: string, timeoutMs = YIELD_TIMEOUT_MS): Promise<YieldOutcome> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const finish = (outcome: YieldOutcome) => {
      clearTimeout(timer);
      try {
        socket.terminate();
      } catch {
        /* already closed */
      }
      resolve(outcome);
    };
    const timer = setTimeout(() => finish('unresponsive'), timeoutMs);
    socket.on('open', () => socket.send(JSON.stringify({ type: 'yield', key, from })));
    socket.on('message', (raw) => {
      const answer = (JSON.parse(raw.toString()) as { type?: string }).type;
      finish(answer === 'yielded' || answer === 'declined' ? answer : 'unresponsive');
    });
    socket.on('error', () => finish('unresponsive'));
  });
}
