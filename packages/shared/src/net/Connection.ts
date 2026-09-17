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
  type Message,
  PROTOCOL_VERSION,
  ProtocolError,
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
  onAck?: (conn: ServerConnection, tick: number) => void;
  onClosed?: (conn: ServerConnection, reason: string) => void;
}

export class ServerConnection {
  state: ConnectionState = 'handshaking';
  netId = 0;
  slot = -1;
  name = '';
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
    private readonly events: ServerConnectionEvents,
    now: number,
  ) {
    this.lastHeard = now;
    this.currentNow = now;
    transport.onMessage((data) => this.handle(data, this.currentNow));
    transport.onClose((reason) => this.markClosed(reason));
  }

  /** Advance this connection's notion of now. Called once per tick. */
  setNow(now: number): void {
    if (now > this.currentNow) this.currentNow = now;
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
      this.reject(e instanceof ProtocolError ? e.message : 'malformed message');
      return;
    }

    if (this.state === 'handshaking') {
      const result = checkHandshake(msg);
      if (!result.ok) {
        this.reject(result.reason ?? 'handshake rejected');
        return;
      }
      this.name = (msg as Extract<Message, { kind: 'Join' }>).name;
      this.state = 'active';
      this.events.onJoined?.(this);
      return;
    }

    switch (msg.kind) {
      case 'Input':
        this.events.onInput?.(this, msg);
        break;
      case 'Ack':
        if (msg.tick > this.lastAckedTick) this.lastAckedTick = msg.tick;
        this.events.onAck?.(this, msg.tick);
        break;
      case 'Ping':
        this.send({ kind: 'Pong', id: msg.id, clientTime: msg.clientTime, serverTime: now });
        break;
      case 'Disconnect':
        this.markClosed(msg.reason);
        this.transport.close(msg.reason);
        break;
      default:
        // Join after handshake, or a server-only message from a client.
        this.reject(`unexpected ${msg.kind} in state ${this.state}`);
    }
  }

  accept(netId: number, slot: number, serverTick: number): void {
    this.netId = netId;
    this.slot = slot;
    this.send({ kind: 'JoinAck', netId, slot, serverTick });
  }

  reject(reason: string): void {
    if (this.state === 'closed') return;
    this.send({ kind: 'Disconnect', reason });
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
  onJoinAck?: (netId: number, slot: number, serverTick: number) => void;
  onSnapshot?: (msg: Extract<Message, { kind: 'Snapshot' }>) => void;
  onPong?: (msg: Extract<Message, { kind: 'Pong' }>) => void;
  onClosed?: (reason: string) => void;
}

export class ClientConnection {
  state: ConnectionState = 'handshaking';
  netId = 0;
  slot = -1;
  /** Set when the server rejects us, so the UI can say why. */
  rejectionReason: string | null = null;

  constructor(
    readonly transport: Transport,
    private readonly events: ClientConnectionEvents,
  ) {
    transport.onMessage((data) => this.handle(data));
    transport.onClose((reason) => this.markClosed(reason));
  }

  /** Open the handshake. */
  join(name: string): void {
    this.send({ kind: 'Join', version: PROTOCOL_VERSION, name });
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
        this.state = 'active';
        this.events.onJoinAck?.(msg.netId, msg.slot, msg.serverTick);
        break;
      case 'Snapshot':
        this.events.onSnapshot?.(msg);
        break;
      case 'Pong':
        this.events.onPong?.(msg);
        break;
      case 'Disconnect':
        this.rejectionReason = msg.reason;
        this.markClosed(msg.reason);
        this.transport.close(msg.reason);
        break;
      default:
        break;
    }
  }

  send(msg: Message): void {
    if (this.transport.isOpen) this.transport.send(encodeMessage(msg));
  }

  private markClosed(reason: string): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.events.onClosed?.(reason);
  }
}
