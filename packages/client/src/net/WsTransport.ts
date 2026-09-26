/**
 * Browser WebSocket transport (T-1.08, ADR-008).
 *
 * Reconnects with exponential backoff. The socket factory is injectable so a
 * headless test can supply a Node WebSocket without a browser.
 */
import { BaseTransport, type Channel } from '@sandline/shared';

export interface WsClientOptions {
  url: string;
  /** Defaults to the global WebSocket; tests inject their own. */
  factory?: (url: string) => WebSocket;
  maxRetries?: number;
  baseDelayMs?: number;
  onOpen?: () => void;
  onRetry?: (attempt: number, delayMs: number) => void;
}

export class WsClientTransport extends BaseTransport {
  private socket: WebSocket | null = null;
  /** T-4.31: the URL the next connect uses; the room joined rides it so a reconnect lands on the machine that holds it. */
  private url: string;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: WsClientOptions) {
    super();
    this.url = options.url;
    this.connect();
  }

  /** Change where the NEXT connect goes. The open socket is untouched. */
  setUrl(url: string): void {
    this.url = url;
  }

  private connect(): void {
    const factory = this.options.factory ?? ((url: string) => new WebSocket(url));
    const socket = factory(this.url);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0; // a successful connect resets the backoff
      this.options.onOpen?.();
    };
    socket.onmessage = (ev: MessageEvent) => {
      if (ev.data instanceof ArrayBuffer) this.emitMessage(new Uint8Array(ev.data));
    };
    socket.onclose = () => this.scheduleReconnect();
    socket.onerror = () => socket.close();
  }

  private scheduleReconnect(): void {
    if (!this.isOpen) return;
    const max = this.options.maxRetries ?? 6;
    if (this.attempt >= max) {
      super.close(`gave up after ${max} reconnect attempts`);
      return;
    }
    const base = this.options.baseDelayMs ?? 250;
    // 250, 500, 1000, 2000 ... capped so a long outage does not stall forever.
    const delay = Math.min(base * 2 ** this.attempt, 10_000);
    this.attempt++;
    this.options.onRetry?.(this.attempt, delay);
    this.timer = setTimeout(() => this.connect(), delay);
  }

  send(data: Uint8Array, _channel: Channel = 'reliable'): void {
    if (!this.isOpen || this.socket?.readyState !== 1) return;
    this.socket.send(data);
  }

  override close(reason = 'closed'): void {
    if (!this.isOpen) return;
    if (this.timer) clearTimeout(this.timer);
    super.close(reason);
    this.socket?.close();
  }
}
