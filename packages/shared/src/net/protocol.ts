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

/** Bump whenever the schema, quantization, or message layout changes. */
export const PROTOCOL_VERSION = 3;

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
} as const;
export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

const TYPE_BITS = 4;

export type Message =
  | { kind: 'Join'; version: number; name: string }
  | { kind: 'JoinAck'; netId: number; slot: number; serverTick: number }
  | { kind: 'Input'; tick: number; moveX: number; moveY: number; yaw: number; pitch: number; buttons: number }
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
      yaw: number;
      pitch: number;
      renderTimeMs: number;
      weapon: number;
      /** Aimed: the server needs it to pick the same cone the client drew. */
      ads: boolean;
    }
  /**
   * The authoritative outcome of a shot, broadcast to everyone so all clients
   * draw the same tracer. The shooter's muzzle is derivable from its replicated
   * position, so only the endpoint travels.
   */
  | {
      kind: 'HitEvent';
      shooterNetId: number;
      /** 0 when nothing was hit. */
      targetNetId: number;
      x: number;
      y: number;
      z: number;
      damage: number;
    }
  | { kind: 'Ack'; tick: number }
  | { kind: 'Ping'; id: number; clientTime: number }
  | { kind: 'Pong'; id: number; clientTime: number; serverTime: number }
  | { kind: 'Disconnect'; reason: string };

export class ProtocolError extends Error {}

export function encodeMessage(msg: Message): Uint8Array {
  const w = new BitWriter();
  switch (msg.kind) {
    case 'Join':
      w.writeBits(MessageType.Join, TYPE_BITS);
      w.writeBits(msg.version, 8);
      w.writeString(msg.name);
      break;
    case 'JoinAck':
      w.writeBits(MessageType.JoinAck, TYPE_BITS);
      w.writeVarUint(msg.netId);
      w.writeBits(msg.slot, 3);
      w.writeVarUint(msg.serverTick);
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
      w.writeBits(msg.yaw & 0x3ff, 10);
      w.writeBits(msg.pitch & 0x3ff, 10);
      w.writeVarUint(Math.max(0, Math.round(msg.renderTimeMs)));
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
      w.writeBits(quantize(msg.damage, HEALTH), HEALTH.bits);
      break;
    case 'Ack':
      w.writeBits(MessageType.Ack, TYPE_BITS);
      w.writeVarUint(msg.tick);
      break;
    case 'Ping':
      w.writeBits(MessageType.Ping, TYPE_BITS);
      w.writeVarUint(msg.id);
      w.writeVarUint(msg.clientTime);
      break;
    case 'Pong':
      w.writeBits(MessageType.Pong, TYPE_BITS);
      w.writeVarUint(msg.id);
      w.writeVarUint(msg.clientTime);
      w.writeVarUint(msg.serverTime);
      break;
    case 'Disconnect':
      w.writeBits(MessageType.Disconnect, TYPE_BITS);
      w.writeString(msg.reason);
      break;
  }
  return w.toUint8Array();
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
      case MessageType.Join:
        return { kind: 'Join', version: r.readBits(8), name: r.readString() };
      case MessageType.JoinAck:
        return { kind: 'JoinAck', netId: r.readVarUint(), slot: r.readBits(3), serverTick: r.readVarUint() };
      case MessageType.Input: {
        const tick = r.readVarUint();
        const moveX = int8(r.readBits(8)) / 127;
        const moveY = int8(r.readBits(8)) / 127;
        return { kind: 'Input', tick, moveX, moveY, yaw: r.readBits(10), pitch: r.readBits(10), buttons: r.readBits(16) };
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
          yaw: r.readBits(10),
          pitch: r.readBits(10),
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
          damage: dequantize(r.readBits(HEALTH.bits), HEALTH),
        };
      case MessageType.Ack:
        return { kind: 'Ack', tick: r.readVarUint() };
      case MessageType.Ping:
        return { kind: 'Ping', id: r.readVarUint(), clientTime: r.readVarUint() };
      case MessageType.Pong:
        return { kind: 'Pong', id: r.readVarUint(), clientTime: r.readVarUint(), serverTime: r.readVarUint() };
      case MessageType.Disconnect:
        return { kind: 'Disconnect', reason: r.readString() };
      default:
        throw new ProtocolError(`unknown message type ${type}`);
    }
  } catch (e) {
    if (e instanceof ProtocolError) throw e;
    throw new ProtocolError(`malformed message of type ${type}: ${(e as Error).message}`);
  }
}

export interface HandshakeResult {
  ok: boolean;
  reason?: string;
}

/** Reject version skew at the handshake, before it can corrupt anything. */
export function checkHandshake(msg: Message): HandshakeResult {
  if (msg.kind !== 'Join') return { ok: false, reason: `expected Join, got ${msg.kind}` };
  if (msg.version !== PROTOCOL_VERSION) {
    return {
      ok: false,
      reason: `protocol version mismatch: server speaks ${PROTOCOL_VERSION}, client sent ${msg.version}`,
    };
  }
  if (msg.name.length === 0 || msg.name.length > 32) {
    return { ok: false, reason: 'name must be 1-32 characters' };
  }
  return { ok: true };
}
