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
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
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
  /**
   * Plain HTTP requests on the same port (T-1.5.07). A deployed host needs a
   * health check its platform can poll, and one port is what a small instance
   * gets. Absent, every non-upgrade request is answered 404.
   */
  onRequest?: (req: IncomingMessage, res: ServerResponse) => void;
  /**
   * Refuse a socket before it is upgraded. Returns a reason to refuse with,
   * or null to accept. This is where a connection cap lives: a refused socket
   * costs one HTTP response, an accepted one costs a heartbeat timeout.
   */
  shouldAccept?: () => string | null;
}

export interface WsServerHandle {
  readonly port: number;
  close(): Promise<void>;
}

export function startWsServer(options: WsServerOptions): Promise<WsServerHandle> {
  return new Promise((resolve, reject) => {
    const http = createServer((req, res) => {
      if (options.onRequest) {
        options.onRequest(req, res);
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    const wss = new WebSocketServer({ noServer: true });
    http.on('upgrade', (req, socket, head) => {
      const refusal = options.shouldAccept?.() ?? null;
      if (refusal !== null) {
        socket.write(`HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n${refusal}`);
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    wss.on('connection', (socket: WebSocket) => options.onConnection(new WsConnectionTransport(socket)));
    http.on('error', reject);
    http.listen(options.port, () => {
      const address = http.address();
      const port = typeof address === 'object' && address ? address.port : options.port;
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            for (const client of wss.clients) client.terminate();
            wss.close(() => http.close(() => done()));
          }),
      });
    });
  });
}
