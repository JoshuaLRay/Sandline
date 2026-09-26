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
import { isJoinCode } from './roomCode.ts';
import { MAX_MARKS, ORDER_KINDS, type BotOrder, type OrderAddress, type OrderKind, type OrderPoint, type TargetMark } from '../sim/orders.ts';
import { MISSION_STATES, OBJECTIVE_TYPES, type MissionView } from '../sim/mission.ts';
import type { ScriptBlockerState } from '../sim/events.ts';
import { PROGRESSION, type SoldierProgress } from '../sim/progression.ts';
import type { MissionStats } from '../sim/scoreboard.ts';

/** Bump whenever the schema, quantization, or message layout changes. */
export const PROTOCOL_VERSION = 32;

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
  /**
   * T-3.02: the host named a world this client's build does not have. The
   * client refuses the join rather than render the wrong scenery and predict
   * against boxes the server does not collide with.
   */
  'unknown world',
  /**
   * The host requires a join key (`JOIN_KEY`) and this Join did not carry the
   * right one. Terminal: the retry would carry the same key.
   */
  'bad key',
  /** No input from this player for the host's idle limit (`IDLE_TIMEOUT_MS`). */
  'idle',
  /** Connected for the host's session limit (`MAX_SESSION_MS`); rejoin to keep playing. */
  'session limit',
  /**
   * T-4.22: the player-identity token the Join offered is forged, malformed,
   * or past its expiry. Terminal for that token: the client forgets it, and
   * its next Join, without one, is issued a new identity.
   */
  'bad identity',
] as const;
export type DisconnectCode = (typeof DISCONNECT_CODES)[number];
const DISCONNECT_CODE_BITS = 4;

/** One row of the squad, as the lobby shows it: six of these, always. */
export interface RosterEntry {
  /** Empty for a bot. */
  name: string;
  human: boolean;
  /** The class the slot plays (T-4.27, a classes.json id); '' before the host has assigned one. */
  classId: string;
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
  Equip: 14,
  /**
   * The extended family: the four-bit tag's last value, then a three-bit
   * sub-kind (`EXT`) — T-3.09's AI debug request and report, and T-3.27's
   * orders and marks. Each is refused by the side that should not receive it.
   */
  Ext: 15,
} as const;
export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

const TYPE_BITS = 4;

/** Sub-kinds under `MessageType.Ext`, three bits: the wire order. */
const EXT = { AiDebugRequest: 0, AiDebug: 1, Order: 2, Mark: 3, Orders: 4, Marks: 5, Mission: 6, Events: 7 } as const;
/**
 * Mission, room and progression messages share a three-bit variant (T-4.24).
 */
const MISSION_VARIANT = { State: 0, Restart: 1, RoomState: 2, RoomCommand: 3, Progression: 4, Stats: 5 } as const;
const ROOM_COMMANDS = ['ready', 'start', 'class'] as const;
/** T-4.15: state plus transient message/callout notifications. */
const EVENT_VARIANT = { State: 0, Message: 1, Callout: 2 } as const;
const EXT_BITS = 3;
const ORDER_KIND_BITS = 3;
const ADDRESS_TO = ['slot', 'fireteam', 'all'] as const;

/** How a debugged brain's intent asks to be walked. The order is the wire encoding. */
export const AI_DEBUG_PACES = ['walk', 'sprint', 'crouch'] as const;
export type AiDebugPace = (typeof AI_DEBUG_PACES)[number];

/** Caps on an AiDebug report's lists: a debug view, not a way to flood a client. */
export const AI_DEBUG_LIMITS = Object.freeze({
  brains: 64,
  treeDepth: 16,
  corridor: 64,
  cones: 4,
  targets: 16,
});

export interface AiDebugPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * One perception cone: from the brain's position, facing `yaw`, `halfAngle`
 * either side of it, out to `range`. Angles in wire units (1/1024 turn, 0
 * along +Z, a quarter turn along +X — `stepCharacter`'s forward).
 */
export interface AiDebugCone {
  yaw: number;
  halfAngle: number;
  /** Metres, to the centimetre. */
  range: number;
}

/**
 * Everything one brain's reasons are drawn from (T-3.09). The overlay builds
 * its geometry from this and nothing else, so the bot's own position travels
 * too rather than being looked up from a snapshot at a different tick.
 */
export interface AiDebugBrain {
  netId: number;
  /** Where the body stood when the report was built. */
  position: AiDebugPoint;
  /** The running branch, root first (`runningPath`). */
  tree: readonly string[];
  /** Where locomotion was asked to go, and how; null stands it still. */
  intent: (AiDebugPoint & { pace: AiDebugPace }) | null;
  /** The string-pulled path being walked: start, each corner, end. Empty when none. */
  corridor: readonly AiDebugPoint[];
  /** Perception cones (T-3.13); empty until perception exists. */
  cones: readonly AiDebugCone[];
  /** Targets the brain knows about and where it believes they are (T-3.13). */
  targets: readonly (AiDebugPoint & { netId: number })[];
  /** The cover point the brain chose (T-3.18); null when none. */
  cover: AiDebugPoint | null;
}

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
  | {
      kind: 'Join';
      version: number;
      name: string;
      room: string;
      /**
       * The host's join key, as the player typed it. Absent and empty mean the
       * same: no key, which a host without `JOIN_KEY` accepts and one with it
       * refuses as `bad key`.
       */
      key?: string;
      /**
       * T-3.35 follow-up: the named world a room is to be built with, asked
       * for by the player who creates it (`room` empty). Absent and empty
       * mean the host's own default; a host ignores it for a room that
       * exists, and one it does not know is the default too. JoinAck names
       * the world the room has, whatever was asked.
       */
      world?: string;
      /**
       * T-4.18: the token the last JoinAck gave this client, offered on a
       * reconnect to take its own slot back. Absent and empty mean a fresh
       * join; an unknown or expired token is a fresh join too, never an error.
       */
      resume?: string;
      /**
       * T-4.22 (ADR-019): the player-identity token a host signed for this
       * client, kept by it and offered on every Join. Absent and empty mean
       * none, and the host issues one. Unlike `resume`, a token the host did
       * not sign or that has expired is refused as `bad identity`.
       */
      identity?: string;
      /** T-4.19: empty-room Join may quick-match by selected mission/world. */
      quick?: boolean;
    }
  | {
      kind: 'JoinAck';
      netId: number;
      slot: number;
      serverTick: number;
      room: string;
      /** The session's named world (T-3.02); the client builds it with `getWorld`. */
      world: string;
      /**
       * T-4.18: this seat's resume token. Offered in a Join after a dropped
       * socket, within the host's grace time, it seats the client back in
       * this slot. A new one with every seating.
       */
      resume: string;
      /** T-4.18: whether this JoinAck seated the client back in its own slot. */
      resumed: boolean;
      /**
       * T-4.22: the client's identity token: the one it offered, a rotated one
       * for the same player, or a newly issued one. The client keeps the latest.
       * Empty from a session that issues none (the in-page one).
       */
      identity: string;
    }
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
   * What is in the hands: an index into the loadout, the guns (WEAPON_IDS)
   * first and the pouch (PROJECTILE_IDS) after them. A grenade or a rocket is
   * held like a gun and used with the trigger, so the rest of the squad needs
   * to see it in hand before it is thrown, not only after. Sent once per
   * switch, reliably; bounds-checked by the server like every other index.
   */
  | { kind: 'Equip'; item: number }
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
  | { kind: 'Roster'; slots: RosterEntry[] }
  /**
   * T-3.09: a client asking for (or no longer wanting) AI debug reports. A
   * host that was not started with `AI_DEBUG=1` ignores it and sends nothing.
   */
  | { kind: 'AiDebugRequest'; on: boolean }
  /**
   * T-3.09: every bot brain's reasons as of `tick`, sent only to clients that
   * asked, only by a host that allows it.
   */
  | { kind: 'AiDebug'; tick: number; brains: readonly AiDebugBrain[] }
  /**
   * T-3.27: a player's order to bots — a kind, whom it is for, and the point
   * or target it needs (`sim/orders.ts`). Client to host; the host checks
   * everything the wire cannot.
   */
  | { kind: 'Order'; order: OrderKind; address: OrderAddress; point: OrderPoint | null; target: number | null }
  /** T-3.27: a player marking a point, or a target at it, for the squad. Client to host. */
  | { kind: 'Mark'; point: OrderPoint; target: number | null }
  /** T-3.27: every bot's current order, whole, whenever one changes and on seating. Host to client. */
  | { kind: 'Orders'; orders: readonly BotOrder[] }
  /** T-3.27: every standing mark, whole, whenever one is made or expires and on seating. Host to client. */
  | { kind: 'Marks'; marks: readonly TargetMark[] }
  /** T-3.34: where the mission stands, on every change, each second of a hold, and on seating. Host to client. */
  | ({ kind: 'Mission' } & MissionView)
  /** T-3.34: a player asking for the mission to start again. Client to host; honoured once it is over. */
  | { kind: 'MissionRestart' }
  | { kind: 'Progression'; soldiers: SoldierProgress[] }
  /** T-4.28: the server's scoreboard, six rows whole, the mission clock and the objectives done. Host to client. */
  | ({ kind: 'Stats' } & MissionStats)
  /** T-4.19: authoritative pre-mission room state. Class ids are reserved for T-4.27. */
  | { kind: 'RoomState'; started: boolean; creator: number; world: string; ready: readonly boolean[]; classes: readonly string[] }
  /** T-4.19: ready toggle or creator-only force start. */
  | { kind: 'RoomCommand'; command: (typeof ROOM_COMMANDS)[number]; ready?: boolean; classId?: string }
  /** T-4.15: all dynamic blockers, whole, whenever one changes and on seating. Host to client. */
  | { kind: 'ScriptState'; blockers: readonly ScriptBlockerState[] }
  /** T-4.15: an authored on-screen mission message. Host to client. */
  | { kind: 'ScriptMessage'; text: string }
  /** T-4.15: an authored E-2.7 callout id. Host to client. */
  | { kind: 'ScriptCallout'; id: string };

export class ProtocolError extends Error {}

export function encodeMessage(msg: Message): Uint8Array {
  const w = new BitWriter();
  switch (msg.kind) {
    case 'Join':
      w.writeBits(MessageType.Join, TYPE_BITS);
      w.writeBits(msg.version, 8);
      w.writeString(msg.name);
      w.writeString(msg.room);
      w.writeString(msg.key ?? '');
      w.writeString(msg.world ?? '');
      w.writeString(msg.resume ?? '');
      w.writeString(msg.identity ?? '');
      w.writeBool(msg.quick ?? false);
      break;
    case 'JoinAck':
      w.writeBits(MessageType.JoinAck, TYPE_BITS);
      w.writeVarUint(msg.netId);
      w.writeBits(msg.slot, 3);
      w.writeVarUint(msg.serverTick);
      w.writeString(msg.room);
      w.writeString(msg.world);
      w.writeString(msg.resume);
      w.writeBits(msg.resumed ? 1 : 0, 1);
      w.writeString(msg.identity);
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
    case 'Equip':
      w.writeBits(MessageType.Equip, TYPE_BITS);
      w.writeBits(msg.item & 0x7, 3);
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
        w.writeString(entry.classId);
      }
      break;
    case 'AiDebugRequest':
      w.writeBits(MessageType.Ext, TYPE_BITS);
      w.writeBits(EXT.AiDebugRequest, EXT_BITS);
      w.writeBool(msg.on);
      break;
    case 'Order':
      w.writeBits(MessageType.Ext, TYPE_BITS);
      w.writeBits(EXT.Order, EXT_BITS);
      w.writeBits(ORDER_KINDS.indexOf(msg.order), ORDER_KIND_BITS);
      w.writeBits(ADDRESS_TO.indexOf(msg.address.to), 2);
      w.writeBits(msg.address.to === 'all' ? 0 : msg.address.index & 0x7, 3);
      writeOptionalPoint(w, msg.point);
      writeOptionalTarget(w, msg.target);
      break;
    case 'Mark':
      w.writeBits(MessageType.Ext, TYPE_BITS);
      w.writeBits(EXT.Mark, EXT_BITS);
      writePoint(w, msg.point);
      writeOptionalTarget(w, msg.target);
      break;
    case 'Orders': {
      w.writeBits(MessageType.Ext, TYPE_BITS);
      w.writeBits(EXT.Orders, EXT_BITS);
      // One per bot at most: six slots is the whole squad (ADR-001).
      const orders = msg.orders.slice(0, 6);
      w.writeBits(orders.length, 3);
      for (const o of orders) {
        w.writeBits(o.slot & 0x7, 3);
        w.writeBits(ORDER_KINDS.indexOf(o.order), ORDER_KIND_BITS);
        w.writeBits(o.from & 0x7, 3);
        writeOptionalPoint(w, o.point);
        writeOptionalTarget(w, o.target);
      }
      break;
    }
    case 'Mission':
      w.writeBits(MessageType.Ext, TYPE_BITS);
      w.writeBits(EXT.Mission, EXT_BITS);
      w.writeBits(MISSION_VARIANT.State, 3);
      w.writeBits(MISSION_STATES.indexOf(msg.state), 2);
      w.writeVarUint(msg.attempt);
      // T-4.14: the current objective of the sequence, its type and progress.
      w.writeVarUint(msg.objective);
      w.writeVarUint(msg.objectives);
      w.writeBits(OBJECTIVE_TYPES.indexOf(msg.type), 3);
      w.writeString(msg.label);
      w.writeBool(msg.satisfied);
      w.writeVarUint(msg.progress);
      w.writeVarUint(msg.goal);
      break;
    case 'MissionRestart':
      w.writeBits(MessageType.Ext, TYPE_BITS);
      w.writeBits(EXT.Mission, EXT_BITS);
      w.writeBits(MISSION_VARIANT.Restart, 3);
      break;
    case 'RoomState': {
      w.writeBits(MessageType.Ext, TYPE_BITS);
      w.writeBits(EXT.Mission, EXT_BITS);
      w.writeBits(MISSION_VARIANT.RoomState, 3);
      w.writeBool(msg.started);
      w.writeBits(msg.creator & 0x7, 3);
      w.writeString(msg.world);
      const count = Math.min(6, Math.max(msg.ready.length, msg.classes.length));
      w.writeBits(count, 3);
      for (let i = 0; i < count; i += 1) {
        w.writeBool(msg.ready[i] ?? false);
        w.writeString(msg.classes[i] ?? '');
      }
      break;
    }
    case 'RoomCommand':
      w.writeBits(MessageType.Ext, TYPE_BITS);
      w.writeBits(EXT.Mission, EXT_BITS);
      w.writeBits(MISSION_VARIANT.RoomCommand, 3);
      w.writeBits(ROOM_COMMANDS.indexOf(msg.command), 2);
      w.writeBool(msg.command === 'ready' ? (msg.ready ?? false) : false);
      // T-4.27: the class a player picks in the room.
      w.writeString(msg.command === 'class' ? (msg.classId ?? '') : '');
      break;
    case 'Stats': {
      w.writeBits(MessageType.Ext, TYPE_BITS);
      w.writeBits(EXT.Mission, EXT_BITS);
      w.writeBits(MISSION_VARIANT.Stats, 3);
      if (msg.slots.length !== 6) throw new ProtocolError('stats need six slots');
      for (const [slot, row] of msg.slots.entries()) {
        const counts = [row.kills, row.deaths, row.revives, row.ordersGiven, row.ordersCarried];
        if (row.slot !== slot || counts.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffffffff)) throw new ProtocolError('invalid slot stats');
        for (const n of counts) w.writeVarUint(n);
      }
      for (const n of [msg.elapsedTicks, msg.objectivesDone, msg.objectives]) {
        if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new ProtocolError('invalid mission stats');
        w.writeVarUint(n);
      }
      break;
    }
    case 'Progression': {
      w.writeBits(MessageType.Ext, TYPE_BITS);
      w.writeBits(EXT.Mission, EXT_BITS);
      w.writeBits(MISSION_VARIANT.Progression, 3);
      if (msg.soldiers.length !== 6) throw new ProtocolError('progression needs six soldiers');
      for (const [slot, soldier] of msg.soldiers.entries()) {
        if (soldier.slot !== slot || !Number.isInteger(soldier.rank) || soldier.rank < 0 || soldier.rank >= PROGRESSION.ranks.length ||
          [soldier.xp, soldier.earned].some((value) => !Number.isInteger(value) || value < 0 || value > 0xffffffff) || soldier.earned > soldier.xp) {
          throw new ProtocolError('invalid soldier progression');
        }
        w.writeVarUint(soldier.xp);
        w.writeVarUint(soldier.rank);
        w.writeVarUint(soldier.earned);
      }
      break;
    }
    case 'ScriptState': {
      w.writeBits(MessageType.Ext, TYPE_BITS);
      w.writeBits(EXT.Events, EXT_BITS);
      w.writeBits(EVENT_VARIANT.State, 2);
      const blockers = msg.blockers.slice(0, 32);
      w.writeVarUint(blockers.length);
      for (const blocker of blockers) {
        w.writeString(blocker.id);
        w.writeBool(blocker.active);
        const boxes = blocker.boxes.slice(0, 16);
        w.writeVarUint(boxes.length);
        for (const box of boxes) {
          w.writeBits(quantize(box.minX, POSITION), POSITION.bits);
          w.writeBits(quantize(box.minY, POSITION), POSITION.bits);
          w.writeBits(quantize(box.minZ, POSITION), POSITION.bits);
          w.writeBits(quantize(box.maxX, POSITION), POSITION.bits);
          w.writeBits(quantize(box.maxY, POSITION), POSITION.bits);
          w.writeBits(quantize(box.maxZ, POSITION), POSITION.bits);
        }
      }
      break;
    }
    case 'ScriptMessage':
      w.writeBits(MessageType.Ext, TYPE_BITS);
      w.writeBits(EXT.Events, EXT_BITS);
      w.writeBits(EVENT_VARIANT.Message, 2);
      w.writeString(msg.text);
      break;
    case 'ScriptCallout':
      w.writeBits(MessageType.Ext, TYPE_BITS);
      w.writeBits(EXT.Events, EXT_BITS);
      w.writeBits(EVENT_VARIANT.Callout, 2);
      w.writeString(msg.id);
      break;
    case 'Marks': {
      w.writeBits(MessageType.Ext, TYPE_BITS);
      w.writeBits(EXT.Marks, EXT_BITS);
      const marks = msg.marks.slice(0, MAX_MARKS);
      w.writeVarUint(marks.length);
      for (const m of marks) {
        w.writeVarUint(m.id);
        w.writeBits(m.from & 0x7, 3);
        writePoint(w, m.point);
        writeOptionalTarget(w, m.target);
        w.writeVarUint(m.expiresTick);
      }
      break;
    }
    case 'AiDebug': {
      w.writeBits(MessageType.Ext, TYPE_BITS);
      w.writeBits(EXT.AiDebug, EXT_BITS);
      w.writeVarUint(msg.tick);
      const brains = msg.brains.slice(0, AI_DEBUG_LIMITS.brains);
      w.writeVarUint(brains.length);
      for (const b of brains) writeAiDebugBrain(w, b);
      break;
    }
  }
  return w.toUint8Array();
}

function writeOptionalPoint(w: BitWriter, p: OrderPoint | null): void {
  w.writeBool(p !== null);
  if (p) writePoint(w, p);
}

function readOptionalPoint(r: BitReader): OrderPoint | null {
  return r.readBool() ? readPoint(r) : null;
}

function writeOptionalTarget(w: BitWriter, target: number | null): void {
  w.writeBool(target !== null);
  if (target !== null) w.writeVarUint(target);
}

function readOptionalTarget(r: BitReader): number | null {
  return r.readBool() ? r.readVarUint() : null;
}

/** An order kind off the wire, refused past the last one. */
function readOrderKind(r: BitReader): OrderKind {
  const i = r.readBits(ORDER_KIND_BITS);
  const kind = ORDER_KINDS[i];
  if (kind === undefined) throw new ProtocolError(`unknown order kind ${i}`);
  return kind;
}

function writePoint(w: BitWriter, p: AiDebugPoint): void {
  w.writeBits(quantize(p.x, POSITION), POSITION.bits);
  w.writeBits(quantize(p.y, POSITION), POSITION.bits);
  w.writeBits(quantize(p.z, POSITION), POSITION.bits);
}

function readPoint(r: BitReader): AiDebugPoint {
  return {
    x: dequantize(r.readBits(POSITION.bits), POSITION),
    y: dequantize(r.readBits(POSITION.bits), POSITION),
    z: dequantize(r.readBits(POSITION.bits), POSITION),
  };
}

/** A list count, refused on read past its cap rather than trusted. */
function readCount(r: BitReader, cap: number, what: string): number {
  const n = r.readVarUint();
  if (n > cap) throw new ProtocolError(`${what} count ${n} exceeds ${cap}`);
  return n;
}

function writeAiDebugBrain(w: BitWriter, b: AiDebugBrain): void {
  w.writeVarUint(b.netId);
  writePoint(w, b.position);
  const tree = b.tree.slice(0, AI_DEBUG_LIMITS.treeDepth);
  w.writeVarUint(tree.length);
  for (const node of tree) w.writeString(node);
  w.writeBool(b.intent !== null);
  if (b.intent) {
    writePoint(w, b.intent);
    w.writeBits(Math.max(0, AI_DEBUG_PACES.indexOf(b.intent.pace)), 2);
  }
  const corridor = b.corridor.slice(0, AI_DEBUG_LIMITS.corridor);
  w.writeVarUint(corridor.length);
  for (const p of corridor) writePoint(w, p);
  const cones = b.cones.slice(0, AI_DEBUG_LIMITS.cones);
  w.writeVarUint(cones.length);
  for (const c of cones) {
    w.writeBits(c.yaw & 0x3ff, 10);
    w.writeBits(Math.min(512, Math.max(0, Math.round(c.halfAngle))), 10);
    w.writeVarUint(Math.max(0, Math.round(c.range * 100)));
  }
  const targets = b.targets.slice(0, AI_DEBUG_LIMITS.targets);
  w.writeVarUint(targets.length);
  for (const t of targets) {
    w.writeVarUint(t.netId);
    writePoint(w, t);
  }
  w.writeBool(b.cover !== null);
  if (b.cover) writePoint(w, b.cover);
}

function readAiDebugBrain(r: BitReader): AiDebugBrain {
  const netId = r.readVarUint();
  const position = readPoint(r);
  const tree: string[] = [];
  for (let i = readCount(r, AI_DEBUG_LIMITS.treeDepth, 'tree'); i > 0; i -= 1) tree.push(r.readString());
  let intent: AiDebugBrain['intent'] = null;
  if (r.readBool()) {
    const at = readPoint(r);
    const pace = AI_DEBUG_PACES[r.readBits(2)];
    if (!pace) throw new ProtocolError('AiDebug pace out of range');
    intent = { ...at, pace };
  }
  const corridor: AiDebugPoint[] = [];
  for (let i = readCount(r, AI_DEBUG_LIMITS.corridor, 'corridor'); i > 0; i -= 1) corridor.push(readPoint(r));
  const cones: AiDebugCone[] = [];
  for (let i = readCount(r, AI_DEBUG_LIMITS.cones, 'cone'); i > 0; i -= 1) {
    cones.push({ yaw: r.readBits(10), halfAngle: r.readBits(10), range: r.readVarUint() / 100 });
  }
  const targets: (AiDebugPoint & { netId: number })[] = [];
  for (let i = readCount(r, AI_DEBUG_LIMITS.targets, 'target'); i > 0; i -= 1) {
    const id = r.readVarUint();
    targets.push({ netId: id, ...readPoint(r) });
  }
  const cover = r.readBool() ? readPoint(r) : null;
  return { netId, position, tree, intent, corridor, cones, targets, cover };
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
        const name = r.readString();
        const room = r.readString();
        const key = r.readString();
        const world = r.readString();
        const resume = r.readString();
        const identity = r.readString();
        const quick = r.readBool();
        return {
          kind: 'Join',
          version,
          name,
          room,
          ...(key === '' ? {} : { key }),
          ...(world === '' ? {} : { world }),
          ...(resume === '' ? {} : { resume }),
          ...(identity === '' ? {} : { identity }),
          ...(quick ? { quick } : {}),
        };
      }
      case MessageType.JoinAck:
        return {
          kind: 'JoinAck',
          netId: r.readVarUint(),
          slot: r.readBits(3),
          serverTick: r.readVarUint(),
          room: r.readString(),
          world: r.readString(),
          resume: r.readString(),
          resumed: r.readBits(1) === 1,
          identity: r.readString(),
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
      case MessageType.Equip:
        return { kind: 'Equip', item: r.readBits(3) };
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
          const name = r.readString();
          slots.push({ human, name, classId: r.readString() });
        }
        return { kind: 'Roster', slots };
      }
      case MessageType.Ext: {
        const sub = r.readBits(EXT_BITS);
        switch (sub) {
          case EXT.AiDebugRequest:
            return { kind: 'AiDebugRequest', on: r.readBool() };
          case EXT.AiDebug: {
            const tick = r.readVarUint();
            const brains: AiDebugBrain[] = [];
            for (let i = readCount(r, AI_DEBUG_LIMITS.brains, 'brain'); i > 0; i -= 1) brains.push(readAiDebugBrain(r));
            return { kind: 'AiDebug', tick, brains };
          }
          case EXT.Order: {
            const order = readOrderKind(r);
            const to = ADDRESS_TO[r.readBits(2)];
            if (to === undefined) throw new ProtocolError('unknown order addressee');
            const index = r.readBits(3);
            const address: OrderAddress = to === 'all' ? { to } : { to, index };
            return { kind: 'Order', order, address, point: readOptionalPoint(r), target: readOptionalTarget(r) };
          }
          case EXT.Mark:
            return { kind: 'Mark', point: readPoint(r), target: readOptionalTarget(r) };
          case EXT.Orders: {
            const orders: BotOrder[] = [];
            for (let i = r.readBits(3); i > 0; i -= 1) {
              const slot = r.readBits(3);
              const order = readOrderKind(r);
              const from = r.readBits(3);
              orders.push({ slot, order, from, point: readOptionalPoint(r), target: readOptionalTarget(r) });
            }
            return { kind: 'Orders', orders };
          }
          case EXT.Marks: {
            const marks: TargetMark[] = [];
            for (let i = readCount(r, MAX_MARKS, 'mark'); i > 0; i -= 1) {
              const id = r.readVarUint();
              const from = r.readBits(3);
              marks.push({ id, from, point: readPoint(r), target: readOptionalTarget(r), expiresTick: r.readVarUint() });
            }
            return { kind: 'Marks', marks };
          }
          case EXT.Mission: {
            const variant = r.readBits(3);
            if (variant === MISSION_VARIANT.Stats) {
              const slots: MissionStats['slots'] = [];
              for (let slot = 0; slot < 6; slot++) {
                slots.push({ slot, kills: r.readVarUint(), deaths: r.readVarUint(), revives: r.readVarUint(), ordersGiven: r.readVarUint(), ordersCarried: r.readVarUint() });
              }
              const elapsedTicks = r.readVarUint();
              const objectivesDone = r.readVarUint();
              const objectives = r.readVarUint();
              return { kind: 'Stats', slots, elapsedTicks, objectivesDone, objectives };
            }
            if (variant === MISSION_VARIANT.Progression) {
              const soldiers: SoldierProgress[] = [];
              for (let slot = 0; slot < 6; slot++) {
                const xp = r.readVarUint();
                const rank = r.readVarUint();
                const earned = r.readVarUint();
                if (rank >= PROGRESSION.ranks.length || earned > xp) throw new ProtocolError('invalid soldier progression');
                soldiers.push({ slot, xp, rank, earned });
              }
              return { kind: 'Progression', soldiers };
            }
            if (variant === MISSION_VARIANT.Restart) return { kind: 'MissionRestart' };
            if (variant === MISSION_VARIANT.RoomCommand) {
              const command = ROOM_COMMANDS[r.readBits(2)];
              if (command === undefined) throw new ProtocolError('unknown room command');
              const ready = r.readBool();
              const classId = r.readString();
              if (command === 'ready') return { kind: 'RoomCommand', command, ready };
              if (command === 'class') return { kind: 'RoomCommand', command, classId };
              return { kind: 'RoomCommand', command };
            }
            if (variant === MISSION_VARIANT.RoomState) {
              const started = r.readBool();
              const creator = r.readBits(3);
              const world = r.readString();
              const count = r.readBits(3);
              if (count > 6) throw new ProtocolError('room has more than six slots');
              const ready: boolean[] = [];
              const classes: string[] = [];
              for (let i = 0; i < count; i += 1) {
                ready.push(r.readBool());
                classes.push(r.readString());
              }
              return { kind: 'RoomState', started, creator, world, ready, classes };
            }
            if (variant !== MISSION_VARIANT.State) throw new ProtocolError(`unknown mission message ${variant}`);
            const state = MISSION_STATES[r.readBits(2)];
            if (state === undefined) throw new ProtocolError('unknown mission state');
            const attempt = r.readVarUint();
            const objective = r.readVarUint();
            const objectives = r.readVarUint();
            const type = OBJECTIVE_TYPES[r.readBits(3)];
            if (type === undefined) throw new ProtocolError('unknown objective type');
            const label = r.readString();
            const satisfied = r.readBool();
            const progress = r.readVarUint();
            const goal = r.readVarUint();
            if (objectives === 0 || objective >= objectives) throw new ProtocolError('objective out of the mission');
            if (progress > goal) throw new ProtocolError('objective past its goal');
            return { kind: 'Mission', state, attempt, objective, objectives, type, label, satisfied, progress, goal };
          }
          case EXT.Events: {
            const variant = r.readBits(2);
            if (variant === EVENT_VARIANT.Message) return { kind: 'ScriptMessage', text: r.readString() };
            if (variant === EVENT_VARIANT.Callout) return { kind: 'ScriptCallout', id: r.readString() };
            if (variant !== EVENT_VARIANT.State) throw new ProtocolError(`unknown event message ${variant}`);
            const blockers: ScriptBlockerState[] = [];
            for (let i = readCount(r, 32, 'blocker'); i > 0; i -= 1) {
              const id = r.readString();
              const active = r.readBool();
              const boxes = [];
              for (let j = readCount(r, 16, 'blocker box'), k = 0; k < j; k += 1) {
                boxes.push({
                  id: `blocker:${id}/${k}`,
                  kind: 'blocker' as const,
                  minX: dequantize(r.readBits(POSITION.bits), POSITION),
                  minY: dequantize(r.readBits(POSITION.bits), POSITION),
                  minZ: dequantize(r.readBits(POSITION.bits), POSITION),
                  maxX: dequantize(r.readBits(POSITION.bits), POSITION),
                  maxY: dequantize(r.readBits(POSITION.bits), POSITION),
                  maxZ: dequantize(r.readBits(POSITION.bits), POSITION),
                });
              }
              blockers.push({ id, active, boxes });
            }
            return { kind: 'ScriptState', blockers };
          }
          default:
            throw new ProtocolError(`unknown extended message ${sub}`);
        }
      }
      default:
        throw new ProtocolError(`unknown message type ${type}`);
    }
  } catch (e) {
    if (e instanceof ProtocolError) throw e;
    throw new ProtocolError(`malformed message of type ${type}: ${(e as Error).message}`);
  }
}

/** T-4.22: longer than any token a host signs; past it the Join is refused before any crypto. */
export const MAX_IDENTITY_TOKEN_LENGTH = 256;

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
  if ((msg.key ?? '').length > 128) {
    return { ok: false, code: 'bad key', reason: 'join key must be at most 128 characters' };
  }
  if ((msg.identity ?? '').length > MAX_IDENTITY_TOKEN_LENGTH) {
    return { ok: false, code: 'bad identity', reason: `identity token must be at most ${MAX_IDENTITY_TOKEN_LENGTH} characters` };
  }
  if (msg.room !== '' && !isJoinCode(msg.room)) {
    return { ok: false, code: 'no such room', reason: `'${msg.room}' is not a room or campaign code` };
  }
  return { ok: true };
}
