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
import { DEFAULT_WORLD_ID } from '../sim/world.ts';
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
  onThrow?: (conn: ServerConnection, msg: Extract<Message, { kind: 'Throw' }>) => void;
  onEquip?: (conn: ServerConnection, msg: Extract<Message, { kind: 'Equip' }>) => void;
  onAck?: (conn: ServerConnection, tick: number) => void;
  /** T-3.09: the client wants AI debug reports, or no longer does. */
  onAiDebugRequest?: (conn: ServerConnection, on: boolean) => void;
  /** T-3.27: a player's order to bots, and a mark — untrusted; the session checks both. */
  onOrder?: (conn: ServerConnection, msg: Extract<Message, { kind: 'Order' }>) => void;
  onMark?: (conn: ServerConnection, msg: Extract<Message, { kind: 'Mark' }>) => void;
  /** T-3.34: a seated player asking for the mission to start again. */
  onMissionRestart?: (conn: ServerConnection) => void;
  /** T-4.19: pre-mission ready/start controls. */
  onRoomCommand?: (conn: ServerConnection, msg: Extract<Message, { kind: 'RoomCommand' }>) => void;
  onClosed?: (conn: ServerConnection, reason: string) => void;
}

export class ServerConnection {
  /** T-4.33: the typed code this connection was refused or dropped with, or null while open or left by the peer. */
  rejectedWith: DisconnectCode | null = null;
  state: ConnectionState = 'handshaking';
  netId = 0;
  slot = -1;
  name = '';
  /** The room code the client asked for; empty means "make me one" (T-1.5.04). */
  room = '';
  /** The join key the client offered; empty for none. The host checks it. */
  key = '';
  /** The world the client asked a new room to be built with; empty for the host's default. */
  world = '';
  /** T-4.18: the resume token the client offered; empty for a fresh join. */
  resume = '';
  /** T-4.22: the identity token the client offered; empty for none. The host verifies it. */
  identity = '';
  /** T-4.19: match an empty-room Join before creating a room. */
  quick = false;
  /**
   * T-4.22: who this is, once the host has verified or issued an identity:
   * the durable player ID, and the token the JoinAck hands back. Both empty
   * on a session that issues none.
   */
  playerId = '';
  identityToken = '';
  /** Latest tick this client acknowledged; the delta baseline. */
  lastAckedTick = -1;
  private lastHeard: number;
  /**
   * When a PERSON last did something: moved, looked, pressed a button, fired,
   * threw or switched weapon. Not `lastHeard`: a client sends an input frame
   * every tick whether anyone is at the keyboard or not, and pings on a timer,
   * so a tab left open in the background is heard from forever. This is what
   * lets a host drop it (`idle`) and stop paying for the machine.
   */
  private lastActive: number;
  /** When this connection joined its room, on the room's clock. */
  private joinedAt: number;
  /** The previous input's look, so a mouse move counts as activity. */
  private lastYaw = Number.NaN;
  private lastPitch = Number.NaN;
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
    this.lastActive = now;
    this.joinedAt = now;
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
    this.lastActive = now;
    this.joinedAt = now;
  }

  /** Nothing a person did has arrived for `limitMs`. Zero or less never idles. */
  isIdle(now: number, limitMs: number): boolean {
    return limitMs > 0 && now - this.lastActive > limitMs;
  }

  /** Joined more than `limitMs` ago. Zero or less never expires. */
  isExpired(now: number, limitMs: number): boolean {
    return limitMs > 0 && now - this.joinedAt > limitMs;
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
      this.key = join.key ?? '';
      this.world = join.world ?? '';
      this.resume = join.resume ?? '';
      this.identity = join.identity ?? '';
      this.quick = join.quick ?? false;
      this.state = 'active';
      this.events.onJoined?.(this);
      return;
    }

    switch (msg.kind) {
      case 'Input':
        if (msg.moveX !== 0 || msg.moveY !== 0 || msg.buttons !== 0 || msg.yaw !== this.lastYaw || msg.pitch !== this.lastPitch) {
          // The first input always counts: NaN equals nothing.
          this.lastActive = now;
        }
        this.lastYaw = msg.yaw;
        this.lastPitch = msg.pitch;
        this.events.onInput?.(this, msg);
        break;
      case 'Fire':
        this.lastActive = now;
        this.events.onFire?.(this, msg);
        break;
      case 'Throw':
        this.lastActive = now;
        this.events.onThrow?.(this, msg);
        break;
      case 'Equip':
        this.lastActive = now;
        this.events.onEquip?.(this, msg);
        break;
      case 'AiDebugRequest':
        this.events.onAiDebugRequest?.(this, msg.on);
        break;
      case 'Order':
        this.lastActive = now;
        this.events.onOrder?.(this, msg);
        break;
      case 'Mark':
        this.lastActive = now;
        this.events.onMark?.(this, msg);
        break;
      case 'MissionRestart':
        this.lastActive = now;
        this.events.onMissionRestart?.(this);
        break;
      case 'RoomCommand':
        this.lastActive = now;
        this.events.onRoomCommand?.(this, msg);
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

  accept(netId: number, slot: number, serverTick: number, room = '', world = DEFAULT_WORLD_ID, resume = '', resumed = false): void {
    this.netId = netId;
    this.slot = slot;
    this.send({ kind: 'JoinAck', netId, slot, serverTick, room, world, resume, resumed, identity: this.identityToken });
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
    this.rejectedWith = code;
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
  /** T-3.27: every bot's current order, and every standing mark, as the host last sent them. */
  onOrders?: (orders: Extract<Message, { kind: 'Orders' }>['orders']) => void;
  onMarks?: (marks: Extract<Message, { kind: 'Marks' }>['marks']) => void;
  /** T-3.34: where the mission stands. */
  onMission?: (mission: Extract<Message, { kind: 'Mission' }>) => void;
  onProgression?: (progression: Extract<Message, { kind: 'Progression' }>) => void;
  /** T-4.28: the server's scoreboard, whenever a row changes. */
  onStats?: (stats: Extract<Message, { kind: 'Stats' }>) => void;
  /** T-4.19: authoritative ready-up state. */
  onRoomState?: (room: Extract<Message, { kind: 'RoomState' }>) => void;
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

  /** Open the handshake. An empty room creates one unless quick-match is requested. */
  join(name: string, room = '', key = '', world = '', quick = false): void {
    this.send({ kind: 'Join', version: PROTOCOL_VERSION, name, room, ...(key === '' ? {} : { key }), ...(world === '' ? {} : { world }), ...(quick ? { quick } : {}) });
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
      case 'Orders':
        this.events.onOrders?.(msg.orders);
        break;
      case 'Marks':
        this.events.onMarks?.(msg.marks);
        break;
      case 'Progression':
        this.events.onProgression?.(msg);
        break;
      case 'Stats':
        this.events.onStats?.(msg);
        break;
      case 'Mission':
        this.events.onMission?.(msg);
        break;
      case 'RoomState':
        this.events.onRoomState?.(msg);
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
