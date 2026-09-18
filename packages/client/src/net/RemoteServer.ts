/**
 * The other end of the wire: a session in another process (T-1.5.02).
 *
 * WHAT THIS CHANGES. Until now the harness always built its own authoritative
 * session inside the tab (`LocalServer`), which is why a second person opening
 * the same URL got their own private world rather than a seat in yours — the
 * reason T-1.24 is run by one human and a bot (ADR-012's addendum). Pointing
 * the page at `?host=ws://…` makes the session a `SessionHost` process
 * (T-1.5.01) instead, and two tabs pointed at one host are two players in one
 * session. That is the whole milestone in one query parameter.
 *
 * HOW LITTLE IT TOUCHES. `NetClient` takes a `Transport` and knows nothing else
 * about where its bytes come from, so prediction, reconciliation,
 * interpolation, lag compensation and the netgraph are all untouched by this
 * file. That is ADR-008's abstraction doing exactly the job it was written for,
 * and if this task had needed to reach into any of them, the finding would have
 * been worth more than the feature.
 *
 * WHAT IT ADDS. Only what a real socket makes possible and a loopback pair
 * never did: a connection that can be refused, can drop, and can take time to
 * establish. On a loopback pair "nothing is happening" and "nothing is moving"
 * are the same picture. On a socket they are different faults, so the phase
 * below is surfaced in the HUD rather than inferred from a frozen screen.
 */
import type { Transport } from '@sandline/shared';
import { WsClientTransport } from './WsTransport.ts';

/**
 * What the harness needs from whichever end of the wire it is on.
 *
 * `LocalServer` satisfies this already; `RemoteServer` no-ops the half that
 * only means something when the session is in this page. Written as one
 * interface so the frame loop does not grow a branch per call site — the render
 * path should not be able to tell.
 */
export interface SessionSource {
  readonly transport: Transport;
  /** Advance an in-page session. A remote host advances itself. */
  step(nowMs: number): void;
  /** Move queued packets on a simulated link. A real socket needs no pump. */
  pump(nowMs: number): void;
  /** Datagrams waiting on the local simulated link; zero when there is none. */
  readonly inFlight: number;
}

export type ConnectionPhase =
  /** Socket opening, or open and waiting for a JoinAck. */
  | 'connecting'
  /** In a slot, playing. */
  | 'joined'
  /** Socket dropped, backoff running. */
  | 'retrying'
  /** Out of retries, or the host refused us. Nothing further will happen. */
  | 'failed';

export interface ConnectionStatus {
  phase: ConnectionPhase;
  /** Reconnect attempt in progress, 1-based. Zero when not retrying. */
  attempt: number;
  /** Backoff delay for that attempt. */
  delayMs: number;
  /**
   * What the host said, when it said anything.
   *
   * The difference between "session full" and "the socket died" is the
   * difference between a player waiting and a player reloading, and only the
   * host knows which it was.
   */
  reason: string | null;
}

/** `ws://` and `wss://` only, and mixed content named rather than discovered. */
export class HostUrlError extends Error {}

/**
 * Read `?host=` out of a query string.
 *
 * Returns null for the in-page session, which stays the default: the published
 * build has no host to point at, and a harness that failed to start because a
 * server was missing would be a worse harness than the one this replaces.
 */
export function hostFromQuery(search: string, pageProtocol = 'http:'): string | null {
  const raw = new URLSearchParams(search).get('host');
  if (raw === null || raw.trim() === '') return null;
  const url = raw.trim();

  if (!/^wss?:\/\//.test(url)) {
    throw new HostUrlError(`host must start with ws:// or wss://, got '${url}'`);
  }
  /**
   * Catch mixed content here rather than letting the browser refuse it.
   *
   * An https page cannot open a ws:// socket. The browser blocks it with a
   * console message and an immediate close event, which reaches this code as an
   * ordinary connection failure and reads as "the host is down" — so the first
   * thing anyone does is go and check a host that is running perfectly. It is
   * the single most likely way T-1.5.07 gets misdiagnosed, and it costs one
   * line to name instead.
   */
  if (pageProtocol === 'https:' && url.startsWith('ws://')) {
    throw new HostUrlError(
      `this page is served over https, so it cannot open an insecure ws:// socket — use wss://${url.slice(5)}`,
    );
  }
  return url;
}

export interface RemoteServerOptions {
  /** Injected by tests; defaults to the global WebSocket. */
  factory?: (url: string) => WebSocket;
  maxRetries?: number;
  baseDelayMs?: number;
}

export class RemoteServer implements SessionSource {
  readonly transport: Transport;
  readonly status: ConnectionStatus = {
    phase: 'connecting',
    attempt: 0,
    delayMs: 0,
    reason: null,
  };
  private opened = false;
  private ready: (() => void) | null = null;

  constructor(
    readonly url: string,
    options: RemoteServerOptions = {},
  ) {
    this.transport = new WsClientTransport({
      url,
      ...options,
      onOpen: () => {
        this.opened = true;
        this.status.phase = 'connecting';
        this.status.attempt = 0;
        this.status.delayMs = 0;
        this.ready?.();
      },
      onRetry: (attempt, delayMs) => {
        this.status.phase = 'retrying';
        this.status.attempt = attempt;
        this.status.delayMs = delayMs;
      },
    });
    this.transport.onClose((reason) => {
      // Only a terminal close reaches here: WsClientTransport keeps the
      // transport open across reconnects and closes it once it gives up.
      this.status.phase = 'failed';
      this.status.reason ??= reason;
    });
  }

  /**
   * Called every time the socket becomes usable — including after a reconnect.
   *
   * It has to re-handshake, not merely resume. The host released the slot when
   * the socket died (`Session.releaseSlot` hands the entity back to a bot), so
   * a returning client is a new player taking a new slot with a new NetId, and
   * anything the old client still believed about itself is now about somebody
   * else's soldier. Routing a returning player back to their own session and
   * their own slot is the reconnect ADR-011 describes; it is not this task.
   *
   * Set synchronously after construction. If the socket got there first, this
   * fires immediately rather than waiting for a reconnect that may never come.
   */
  set onReady(handler: () => void) {
    this.ready = handler;
    if (this.opened) handler();
  }

  /** The host told us why it is closing the door. */
  noteReason(reason: string): void {
    this.status.reason = reason;
    // A refusal is terminal: the retry would be refused identically.
    this.status.phase = 'failed';
  }

  markJoined(): void {
    this.status.phase = 'joined';
  }

  /** The session runs in another process; there is nothing here to advance. */
  step(): void {}
  pump(): void {}

  /** Nothing is queued locally — the packets are on a real wire. */
  get inFlight(): number {
    return 0;
  }
}

/** One line of connection state for the HUD. */
export function describeStatus(status: ConnectionStatus, slot: number): string {
  switch (status.phase) {
    case 'joined':
      return `joined — slot ${slot + 1} of 6`;
    case 'retrying':
      return `reconnecting — attempt ${status.attempt} in ${(status.delayMs / 1000).toFixed(1)}s`;
    case 'failed':
      return `disconnected — ${status.reason ?? 'gave up reconnecting'}`;
    default:
      return status.reason === null ? 'connecting...' : `connecting... (${status.reason})`;
  }
}
