import { SDK_WS_PORT } from '@mcp-rn-devtools/shared';
import type { SDKMessage } from '@mcp-rn-devtools/shared';
import { uuid } from '../utils/uuid.js';
import { getDefaultHost } from '../utils/platform.js';

type MessageHandler = (msg: SDKMessage) => void;

export class WSClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers: MessageHandler[] = [];
  private host: string;
  private port: number;
  private _connected = false;

  constructor(port: number = SDK_WS_PORT, host?: string) {
    this.port = port;
    this.host = host ?? getDefaultHost();
  }

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    this.doConnect();
  }

  private doConnect(): void {
    try {
      const ws = new WebSocket(`ws://${this.host}:${this.port}`);

      ws.onopen = () => {
        this._connected = true;
        this.ws = ws;
        this.stopReconnect();

        // Send handshake
        this.send({
          type: 'handshake',
          payload: {
            sdkVersion: '0.1.0',
          },
          timestamp: Date.now(),
          id: uuid(),
        });
      };

      ws.onmessage = (event) => {
        try {
          const msg: SDKMessage = JSON.parse(
            typeof event.data === 'string' ? event.data : '',
          );

          if (msg.type === 'ping') {
            this.send({
              type: 'pong',
              payload: {},
              timestamp: Date.now(),
              id: uuid(),
            });
            return;
          }

          for (const handler of this.handlers) {
            handler(msg);
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        this._connected = false;
        this.ws = null;
        this.scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will fire after this
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  send(msg: SDKMessage): void {
    if (this.ws && this._connected) {
      try {
        this.ws.send(JSON.stringify(msg));
      } catch {
        // connection lost
      }
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx !== -1) this.handlers.splice(idx, 1);
    };
  }

  disconnect(): void {
    this.stopReconnect();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this._connected = false;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, 2000);
  }

  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
