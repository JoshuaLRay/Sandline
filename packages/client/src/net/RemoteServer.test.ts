/**
 * Remote session tests (T-1.5.02).
 *
 * The socket is faked rather than opened. What matters here is the state
 * machine a real socket makes possible — refused, dropped, retrying, back —
 * and driving that from an actual server would mean provoking each case by
 * timing, which is how netcode tests become flaky.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HostUrlError,
  RemoteServer,
  describeStatus,
  hostFromQuery,
} from './RemoteServer.ts';

/** The surface `WsClientTransport` uses, and nothing more. */
class FakeSocket {
  static readonly instances: FakeSocket[] = [];
  binaryType = '';
  readyState = 0;
  readonly sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  drop(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  send(data: Uint8Array): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }
}

const factory = (url: string): WebSocket => new FakeSocket(url) as unknown as WebSocket;
const newest = (): FakeSocket => FakeSocket.instances[FakeSocket.instances.length - 1] as FakeSocket;

afterEach(() => {
  FakeSocket.instances.length = 0;
  vi.useRealTimers();
});

describe('hostFromQuery', () => {
  it('is null without the parameter, so the in-page session stays the default', () => {
    expect(hostFromQuery('')).toBeNull();
    expect(hostFromQuery('?weapon=2')).toBeNull();
  });

  it('is null for an empty or blank value rather than a broken URL', () => {
    expect(hostFromQuery('?host=')).toBeNull();
    expect(hostFromQuery('?host=%20%20')).toBeNull();
  });

  it('accepts ws and wss, and trims', () => {
    expect(hostFromQuery('?host=ws://localhost:8080')).toBe('ws://localhost:8080');
    expect(hostFromQuery('?host=%20wss://play.example:443%20')).toBe('wss://play.example:443');
  });

  it('refuses a scheme a WebSocket cannot open', () => {
    expect(() => hostFromQuery('?host=http://localhost:8080')).toThrow(HostUrlError);
    expect(() => hostFromQuery('?host=localhost:8080')).toThrow(/ws:\/\/ or wss:\/\//);
  });

  it('names mixed content instead of letting it look like a dead host', () => {
    // The browser blocks this with an immediate close, which is indistinguishable
    // from the host being down — and sends everyone to debug a healthy host.
    expect(() => hostFromQuery('?host=ws://play.example', 'https:')).toThrow(
      /cannot open an insecure ws:\/\/ socket — use wss:\/\/play.example/,
    );
  });

  it('allows ws:// on an http page, which is the local two-tab case', () => {
    expect(hostFromQuery('?host=ws://localhost:8080', 'http:')).toBe('ws://localhost:8080');
  });
});

describe('RemoteServer', () => {
  it('starts connecting and does not claim a slot yet', () => {
    const remote = new RemoteServer('ws://host', { factory });
    expect(remote.status.phase).toBe('connecting');
    expect(describeStatus(remote.status, -1)).toBe('connecting...');
  });

  it('handshakes when the socket opens, not when it is constructed', () => {
    const remote = new RemoteServer('ws://host', { factory });
    const join = vi.fn();
    remote.onReady = join;

    // A send into a socket that has not opened is dropped on the floor, so a
    // join issued at construction would never reach the host and the page
    // would wait forever for an answer to a question nobody asked.
    expect(join).not.toHaveBeenCalled();
    newest().open();
    expect(join).toHaveBeenCalledTimes(1);
  });

  it('handshakes immediately if the socket opened before the handler was set', () => {
    const remote = new RemoteServer('ws://host', { factory });
    newest().open();
    const join = vi.fn();
    remote.onReady = join;
    expect(join).toHaveBeenCalledTimes(1);
  });

  it('reports the slot once seated', () => {
    const remote = new RemoteServer('ws://host', { factory });
    remote.markJoined();
    expect(remote.status.phase).toBe('joined');
    expect(describeStatus(remote.status, 2)).toBe('joined — slot 3 of 6');
  });

  it('treats a refusal as terminal and keeps the reason', () => {
    const remote = new RemoteServer('ws://host', { factory });
    remote.noteReason('session full');
    expect(remote.status.phase).toBe('failed');
    expect(describeStatus(remote.status, -1)).toBe('disconnected — session full');
  });

  it('shows the attempt and the wait while backing off, then re-handshakes', () => {
    vi.useFakeTimers();
    const remote = new RemoteServer('ws://host', { factory, baseDelayMs: 250 });
    const join = vi.fn();
    remote.onReady = join;
    newest().open();
    remote.markJoined();
    expect(join).toHaveBeenCalledTimes(1);

    newest().drop();
    expect(remote.status.phase).toBe('retrying');
    expect(remote.status.attempt).toBe(1);
    expect(remote.status.delayMs).toBe(250);
    expect(describeStatus(remote.status, 0)).toBe('reconnecting — attempt 1 in 0.3s');

    vi.advanceTimersByTime(250);
    newest().open();
    // A reconnect is a new player in a new slot, so the client must handshake
    // again rather than resume — hence a second onReady, not a silent resume.
    expect(join).toHaveBeenCalledTimes(2);
    expect(remote.status.phase).toBe('connecting');
  });

  it('fails for good once the backoff is exhausted', () => {
    vi.useFakeTimers();
    const remote = new RemoteServer('ws://host', { factory, baseDelayMs: 10, maxRetries: 2 });
    newest().open();
    for (let i = 0; i < 3; i++) {
      newest().drop();
      vi.advanceTimersByTime(10_000);
    }
    expect(remote.status.phase).toBe('failed');
    expect(describeStatus(remote.status, -1)).toMatch(/^disconnected — /);
  });

  it('has nothing to pump or step — the session is in another process', () => {
    const remote = new RemoteServer('ws://host', { factory });
    remote.step();
    remote.pump();
    expect(remote.inFlight).toBe(0);
  });
});
