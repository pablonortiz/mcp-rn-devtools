import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

interface CDPRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface CDPResponse {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

export class CDPConnection extends EventEmitter {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pending = new Map<
    number,
    { resolve: (v: CDPResponse) => void; reject: (e: Error) => void }
  >();
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  async connect(wsUrl: string, metroPort: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: {
          Origin: `http://localhost:${metroPort}`,
        },
      });

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('CDP connection timeout'));
      }, 5000);

      ws.on('open', () => {
        clearTimeout(timeout);
        this.ws = ws;
        this._connected = true;
        logger.info('CDP connected');
        this.emit('connected');
        resolve();
      });

      ws.on('message', (data) => {
        try {
          const msg: CDPResponse = JSON.parse(data.toString());
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            const p = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            if (msg.error) {
              p.reject(new Error(msg.error.message));
            } else {
              p.resolve(msg);
            }
          } else if (msg.method) {
            this.emit('event', msg);
            this.emit(msg.method, msg.params);
          }
        } catch (e) {
          logger.error('Failed to parse CDP message', e);
        }
      });

      ws.on('close', () => {
        clearTimeout(timeout);
        this._connected = false;
        this.rejectAllPending();
        logger.info('CDP disconnected');
        this.emit('disconnected');
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        logger.error('CDP WebSocket error', err.message);
        if (!this._connected) {
          reject(err);
        }
      });
    });
  }

  async send(method: string, params?: Record<string, unknown>): Promise<CDPResponse> {
    if (!this.ws || !this._connected) {
      throw new Error('CDP not connected');
    }

    const id = ++this.requestId;
    const request: CDPRequest = { id, method };
    if (params) request.params = params;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP request timeout: ${method}`));
      }, 10000);

      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timeout);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timeout);
          reject(e);
        },
      });

      this.ws!.send(JSON.stringify(request));
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this._connected = false;
      this.rejectAllPending();
    }
  }

  private rejectAllPending(): void {
    for (const [, p] of this.pending) {
      p.reject(new Error('CDP connection closed'));
    }
    this.pending.clear();
  }
}
