/**
 * WebSocket server transport (T-1.07, ADR-008).
 *
 * ADR-008 names uWebSockets.js. It is not published to npm (GitHub-only, native
 * binary), so this uses `ws` instead — which is precisely the substitution the
 * Transport interface exists to make cheap. Swapping to uWebSockets.js later
 * touches this file and nothing else. See the ADR-008 addendum.
 *
 * Both channels map to TCP for now, as ADR-008 states.
 */
import { WebSocketServer, type WebSocket } from 'ws';
import { BaseTransport, type Channel } from '@sandline/shared';

export class WsConnectionTransport extends BaseTransport {
  constructor(private readonly socket: WebSocket) {
    super();
    socket.binaryType = 'arraybuffer';
    socket.on('message', (data: ArrayBuffer | Buffer) => {
      this.emitMessage(data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data));
    });
    socket.on('close', () => super.close('socket closed'));
    socket.on('error', (err: Error) => super.close(`socket error: ${err.message}`));
  }

  send(data: Uint8Array, _channel: Channel = 'reliable'): void {
    if (!this.isOpen || this.socket.readyState !== 1) return;
    this.socket.send(data);
  }

  override close(reason = 'closed'): void {
    if (!this.isOpen) return;
    super.close(reason);
    try {
      this.socket.close(1000, reason.slice(0, 120));
    } catch {
      // Already closing.
    }
  }
}

export interface WsServerOptions {
  port: number;
  onConnection: (transport: WsConnectionTransport) => void;
}

export interface WsServerHandle {
  readonly port: number;
  close(): Promise<void>;
}

export function startWsServer(options: WsServerOptions): Promise<WsServerHandle> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: options.port });
    wss.on('connection', (socket) => options.onConnection(new WsConnectionTransport(socket)));
    wss.on('error', reject);
    wss.on('listening', () => {
      const address = wss.address();
      const port = typeof address === 'object' && address ? address.port : options.port;
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            for (const client of wss.clients) client.terminate();
            wss.close(() => done());
          }),
      });
    });
  });
}
