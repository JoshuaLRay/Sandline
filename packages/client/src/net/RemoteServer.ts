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
import { ROOM_CODE_ALPHABET, type DisconnectCode, type Transport, isRoomCode, normalizeRoomCode } from '@sandline/shared';
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
   * The difference between "room full" and "the socket died" is the
   * difference between a player waiting and a player reloading, and only the
   * host knows which it was.
   */
  reason: string | null;
  /** The typed half of the host's reason (T-1.5.04), when it gave one. */
  code: DisconnectCode | null;
}

/** `ws://` and `wss://` only, and mixed content named rather than discovered. */
export class HostUrlError extends Error {}

/**
 * Check a host address the way the browser will, but with words.
 *
 * Catches mixed content here rather than letting the browser refuse it. An
 * https page cannot open a ws:// socket. The browser blocks it with a console
 * message and an immediate close event, which reaches this code as an ordinary
 * connection failure and reads as "the host is down" — so the first thing
 * anyone does is go and check a host that is running perfectly. It is the
 * single most likely way T-1.5.07 gets misdiagnosed, and it costs one line to
 * name instead.
 */
export function parseHostUrl(raw: string, pageProtocol = 'http:'): string {
  const url = raw.trim();
  if (!/^wss?:\/\//.test(url)) {
    throw new HostUrlError(`host must start with ws:// or wss://, got '${url}'`);
  }
  if (pageProtocol === 'https:' && url.startsWith('ws://')) {
    throw new HostUrlError(
      `this page is served over https, so it cannot open an insecure ws:// socket — use wss://${url.slice(5)}`,
    );
  }
  return url;
}

/**
 * Read `?host=` out of a query string.
 *
 * Returns null when absent. Since T-1.5.06 this PRE-FILLS the lobby rather
 * than bypassing it: the query parameter is a developer convenience and the
 * shareable link's carrier, and there is exactly one way into a session.
 */
export function hostFromQuery(search: string, pageProtocol = 'http:'): string | null {
  const raw = new URLSearchParams(search).get('host');
  if (raw === null || raw.trim() === '') return null;
  return parseHostUrl(raw, pageProtocol);
}

/** Read `?room=` out of a query string, normalised. Empty when absent. */
export function roomFromQuery(search: string): string {
  const raw = new URLSearchParams(search).get('room');
  return raw === null ? '' : normalizeRoomCode(raw);
}

/**
 * The link one player sends another (T-1.5.06).
 *
 * The host is left out when it is the build's default, so the common case is
 * `?room=K7PM` and nothing else — short enough to read aloud as well as paste.
 */
export function shareLink(pageUrl: string, host: string, room: string, defaultHost: string): string {
  const url = new URL(pageUrl);
  url.search = '';
  url.hash = '';
  if (room !== '') url.searchParams.set('room', room);
  if (host !== defaultHost) url.searchParams.set('host', host);
  return url.toString();
}

/**
 * A room code as typed by a person, or a reason it cannot be one.
 *
 * Empty is valid and means "host a new room" — the lobby's two buttons send
 * the same message with and without a code (T-1.5.04).
 */
export function checkRoomInput(raw: string): { room: string; error: string | null } {
  const room = normalizeRoomCode(raw);
  if (room === '') return { room, error: null };
  const campaign = room.length === 8 && [...room].every((ch) => ROOM_CODE_ALPHABET.includes(ch));
  if (!isRoomCode(room) && !campaign) {
    return {
      room,
      error: `'${room}' is not a room or campaign code — room codes are four characters, campaign codes are eight, and neither uses I, O, 0, 1, S, 5, B, 8, Z or 2`,
    };
  }
  return { room, error: null };
}

/**
 * What to tell a person about a typed rejection, and what they can do.
 *
 * The code is the host's; the sentence is ours. Each one names a different
 * next action, which is the whole reason the reasons are typed.
 */
export function explainRejection(code: DisconnectCode | null, reason: string | null): string {
  switch (code) {
    case 'bad version':
      return 'this build is older than the host — reload the page to get the current one';
    case 'no such room':
      return 'no room with that code on this host — check the code, or host a new room';
    case 'room full':
      return 'that room already has six players';
    case 'host full':
      return 'the host has as many rooms as it will hold — join a code instead of hosting';
    case 'host draining':
      return 'the host is shutting down — try again in a moment';
    case 'heartbeat timeout':
      return 'the host stopped hearing from you';
    case 'left':
      return 'you left';
    case 'unknown world':
      return 'the host is running a map this build does not have — reload the page to get the current one';
    case 'bad key':
      return reason === 'this host needs a join key'
        ? 'this host needs a join key — ask whoever runs it and type it in the Key field'
        : 'wrong join key — check the Key field';
    case 'idle':
      return 'dropped for being idle — join again when you are back';
    case 'bad identity':
      return 'the host did not accept this browser\'s saved player ID, so it has been cleared — join again for a new one';
    case 'session limit':
      return 'connected for as long as this host allows in one go — join again to keep playing';
    case 'protocol error':
    case 'other':
    case null:
      return reason ?? 'the host closed the connection';
  }
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
    code: null,
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

  /**
   * The host told us why it is closing the door.
   *
   * A refusal is terminal: the retry would be refused identically, and six
   * attempts of it would read to the host as a client hammering a full room.
   * Closing the transport here is what stops the backoff.
   */
  noteRefusal(code: DisconnectCode, reason: string): void {
    this.status.reason = reason;
    this.status.code = code;
    this.status.phase = 'failed';
    this.transport.close(reason);
  }

  /** Leave on purpose: no retry, no reason to show. */
  close(): void {
    this.status.phase = 'failed';
    this.status.code ??= 'left';
    this.status.reason ??= 'left';
    this.transport.close('left');
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
      return `disconnected — ${status.code ? explainRejection(status.code, status.reason) : (status.reason ?? 'gave up reconnecting')}`;
    default:
      return status.reason === null ? 'connecting...' : `connecting... (${status.reason})`;
  }
}
