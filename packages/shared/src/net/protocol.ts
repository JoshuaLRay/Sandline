/**
 * Wire protocol (T-1.05).
 *
 * Every message opens with a type tag. The handshake additionally carries a
 * version byte: a client built against a different schema must be rejected with
 * a clear reason rather than silently misreading every subsequent snapshot,
 * which is precisely the corrupt-state failure ADR-009 warns about.
 */
import { BitReader, BitWriter } from './BitStream.ts';
import { HEALTH, POSITION, dequantize, quantize } from './quantize.ts';
import { type WorldSnapshot, readSnapshot, writeSnapshot } from './snapshot.ts';
import { isRoomCode } from './roomCode.ts';

/** Bump whenever the schema, quantization, or message layout changes. */
export const PROTOCOL_VERSION = 14;

/** Input button bits carried on the unreliable input frame. */
export const INPUT_BUTTONS = Object.freeze({
  jump: 0b1,
  sprint: 0b10,
  crouch: 0b100,
  interact: 0b1000,
  fire: 0b10000,
  /** T-2.40, ADR-016: voluntary prone. Beats crouch when both are held. */
  prone: 0b100000,
});

/**
 * Why a connection ended, as a type rather than a sentence (T-1.5.04).
 *
 * A client needs to DO something different for each of these: wait and retry
 * for a full room, re-check the code for a missing one, reload the page for a
 * stale build, and go away for a draining host. A free-text reason could only
 * be shown, never acted on, and on a loopback pair it was not even shown — the
 * client discarded Disconnect outright until T-1.5.02. The string still
 * travels beside the code for the detail a person wants to read ("server
 * speaks 6, client sent 5"); the code is what the software reads.
 *
 * The order is the wire encoding. Append, never reorder.
 */
export const DISCONNECT_CODES = [
  /** Anything not below; the text says what. */
  'other',
  'bad version',
  'no such room',
  'room full',
  /** The process is shutting down: do not reconnect to it. */
  'host draining',
  /** The process holds as many rooms as it will; try a code, not a fresh room. */
  'host full',
  'heartbeat timeout',
  /** The peer sent bytes the protocol cannot read. */
  'protocol error',
  /** The peer chose to leave. */
  'left',
] as const;
export type DisconnectCode = (typeof DISCONNECT_CODES)[number];
const DISCONNECT_CODE_BITS = 4;

/** One row of the squad, as the lobby shows it: six of these, always. */
export interface RosterEntry {
  /** Empty for a bot. */
  name: string;
  human: boolean;
}

export const MessageType = {
  Join: 0,
  JoinAck: 1,
  Input: 2,
  Snapshot: 3,
  Delta: 8,
  Fire: 9,
  HitEvent: 10,
  Ack: 4,
  Ping: 5,
  Pong: 6,
  Disconnect: 7,
  Roster: 11,
  Throw: 12,
  Detonation: 13,
} as const;
export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

const TYPE_BITS = 4;

/** One tick of input, as carried on the wire. */
export interface InputFrame {
  tick: number;
  moveX: number;
  moveY: number;
  yaw: number;
  pitch: number;
  buttons: number;
}

/** How many prior inputs a packet may carry. Two bits on the wire. */
export const MAX_PRIOR_INPUTS = 3;

export type Message =
  /**
   * `room` is the code to join, or empty to have the host create a room and
   * say which in the JoinAck. One message for both because the difference is
   * one field, and a client that could "create" without also joining would
   * have made a room nobody is in.
   */
  | { kind: 'Join'; version: number; name: string; room: string }
  | { kind: 'JoinAck'; netId: number; slot: number; serverTick: number; room: string }
  | {
      kind: 'Input';
      tick: number;
      moveX: number;
      moveY: number;
      yaw: number;
      pitch: number;
      buttons: number;
      /**
       * Recent PRIOR inputs, newest first, resent for redundancy.
       *
       * Inputs ride the unreliable channel, and a dropped one is not a dropped
       * frame of animation — it is a tick the server never learns about, so it
       * repeats whatever it had and the player's own prediction is then wrong
       * by however far they moved. Repeating the last few inputs in every
       * packet means a single loss, or a short run of them, costs nothing: the
       * next packet carries the missing input and the server never notices.
       *
       * They are tiny — about seven bytes each — and this is the cheapest
       * smoothness available on a lossy link.
       */
      prior?: readonly InputFrame[];
    }
  | { kind: 'Snapshot'; snapshot: WorldSnapshot }
  /**
   * A delta-encoded snapshot. `baselineTick` is the tick the receiver must
   * already hold; null means the payload is a full snapshot. Carrying the
   * baseline explicitly lets a client detect that it lost the baseline and ask
   * for a full one rather than decoding garbage.
   */
  | {
      kind: 'Delta';
      tick: number;
      baselineTick: number | null;
      /**
       * The last input tick the server had consumed from THIS client when it
       * built this snapshot.
       *
       * Reconciliation is meaningless without it. The client must know which
       * of its predictions the authoritative state already accounts for, so it
       * can replay exactly the inputs still in flight - no more, no less.
       * Replaying too few loses motion; replaying too many double-applies it.
       */
      lastProcessedInputTick: number;
      payload: Uint8Array;
    }
  /**
   * A trigger pull (T-1.18). Carries the aim it was fired along and the server
   * time the client was RENDERING at the moment it fired, which is what the
   * server rewinds hitboxes to.
   *
   * `renderTimeMs` is untrusted: the server clamps the rewind it implies to
   * MAX_REWIND_MS, so a client claiming an enormous latency cannot shoot into
   * the distant past.
   */
  | {
      kind: 'Fire';
      tick: number;
      /**
       * Aim in TABLE angle units (1/4096 turn), not the 1/1024 the wire uses
       * for replicated facing.
       *
       * Replication precision is chosen for how accurately a character needs to
       * be DRAWN; aim precision decides where a hitscan ray goes over a hundred
       * metres. At 1/1024 a turn, half a step is 0.176 degrees, which is 30 cm
       * of error at 100 m before any spread — and converting table to wire by
       * shifting truncated rather than rounded, so the error was a consistent
       * bias to one side rather than noise. Four more bits per shot removes
       * both.
       */
      yaw: number;
      pitch: number;
      renderTimeMs: number;
      weapon: number;
      /** Aimed: the server needs it to pick the same cone the client drew. */
      ads: boolean;
    }
  /**
   * The authoritative outcome of a shot, broadcast to everyone so all clients
   * draw the same tracer.
   *
   * The origin travels too (B-01), rather than letting an observer approximate
   * it from the shooter's replicated position. That approximation is the
   * shooter's CURRENT interpolated position at the moment this event is drawn —
   * which, for a strafing shooter, can be a metre or more from where the shot
   * actually left the barrel by the time a round trip plus the interpolation
   * delay have passed. At typical engagement range that reads as a few degrees
   * off; at close range the same absolute drift is a large fraction of the
   * distance to the target, and the tracer can look like it left at a steep
   * angle to the way the shooter was actually facing. The server already
   * computes the rewound origin to resolve the shot (T-1.18's "shooter is
   * rewound too"); sending it is the fix, not a new computation.
   */
  | {
      kind: 'HitEvent';
      shooterNetId: number;
      /** 0 when nothing was hit. */
      targetNetId: number;
      x: number;
      y: number;
      z: number;
      /** Where the shot left the barrel: the shooter's rewound eye position. */
      originX: number;
      originY: number;
      originZ: number;
      damage: number;
    }
  /**
   * A projectile leaving the hand (T-2.31). A trigger pull, like Fire, and
   * untrusted in the same way: the index is bounds-checked, and the pouch and
   * the cooldown that decide whether it is allowed are the server's own.
   *
   * No `renderTimeMs` and no rewind. A hitscan shot is resolved against the
   * world the shooter was LOOKING at; a grenade is an object that exists from
   * now on, in everyone's present, and rewinding its spawn would only put it
   * somewhere none of them will see it.
   */
  | { kind: 'Throw'; tick: number; yaw: number; pitch: number; projectile: number }
  /**
   * A projectile going off (T-2.31): where, which kind, the tick it happened
   * on, and what each soldier in reach took.
   *
   * The tick is what makes it drawable honestly. Projectiles are rendered at
   * the interpolation delay like every other replicated entity, so a blast
   * drawn the instant this arrives goes off a tenth of a second in front of a
   * grenade the viewer can still see in the air; the client holds it until its
   * render clock reaches this tick.
   *
   * Damage travels with it rather than as a HitEvent per target: a hit event
   * means a round landed, and feeding six of them into the hit-marker path
   * would make one grenade look like a burst of impossible shots.
   */
  | {
      kind: 'Detonation';
      netId: number;
      projectile: number;
      tick: number;
      x: number;
      y: number;
      z: number;
      targets: readonly { netId: number; damage: number }[];
    }
  | { kind: 'Ack'; tick: number }
  | { kind: 'Ping'; id: number; clientTime: number }
  | { kind: 'Pong'; id: number; clientTime: number; serverTime: number }
  | { kind: 'Disconnect'; code: DisconnectCode; reason: string }
  /**
   * Who is in which slot. Sent on seating and whenever it changes, so a lobby
   * can show six rows with a name or "bot" in each — replicated state carries
   * positions and health, not who is driving.
   */
  | { kind: 'Roster'; slots: RosterEntry[] };

export class ProtocolError extends Error {}

export function encodeMessage(msg: Message): Uint8Array {
  const w = new BitWriter();
  switch (msg.kind) {
    case 'Join':
      w.writeBits(MessageType.Join, TYPE_BITS);
      w.writeBits(msg.version, 8);
      w.writeString(msg.name);
      w.writeString(msg.room);
      break;
    case 'JoinAck':
      w.writeBits(MessageType.JoinAck, TYPE_BITS);
      w.writeVarUint(msg.netId);
      w.writeBits(msg.slot, 3);
      w.writeVarUint(msg.serverTick);
      w.writeString(msg.room);
      break;
    case 'Input':
      w.writeBits(MessageType.Input, TYPE_BITS);
      w.writeVarUint(msg.tick);
      // Move axes are -1..1 at 1/127 resolution.
      w.writeBits(Math.round(msg.moveX * 127) & 0xff, 8);
      w.writeBits(Math.round(msg.moveY * 127) & 0xff, 8);
      w.writeBits(msg.yaw & 0x3ff, 10);
      w.writeBits(msg.pitch & 0x3ff, 10);
      w.writeBits(msg.buttons & 0xffff, 16);
      {
        const prior = (msg.prior ?? []).slice(0, MAX_PRIOR_INPUTS);
        w.writeBits(prior.length, 2);
        for (const f of prior) {
          // Deltas against the newest tick: they are always within
          // MAX_PRIOR_INPUTS, so four bits beats a varuint per frame.
          w.writeBits(Math.min(15, Math.max(0, msg.tick - f.tick)), 4);
          w.writeBits(Math.round(f.moveX * 127) & 0xff, 8);
          w.writeBits(Math.round(f.moveY * 127) & 0xff, 8);
          w.writeBits(f.yaw & 0x3ff, 10);
          w.writeBits(f.pitch & 0x3ff, 10);
          w.writeBits(f.buttons & 0xffff, 16);
        }
      }
      break;
    case 'Snapshot':
      w.writeBits(MessageType.Snapshot, TYPE_BITS);
      writeSnapshot(w, msg.snapshot);
      break;
    case 'Delta':
      w.writeBits(MessageType.Delta, TYPE_BITS);
      w.writeVarUint(msg.tick);
      w.writeBool(msg.baselineTick !== null);
      if (msg.baselineTick !== null) w.writeVarUint(msg.baselineTick);
      // -1 means "nothing from you yet"; shift so it stays a varuint.
      w.writeVarUint(msg.lastProcessedInputTick + 1);
      w.writeBytes(msg.payload);
      break;
    case 'Fire':
      w.writeBits(MessageType.Fire, TYPE_BITS);
      w.writeVarUint(msg.tick);
      w.writeBits(msg.yaw & 0xfff, 12);
      w.writeBits(msg.pitch & 0xfff, 12);
      w.writeVarUint(msTime(msg.renderTimeMs));
      w.writeBits(msg.weapon & 0x7, 3);
      w.writeBool(msg.ads);
      break;
    case 'HitEvent':
      w.writeBits(MessageType.HitEvent, TYPE_BITS);
      w.writeVarUint(msg.shooterNetId);
      w.writeVarUint(msg.targetNetId);
      // Impact points are world positions, so they use the position spec
      // rather than a float - same wire precision as everything else (T-1.02).
      w.writeBits(quantize(msg.x, POSITION), POSITION.bits);
      w.writeBits(quantize(msg.y, POSITION), POSITION.bits);
      w.writeBits(quantize(msg.z, POSITION), POSITION.bits);
      w.writeBits(quantize(msg.originX, POSITION), POSITION.bits);
      w.writeBits(quantize(msg.originY, POSITION), POSITION.bits);
      w.writeBits(quantize(msg.originZ, POSITION), POSITION.bits);
      w.writeBits(quantize(msg.damage, HEALTH), HEALTH.bits);
      break;
    case 'Throw':
      w.writeBits(MessageType.Throw, TYPE_BITS);
      w.writeVarUint(msg.tick);
      w.writeBits(msg.yaw & 0xfff, 12);
      w.writeBits(msg.pitch & 0xfff, 12);
      w.writeBits(msg.projectile & 0x3, 2);
      break;
    case 'Detonation': {
      w.writeBits(MessageType.Detonation, TYPE_BITS);
      w.writeVarUint(msg.netId);
      w.writeBits(msg.projectile & 0x3, 2);
      w.writeVarUint(msg.tick);
      w.writeBits(quantize(msg.x, POSITION), POSITION.bits);
      w.writeBits(quantize(msg.y, POSITION), POSITION.bits);
      w.writeBits(quantize(msg.z, POSITION), POSITION.bits);
      // Six slots is the whole squad (ADR-001), so three bits cover a blast
      // that catches everyone.
      const targets = msg.targets.slice(0, 7);
      w.writeBits(targets.length, 3);
      for (const t of targets) {
        w.writeVarUint(t.netId);
        w.writeBits(quantize(t.damage, HEALTH), HEALTH.bits);
      }
      break;
    }
    case 'Ack':
      w.writeBits(MessageType.Ack, TYPE_BITS);
      w.writeVarUint(msg.tick);
      break;
    /**
     * Times are rounded HERE, not at the call sites.
     *
     * The wire carries whole milliseconds, and every source of a timestamp in
     * this project is a float: `performance.now()` on the client and the
     * injected server clock both are. Requiring each caller to round means the
     * one that forgets throws mid-encode — and `ServerConnection` answering a
     * Ping was exactly that caller. Nothing sent a Ping until the netgraph
     * needed round-trip times, so the throw sat latent, and when it fired it
     * took down the client's whole frame loop rather than just the ping.
     *
     * Sub-millisecond precision is worth nothing to a clock sync that takes a
     * median of sixteen samples over a 30 Hz link.
     */
    case 'Ping':
      w.writeBits(MessageType.Ping, TYPE_BITS);
      w.writeVarUint(msg.id);
      w.writeVarUint(msTime(msg.clientTime));
      break;
    case 'Pong':
      w.writeBits(MessageType.Pong, TYPE_BITS);
      w.writeVarUint(msg.id);
      w.writeVarUint(msTime(msg.clientTime));
      w.writeVarUint(msTime(msg.serverTime));
      break;
    case 'Disconnect': {
      w.writeBits(MessageType.Disconnect, TYPE_BITS);
      const index = DISCONNECT_CODES.indexOf(msg.code);
      w.writeBits(index < 0 ? 0 : index, DISCONNECT_CODE_BITS);
      w.writeString(msg.reason);
      break;
    }
    case 'Roster':
      w.writeBits(MessageType.Roster, TYPE_BITS);
      w.writeBits(msg.slots.length, 3);
      for (const entry of msg.slots) {
        w.writeBool(entry.human);
        w.writeString(entry.name);
      }
      break;
  }
  return w.toUint8Array();
}

/** A timestamp as whole, non-negative milliseconds. */
function msTime(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value);
}

function int8(v: number): number {
  return v > 127 ? v - 256 : v;
}

export function decodeMessage(bytes: Uint8Array): Message {
  const r = new BitReader(bytes);
  let type: number;
  try {
    type = r.readBits(TYPE_BITS);
  } catch {
    throw new ProtocolError('empty or truncated message');
  }

  try {
    switch (type) {
      case MessageType.Join: {
        /**
         * The version byte is the ONLY field with a layout every version
         * shares. Past it, a foreign version's Join is unreadable by
         * definition — v5's had no room string, so reading one would over-read
         * and throw, and the client would be told "protocol error" instead of
         * "your build is too old". Stop at the byte and let the handshake
         * check say the right thing.
         */
        const version = r.readBits(8);
        if (version !== PROTOCOL_VERSION) return { kind: 'Join', version, name: '', room: '' };
        return { kind: 'Join', version, name: r.readString(), room: r.readString() };
      }
      case MessageType.JoinAck:
        return {
          kind: 'JoinAck',
          netId: r.readVarUint(),
          slot: r.readBits(3),
          serverTick: r.readVarUint(),
          room: r.readString(),
        };
      case MessageType.Input: {
        const tick = r.readVarUint();
        const moveX = int8(r.readBits(8)) / 127;
        const moveY = int8(r.readBits(8)) / 127;
        const yaw = r.readBits(10);
        const pitch = r.readBits(10);
        const buttons = r.readBits(16);
        const count = r.readBits(2);
        const prior: InputFrame[] = [];
        for (let i = 0; i < count; i += 1) {
          const back = r.readBits(4);
          prior.push({
            tick: tick - back,
            moveX: int8(r.readBits(8)) / 127,
            moveY: int8(r.readBits(8)) / 127,
            yaw: r.readBits(10),
            pitch: r.readBits(10),
            buttons: r.readBits(16),
          });
        }
        return { kind: 'Input', tick, moveX, moveY, yaw, pitch, buttons, prior };
      }
      case MessageType.Snapshot:
        return { kind: 'Snapshot', snapshot: readSnapshot(r) };
      case MessageType.Delta: {
        const tick = r.readVarUint();
        const baselineTick = r.readBool() ? r.readVarUint() : null;
        const lastProcessedInputTick = r.readVarUint() - 1;
        return { kind: 'Delta', tick, baselineTick, lastProcessedInputTick, payload: r.readBytes() };
      }
      case MessageType.Fire:
        return {
          kind: 'Fire',
          tick: r.readVarUint(),
          yaw: r.readBits(12),
          pitch: r.readBits(12),
          renderTimeMs: r.readVarUint(),
          weapon: r.readBits(3),
          ads: r.readBool(),
        };
      case MessageType.HitEvent:
        return {
          kind: 'HitEvent',
          shooterNetId: r.readVarUint(),
          targetNetId: r.readVarUint(),
          x: dequantize(r.readBits(POSITION.bits), POSITION),
          y: dequantize(r.readBits(POSITION.bits), POSITION),
          z: dequantize(r.readBits(POSITION.bits), POSITION),
          originX: dequantize(r.readBits(POSITION.bits), POSITION),
          originY: dequantize(r.readBits(POSITION.bits), POSITION),
          originZ: dequantize(r.readBits(POSITION.bits), POSITION),
          damage: dequantize(r.readBits(HEALTH.bits), HEALTH),
        };
      case MessageType.Throw:
        return {
          kind: 'Throw',
          tick: r.readVarUint(),
          yaw: r.readBits(12),
          pitch: r.readBits(12),
          projectile: r.readBits(2),
        };
      case MessageType.Detonation: {
        const netId = r.readVarUint();
        const projectile = r.readBits(2);
        const tick = r.readVarUint();
        const x = dequantize(r.readBits(POSITION.bits), POSITION);
        const y = dequantize(r.readBits(POSITION.bits), POSITION);
        const z = dequantize(r.readBits(POSITION.bits), POSITION);
        const count = r.readBits(3);
        const targets: { netId: number; damage: number }[] = [];
        for (let i = 0; i < count; i += 1) {
          targets.push({ netId: r.readVarUint(), damage: dequantize(r.readBits(HEALTH.bits), HEALTH) });
        }
        return { kind: 'Detonation', netId, projectile, tick, x, y, z, targets };
      }
      case MessageType.Ack:
        return { kind: 'Ack', tick: r.readVarUint() };
      case MessageType.Ping:
        return { kind: 'Ping', id: r.readVarUint(), clientTime: r.readVarUint() };
      case MessageType.Pong:
        return { kind: 'Pong', id: r.readVarUint(), clientTime: r.readVarUint(), serverTime: r.readVarUint() };
      case MessageType.Disconnect: {
        const code = DISCONNECT_CODES[r.readBits(DISCONNECT_CODE_BITS)] ?? 'other';
        return { kind: 'Disconnect', code, reason: r.readString() };
      }
      case MessageType.Roster: {
        const count = r.readBits(3);
        const slots: RosterEntry[] = [];
        for (let i = 0; i < count; i += 1) {
          const human = r.readBool();
          slots.push({ human, name: r.readString() });
        }
        return { kind: 'Roster', slots };
      }
      default:
        throw new ProtocolError(`unknown message type ${type}`);
    }
  } catch (e) {
    if (e instanceof ProtocolError) throw e;
    throw new ProtocolError(`malformed message of type ${type}: ${(e as Error).message}`);
  }
}

export type HandshakeResult =
  | { ok: true }
  | { ok: false; code: DisconnectCode; reason: string };

/**
 * Reject version skew at the handshake, before it can corrupt anything.
 *
 * Version is checked FIRST, before the room, so a stale client is told it is
 * stale rather than that its room does not exist — a published client will
 * routinely be older than the host from T-1.5.07 on, and "no such room" would
 * send its owner to re-check a code that was fine.
 */
export function checkHandshake(msg: Message): HandshakeResult {
  if (msg.kind !== 'Join') {
    return { ok: false, code: 'protocol error', reason: `expected Join, got ${msg.kind}` };
  }
  if (msg.version !== PROTOCOL_VERSION) {
    return {
      ok: false,
      code: 'bad version',
      reason: `protocol version mismatch: server speaks ${PROTOCOL_VERSION}, client sent ${msg.version}`,
    };
  }
  if (msg.name.length === 0 || msg.name.length > 32) {
    return { ok: false, code: 'protocol error', reason: 'name must be 1-32 characters' };
  }
  if (msg.room !== '' && !isRoomCode(msg.room)) {
    return { ok: false, code: 'no such room', reason: `'${msg.room}' is not a room code` };
  }
  return { ok: true };
}
