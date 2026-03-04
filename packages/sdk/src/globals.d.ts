// React Native global timer types (available at runtime via RN polyfills)
declare function setTimeout(callback: (...args: any[]) => void, ms?: number, ...args: any[]): ReturnType<typeof globalThis.setTimeout>;
declare function clearTimeout(id: ReturnType<typeof setTimeout>): void;
declare function setInterval(callback: (...args: any[]) => void, ms?: number, ...args: any[]): ReturnType<typeof globalThis.setInterval>;
declare function clearInterval(id: ReturnType<typeof setInterval>): void;

// React Native __DEV__ global
declare const __DEV__: boolean;

// WebSocket (provided by React Native at runtime)
declare class WebSocket {
  constructor(url: string, protocols?: string | string[]);
  readonly readyState: number;
  onopen: ((event: any) => void) | null;
  onclose: ((event: any) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: ((event: any) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  static readonly CONNECTING: 0;
  static readonly OPEN: 1;
  static readonly CLOSING: 2;
  static readonly CLOSED: 3;
}

// XMLHttpRequest (provided by React Native at runtime)
type XMLHttpRequestBodyInit = string | Blob | ArrayBufferView | ArrayBuffer | FormData | URLSearchParams;

declare class XMLHttpRequest extends EventTarget {
  readonly readyState: number;
  readonly response: any;
  readonly responseText: string;
  responseType: string;
  readonly status: number;
  readonly statusText: string;
  timeout: number;
  onreadystatechange: ((this: XMLHttpRequest, ev: Event) => any) | null;
  open(method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null): void;
  send(body?: XMLHttpRequestBodyInit | null): void;
  setRequestHeader(name: string, value: string): void;
  getAllResponseHeaders(): string;
  getResponseHeader(name: string): string | null;
  abort(): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  static readonly DONE: number;
  static readonly HEADERS_RECEIVED: number;
  static readonly LOADING: number;
  static readonly OPENED: number;
  static readonly UNSENT: number;
}
