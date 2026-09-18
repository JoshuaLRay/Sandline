/**
 * Connection lifecycle (T-1.09).
 *
 * handshaking -> active -> closed, on both ends. The server assigns NetId and
 * squad slot; a client that fails the version check is rejected here, before it
 * can misread a single snapshot.
 *
 * Time is passed in, never read from a clock, so heartbeat timeouts are exactly
 * testable.
 */
import type { Transport } from './Transport.ts';
import {
  type DisconnectCode,
  type Message,
  PROTOCOL_VERSION,
  ProtocolError,
  type RosterEntry,
  checkHandshake,
  decodeMessage,
  encodeMessage,
} from './protocol.ts';

export type ConnectionState = 'handshaking' | 'active' | 'closed';

/** Drop a peer that has not been heard from in this long. */
export const HEARTBEAT_TIMEOUT_MS = 5000;

/** ADR-001: the squad is always six. */
export const MAX_SLOTS = 6;

export interface ServerConnectionEvents {
  onJoined?: (conn: ServerConnection) => void;
  onInput?: (conn: ServerConnection, msg: Extract<Message, { kind: 'Input' }>) => void;
  onFire?: (conn: ServerConnection, msg: Extract<Message, { kind: 'Fire' }>) => void;
  onAck?: (conn: ServerConnection, tick: number) => void;
  onClosed?: (conn: ServerConnection, reason: string) => void;
}

export class ServerConnection {
  state: ConnectionState = 'handshaking';
  netId = 0;
  slot = -1;
  name = '';
  /** The room code the client asked for; empty means "make me one" (T-1.5.04). */
  room = '';
  /** Latest tick this client acknowledged; the delta baseline. */
  lastAckedTick = -1;
  private lastHeard: number;
  /**
   * Most recent time the owner told us about.
   *
   * A transport hands us bytes with no timestamp, and this class must not read
   * a clock (that would make every heartbeat test non-deterministic). So the
   * session calls setNow() each tick and inbound messages are stamped with it.
   *
   * Getting this wrong is subtle and severe: an earlier version stamped
   * messages with `lastHeard` itself, so lastHeard could never advance and
   * EVERY client was dropped for a heartbeat timeout exactly once the session
   * passed the timeout mark, however chatty they were.
   */
  private currentNow: number;

  constructor(
    readonly transport: Transport,
    private events: ServerConnectionEvents,
    now: number,
  ) {
    this.lastHeard = now;
    this.currentNow = now;
    transport.onMessage((data) => this.handle(data, this.currentNow));
    transport.onClose((reason) => this.markClosed(reason));
  }

  /**
   * Hand this connection to a different owner (T-1.5.05).
   *
   * A host accepts the socket and runs the handshake before it knows which
   * room the client wants, so the handlers it was built with cannot be the
   * room's. Once the room is chosen, the room takes over every event from here
   * on. The previous owner's handlers are replaced, not stacked: two sets of
   * handlers would double-apply every input.
   */
  rebind(events: ServerConnectionEvents): void {
    this.events = events;
  }

  /** Advance this connection's notion of now. Called once per tick. */
  setNow(now: number): void {
    if (now > this.currentNow) this.currentNow = now;
  }

  /**
   * Move onto a different clock — a room's, on admission (T-1.5.05).
   *
   * Each room keeps its own simulation time, starting at zero when the room is
   * made, and `setNow` only ever moves forward. A connection handshaked on the
   * host's clock and then handed to a young room would keep the host's larger
   * `lastHeard` forever, so `now - lastHeard` would stay negative and the
   * heartbeat timeout could never fire for it. Restarting both stamps at the
   * room's now means a silent peer is dropped on the room's schedule, which is
   * the one that matters.
   */
  resetClock(now: number): void {
    this.currentNow = now;
    this.lastHeard = now;
  }

  /** Feed a message with an explicit timestamp. */
  receive(data: Uint8Array, now: number): void {
    this.setNow(now);
    this.handle(data, now);
  }

  private handle(data: Uint8Array, now: number): void {
    if (this.state === 'closed') return;
    this.lastHeard = now;

    let msg: Message;
    try {
      msg = decodeMessage(data);
    } catch (e) {
      // Malformed input is a disconnect, not a crash. A peer that cannot
      // speak the protocol cannot be reasoned with.
      this.reject('protocol error', e instanceof ProtocolError ? e.message : 'malformed message');
      return;
    }

    if (this.state === 'handshaking') {
      const result = checkHandshake(msg);
      if (!result.ok) {
        this.reject(result.code, result.reason);
        return;
      }
      const join = msg as Extract<Message, { kind: 'Join' }>;
      this.name = join.name;
      this.room = join.room;
      this.state = 'active';
      this.events.onJoined?.(this);
      return;
    }

    switch (msg.kind) {
      case 'Input':
        this.events.onInput?.(this, msg);
        break;
      case 'Fire':
        this.events.onFire?.(this, msg);
        break;
      case 'Ack':
        if (msg.tick > this.lastAckedTick) this.lastAckedTick = msg.tick;
        this.events.onAck?.(this, msg.tick);
        break;
      case 'Ping':
        this.send({ kind: 'Pong', id: msg.id, clientTime: msg.clientTime, serverTime: now });
        break;
      case 'Disconnect':
        this.markClosed(msg.reason || msg.code);
        this.transport.close(msg.reason || msg.code);
        break;
      default:
        // Join after handshake, or a server-only message from a client.
        this.reject('protocol error', `unexpected ${msg.kind} in state ${this.state}`);
    }
  }

  accept(netId: number, slot: number, serverTick: number, room = ''): void {
    this.netId = netId;
    this.slot = slot;
    this.send({ kind: 'JoinAck', netId, slot, serverTick, room });
  }

  /** Tell the squad who is in it. Six entries, always (ADR-001). */
  sendRoster(slots: readonly RosterEntry[]): void {
    this.send({ kind: 'Roster', slots: [...slots] });
  }

  /**
   * Close with a typed reason. `detail` is what a person reads; the code is
   * what the client acts on, and it is also what `onClosed` reports when there
   * is no detail, so a bare `reject('room full')` reads as exactly that.
   */
  reject(code: DisconnectCode, detail?: string): void {
    if (this.state === 'closed') return;
    const reason = detail ?? code;
    this.send({ kind: 'Disconnect', code, reason });
    this.markClosed(reason);
    this.transport.close(reason);
  }

  send(msg: Message): void {
    if (this.transport.isOpen) this.transport.send(encodeMessage(msg));
  }

  /** True if this peer has gone quiet past the timeout. */
  isTimedOut(now: number, timeoutMs = HEARTBEAT_TIMEOUT_MS): boolean {
    return this.state !== 'closed' && now - this.lastHeard > timeoutMs;
  }

  private markClosed(reason: string): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.events.onClosed?.(this, reason);
  }
}

export interface ClientConnectionEvents {
  onJoinAck?: (netId: number, slot: number, serverTick: number, room: string) => void;
  onSnapshot?: (msg: Extract<Message, { kind: 'Snapshot' }>) => void;
  onPong?: (msg: Extract<Message, { kind: 'Pong' }>) => void;
  onRoster?: (slots: RosterEntry[]) => void;
  onClosed?: (reason: string, code: DisconnectCode | null) => void;
}

export class ClientConnection {
  state: ConnectionState = 'handshaking';
  netId = 0;
  slot = -1;
  /** The room the host seated us in. */
  room = '';
  /** Set when the server rejects us, so the UI can say why. */
  rejectionReason: string | null = null;
  /** The typed half of that, so the UI can decide what to do about it. */
  rejectionCode: DisconnectCode | null = null;

  constructor(
    readonly transport: Transport,
    private readonly events: ClientConnectionEvents,
  ) {
    transport.onMessage((data) => this.handle(data));
    transport.onClose((reason) => this.markClosed(reason));
  }

  /** Open the handshake. An empty room asks the host to create one. */
  join(name: string, room = ''): void {
    this.send({ kind: 'Join', version: PROTOCOL_VERSION, name, room });
  }

  private handle(data: Uint8Array): void {
    if (this.state === 'closed') return;
    let msg: Message;
    try {
      msg = decodeMessage(data);
    } catch {
      this.markClosed('malformed message from server');
      this.transport.close('malformed');
      return;
    }

    switch (msg.kind) {
      case 'JoinAck':
        this.netId = msg.netId;
        this.slot = msg.slot;
        this.room = msg.room;
        this.state = 'active';
        this.events.onJoinAck?.(msg.netId, msg.slot, msg.serverTick, msg.room);
        break;
      case 'Snapshot':
        this.events.onSnapshot?.(msg);
        break;
      case 'Pong':
        this.events.onPong?.(msg);
        break;
      case 'Roster':
        this.events.onRoster?.(msg.slots);
        break;
      case 'Disconnect':
        this.rejectionReason = msg.reason;
        this.rejectionCode = msg.code;
        this.markClosed(msg.reason, msg.code);
        this.transport.close(msg.reason);
        break;
      default:
        break;
    }
  }

  send(msg: Message): void {
    if (this.transport.isOpen) this.transport.send(encodeMessage(msg));
  }

  /** Say goodbye properly, so the host frees the slot now rather than on timeout. */
  leave(): void {
    if (this.state === 'closed') return;
    this.send({ kind: 'Disconnect', code: 'left', reason: 'left' });
    this.markClosed('left', 'left');
    this.transport.close('left');
  }

  private markClosed(reason: string, code: DisconnectCode | null = null): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.events.onClosed?.(reason, code);
  }
}
