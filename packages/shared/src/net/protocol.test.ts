import { describe, expect, it } from 'vitest';
import {
  AI_DEBUG_LIMITS,
  AI_DEBUG_PACES,
  type AiDebugBrain,
  DISCONNECT_CODES,
  type DisconnectCode,
  MAX_PRIOR_INPUTS,
  type Message,
  MessageType,
  PROTOCOL_VERSION,
  ProtocolError,
  checkHandshake,
  decodeMessage,
  encodeMessage,
} from './protocol.ts';
import { BitWriter } from './BitStream.ts';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  generateRoomCode,
  isRoomCode,
  normalizeRoomCode,
} from './roomCode.ts';
import { COMPONENT_IDS } from '../ecs/components.ts';

const T = COMPONENT_IDS.Transform;

const SAMPLES: Message[] = [
  { kind: 'Join', version: PROTOCOL_VERSION, name: 'bravo-six', room: 'K7PM' },
  { kind: 'Join', version: PROTOCOL_VERSION, name: 'bravo-six', room: '' },
  { kind: 'Join', version: PROTOCOL_VERSION, name: 'bravo-six', room: 'K7PM', key: 'correct horse' },
  // A new room asked for on a named world (the lobby's map choice), with and without a key.
  { kind: 'Join', version: PROTOCOL_VERSION, name: 'bravo-six', room: '', world: 'greybox-01' },
  { kind: 'Join', version: PROTOCOL_VERSION, name: 'bravo-six', room: '', key: 'k', world: 'range' },
  { kind: 'Disconnect', code: 'bad key', reason: 'wrong join key' },
  { kind: 'Disconnect', code: 'session limit', reason: 'session limit' },
  { kind: 'JoinAck', netId: 1234, slot: 5, serverTick: 98765, room: 'K7PM', world: 'range' },
  { kind: 'Ack', tick: 4242 },
  { kind: 'Ping', id: 7, clientTime: 1234567 },
  { kind: 'Pong', id: 7, clientTime: 1234567, serverTime: 1234599 },
  { kind: 'Disconnect', code: 'room full', reason: 'room full' },
  { kind: 'Disconnect', code: 'other', reason: '' },
  {
    kind: 'Roster',
    slots: [
      { human: true, name: 'ray' },
      { human: false, name: '' },
      { human: true, name: 'austin' },
      { human: false, name: '' },
      { human: false, name: '' },
      { human: false, name: '' },
    ],
  },
  { kind: 'Throw', tick: 900, yaw: 4095, pitch: 3072, projectile: 1 },
  { kind: 'Equip', item: 5 },
  {
    kind: 'HitEvent',
    shooterNetId: 3,
    targetNetId: 7,
    x: 12.5,
    y: 1.75,
    z: -40.25,
    originX: -2.5,
    originY: 1.5,
    originZ: -6,
    damage: 22,
  },
  {
    kind: 'Snapshot',
    snapshot: { tick: 9, entities: [{ netId: 1, components: { [T]: [100, 200, 300, 400, 500] } }] },
  },
];

describe('projectiles on the wire (T-2.31)', () => {
  it('round-trips a Detonation with everyone it caught', () => {
    const msg: Message = {
      kind: 'Detonation',
      netId: 2007,
      projectile: 1,
      tick: 1234,
      x: -12.5,
      y: 1.25,
      z: 41.75,
      targets: [
        { netId: 3, damage: 96 },
        { netId: 5, damage: 12 },
      ],
    };
    const got = decodeMessage(encodeMessage(msg));
    if (got.kind !== 'Detonation') throw new Error('wrong kind');
    expect(got.netId).toBe(2007);
    expect(got.projectile).toBe(1);
    expect(got.tick).toBe(1234);
    // Positions ride the same 1/64 m spec every other world point does.
    expect(got.x).toBeCloseTo(-12.5, 2);
    expect(got.y).toBeCloseTo(1.25, 2);
    expect(got.z).toBeCloseTo(41.75, 2);
    expect(got.targets).toEqual(msg.targets);
  });

  it('round-trips a blast that caught nobody, which is most of them', () => {
    const msg: Message = { kind: 'Detonation', netId: 2000, projectile: 0, tick: 7, x: 0, y: 0, z: 0, targets: [] };
    expect(decodeMessage(encodeMessage(msg))).toEqual(msg);
  });

  it('carries the whole squad, and no more', () => {
    const targets = Array.from({ length: 6 }, (_, i) => ({ netId: i + 1, damage: 10 + i }));
    const msg: Message = { kind: 'Detonation', netId: 2001, projectile: 0, tick: 9, x: 1, y: 2, z: 3, targets };
    const got = decodeMessage(encodeMessage(msg));
    if (got.kind !== 'Detonation') throw new Error('wrong kind');
    expect(got.targets).toHaveLength(6);
  });
});

describe('protocol messages (T-1.05)', () => {
  it.each(SAMPLES.map((m) => [m.kind, m] as const))('round-trips %s', (_kind, msg) => {
    expect(decodeMessage(encodeMessage(msg))).toEqual(msg);
  });

  it('round-trips Input within its quantization', () => {
    const msg: Message = { kind: 'Input', tick: 300, moveX: 1, moveY: -1, yaw: 512, pitch: 100, buttons: 0b1011 };
    const got = decodeMessage(encodeMessage(msg));
    if (got.kind !== 'Input') throw new Error('wrong kind');
    expect(got.tick).toBe(300);
    expect(got.moveX).toBeCloseTo(1, 2);
    expect(got.moveY).toBeCloseTo(-1, 2);
    expect(got.yaw).toBe(512);
    expect(got.pitch).toBe(100);
    expect(got.buttons).toBe(0b1011);
  });

  it('preserves the sign of negative move axes', () => {
    // A signed byte read as unsigned would turn left into a hard right.
    for (const v of [-1, -0.5, -0.25, 0, 0.25, 1]) {
      const got = decodeMessage(
        encodeMessage({ kind: 'Input', tick: 1, moveX: v, moveY: 0, yaw: 0, pitch: 0, buttons: 0 }),
      );
      if (got.kind !== 'Input') throw new Error('wrong kind');
      expect(got.moveX).toBeCloseTo(v, 2);
    }
  });

  it('keeps an Input message small enough for 30 Hz', () => {
    const bytes = encodeMessage({ kind: 'Input', tick: 100000, moveX: 1, moveY: 1, yaw: 1023, pitch: 1023, buttons: 0xffff });
    expect(bytes.length).toBeLessThanOrEqual(12);
  });

  it('stays affordable upstream even carrying full redundancy', () => {
    /**
     * Inputs are resent so a dropped one costs nothing, which is the single
     * biggest smoothness win available on a lossy link. The budget for that is
     * derived, not guessed: worst case is the largest input plus MAX_PRIOR
     * copies, at the tick rate, upstream from ONE client.
     *
     * 34 bytes x 30 Hz is under a kilobyte per second — trivial upstream, and
     * not the direction that is under pressure anyway. The server's DOWNstream
     * to six clients is the budget ADR-013 actually constrains, and this does
     * not touch it.
     */
    const prior = Array.from({ length: MAX_PRIOR_INPUTS }, (_, i) => ({
      tick: 100000 - (i + 1),
      moveX: -1,
      moveY: 1,
      yaw: 1023,
      pitch: 1023,
      buttons: 0xffff,
    }));
    const bytes = encodeMessage({
      kind: 'Input',
      tick: 100000,
      moveX: 1,
      moveY: 1,
      yaw: 1023,
      pitch: 1023,
      buttons: 0xffff,
      prior,
    });
    expect(bytes.length).toBeLessThanOrEqual(34);
    expect(bytes.length * 30).toBeLessThan(1024);
  });

  it('round-trips the resent inputs, ticks included', () => {
    const prior = [
      { tick: 41, moveX: -1, moveY: 0, yaw: 100, pitch: 200, buttons: 0b101 },
      { tick: 40, moveX: 0, moveY: 1, yaw: 900, pitch: 50, buttons: 0b010 },
    ];
    const decoded = decodeMessage(
      encodeMessage({ kind: 'Input', tick: 42, moveX: 1, moveY: -1, yaw: 512, pitch: 256, buttons: 0b001, prior }),
    );
    expect(decoded.kind).toBe('Input');
    const got = (decoded as Extract<Message, { kind: 'Input' }>).prior ?? [];
    expect(got.map((f) => f.tick)).toEqual([41, 40]);
    expect(got[0]?.yaw).toBe(100);
    expect(got[1]?.buttons).toBe(0b010);
  });
});

describe('handshake version checking', () => {
  it('accepts a matching version', () => {
    expect(checkHandshake({ kind: 'Join', version: PROTOCOL_VERSION, name: 'ok', room: '' })).toEqual({ ok: true });
  });

  // Version skew must be caught HERE. A mismatched client that gets through
  // misreads every subsequent snapshot as corrupt state rather than failing.
  it('rejects a mismatched version with a reason naming both sides', () => {
    const r = checkHandshake({ kind: 'Join', version: PROTOCOL_VERSION + 1, name: 'old', room: '' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.code).toBe('bad version');
    expect(r.reason).toMatch(/version mismatch/);
    expect(r.reason).toContain(String(PROTOCOL_VERSION));
  });

  it('rejects a non-Join opener', () => {
    const r = checkHandshake({ kind: 'Ack', tick: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toMatch(/expected Join/);
  });

  it('rejects empty and over-long names', () => {
    expect(checkHandshake({ kind: 'Join', version: PROTOCOL_VERSION, name: '', room: '' }).ok).toBe(false);
    expect(
      checkHandshake({ kind: 'Join', version: PROTOCOL_VERSION, name: 'x'.repeat(33), room: '' }).ok,
    ).toBe(false);
  });
});

describe('malformed input', () => {
  it('rejects an empty buffer', () => {
    expect(() => decodeMessage(new Uint8Array(0))).toThrow(ProtocolError);
  });

  it('has no unknown message type left to send: every four-bit tag is spoken for (T-3.09)', () => {
    // 15 was the last free tag and is the AI debug family now, so what the
    // old test sent as "unknown" is a request to stop reports: harmless.
    expect(new Set(Object.values(MessageType)).size).toBe(16);
    expect(decodeMessage(new Uint8Array([0x0f]))).toEqual({ kind: 'AiDebugRequest', on: false });
    // A report cut short is refused, not half-read.
    const report = encodeMessage({ kind: 'AiDebug', tick: 91233, brains: [] });
    expect(() => decodeMessage(report.slice(0, 1))).toThrow(ProtocolError);
  });

  it('rejects a truncated message rather than returning partial data', () => {
    const full = encodeMessage({ kind: 'Disconnect', code: 'other', reason: 'a fairly long reason string' });
    expect(() => decodeMessage(full.slice(0, 2))).toThrow(ProtocolError);
  });

  it('wraps low-level corruption as ProtocolError, not a raw RangeError', () => {
    const full = encodeMessage(SAMPLES.find((m) => m.kind === 'Snapshot') as Message);
    try {
      decodeMessage(full.slice(0, 3));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ProtocolError);
      expect((e as Error).message).toMatch(/malformed message/);
    }
  });

  it('never returns a message for random bytes without throwing', () => {
    let survived = 0;
    for (let seed = 0; seed < 500; seed++) {
      const bytes = new Uint8Array(6);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (seed * 37 + i * 91) & 0xff;
      try {
        decodeMessage(bytes);
        survived++;
      } catch (e) {
        expect(e).toBeInstanceOf(ProtocolError);
      }
    }
    // Some random bytes are legal messages; the point is that nothing escapes
    // as a non-ProtocolError exception.
    expect(survived).toBeGreaterThanOrEqual(0);
  });
});

describe('timestamps on the wire', () => {
  it('accepts the float clocks every real caller actually has', () => {
    /**
     * `performance.now()` and the injected server clock are both floats, and a
     * varuint is not. Rounding lives in the encoder because the alternative is
     * every call site remembering — and the one that forgot (ServerConnection
     * answering a Ping) threw mid-encode, inside the client's frame loop,
     * killing the whole render loop rather than just that message.
     */
    for (const msg of [
      { kind: 'Ping' as const, id: 3, clientTime: 2020.4000000001397 },
      { kind: 'Pong' as const, id: 3, clientTime: 1.5, serverTime: 8391.7238 },
      { kind: 'Fire' as const, tick: 9, yaw: 100, pitch: 200, renderTimeMs: 512.25, weapon: 0, ads: false },
    ]) {
      expect(() => encodeMessage(msg)).not.toThrow();
      expect(decodeMessage(encodeMessage(msg)).kind).toBe(msg.kind);
    }
  });

  it('floors a negative or non-finite timestamp rather than throwing', () => {
    const decoded = decodeMessage(encodeMessage({ kind: 'Ping', id: 1, clientTime: -5 }));
    expect((decoded as Extract<Message, { kind: 'Ping' }>).clientTime).toBe(0);
    expect(() => encodeMessage({ kind: 'Ping', id: 1, clientTime: NaN })).not.toThrow();
  });
});

describe('typed rejections and room codes (T-1.5.04)', () => {
  it('round-trips every disconnect code distinguishably', () => {
    const seen = new Set<DisconnectCode>();
    for (const code of DISCONNECT_CODES) {
      const got = decodeMessage(encodeMessage({ kind: 'Disconnect', code, reason: 'why' }));
      if (got.kind !== 'Disconnect') throw new Error('wrong kind');
      expect(got.code).toBe(code);
      seen.add(got.code);
    }
    expect(seen.size).toBe(DISCONNECT_CODES.length);
  });

  it('rejects a v5 client on version, not on room', () => {
    /**
     * A v5 Join is `type, version, name` and nothing else. Decoding it with
     * v6's layout would over-read looking for the room string and report a
     * protocol error — which a stale client would show as "protocol error"
     * instead of "your build is too old". The version byte is the one field
     * every version shares, so decoding stops there.
     */
    const w = new BitWriter();
    w.writeBits(0, 4); // MessageType.Join
    w.writeBits(5, 8);
    w.writeString('stale-build');
    const msg = decodeMessage(w.toUint8Array());
    expect(msg).toMatchObject({ kind: 'Join', version: 5 });
    const result = checkHandshake(msg);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('bad version');
  });

  it('accepts an empty room (create) and a well-formed code, and refuses the rest', () => {
    const join = (room: string): Message => ({ kind: 'Join', version: PROTOCOL_VERSION, name: 'x', room });
    expect(checkHandshake(join('')).ok).toBe(true);
    expect(checkHandshake(join('K7PM')).ok).toBe(true);
    const bad = checkHandshake(join('hello'));
    expect(bad).toMatchObject({ ok: false, code: 'no such room' });
  });

  it('refuses an oversized join key as a bad key, not a protocol error', () => {
    const join = (key: string): Message => ({ kind: 'Join', version: PROTOCOL_VERSION, name: 'x', room: '', key });
    expect(checkHandshake(join('k'.repeat(128))).ok).toBe(true);
    expect(checkHandshake(join('k'.repeat(129)))).toMatchObject({ ok: false, code: 'bad key' });
  });

  it('generates codes only from the voice-safe alphabet', () => {
    let n = 0;
    const unit = () => ((n += 7919) % 1000) / 1000;
    for (let i = 0; i < 500; i++) {
      const code = generateRoomCode(unit);
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(isRoomCode(code)).toBe(true);
    }
    for (const confusable of 'IO01S5B8Z2') expect(ROOM_CODE_ALPHABET).not.toContain(confusable);
  });

  it('normalises what a person types, and only that', () => {
    expect(normalizeRoomCode(' k7-pm ')).toBe('K7PM');
    expect(normalizeRoomCode('k7 pm')).toBe('K7PM');
    expect(isRoomCode(normalizeRoomCode('k7pm'))).toBe(true);
    // Confusables are refused rather than guessed at.
    expect(isRoomCode(normalizeRoomCode('O7PM'))).toBe(false);
    expect(isRoomCode('K7P')).toBe(false);
  });
});

describe('AiDebug (T-3.09)', () => {
  const brain: AiDebugBrain = {
    netId: 4,
    position: { x: 12.5, y: 0, z: -3.25 },
    tree: ['root selector', 'root.children[1] sequence', 'root.children[1].children[0] action:move-to'],
    intent: { x: 20, y: 0.25, z: -8.5, pace: 'sprint' },
    corridor: [
      { x: 12.5, y: 0.25, z: -3.25 },
      { x: 16, y: 0.25, z: -5 },
      { x: 20, y: 0.25, z: -8.5 },
    ],
    cones: [{ yaw: 300, halfAngle: 64, range: 45.5 }],
    targets: [{ netId: 2, x: -1, y: 0, z: 30 }],
    cover: { x: 18.75, y: 0, z: -7 },
  };
  const idle: AiDebugBrain = {
    netId: 6,
    position: { x: -4, y: 0, z: 0 },
    tree: ['root action:idle'],
    intent: null,
    corridor: [],
    cones: [],
    targets: [],
    cover: null,
  };

  it.each<Message>([
    { kind: 'AiDebugRequest', on: true },
    { kind: 'AiDebugRequest', on: false },
    { kind: 'AiDebug', tick: 0, brains: [] },
    { kind: 'AiDebug', tick: 91233, brains: [brain, idle] },
  ])('round-trips %o', (msg) => {
    expect(decodeMessage(encodeMessage(msg))).toEqual(msg);
  });

  it('round-trips every pace', () => {
    for (const pace of AI_DEBUG_PACES) {
      const msg: Message = { kind: 'AiDebug', tick: 3, brains: [{ ...brain, intent: { ...brain.intent!, pace } }] };
      expect(decodeMessage(encodeMessage(msg))).toEqual(msg);
    }
  });

  it('caps its lists on write and refuses a count past the cap on read', () => {
    const long: Message = {
      kind: 'AiDebug',
      tick: 1,
      brains: [{ ...brain, corridor: Array.from({ length: AI_DEBUG_LIMITS.corridor + 10 }, (_, i) => ({ x: i, y: 0, z: 0 })) }],
    };
    const got = decodeMessage(encodeMessage(long));
    expect(got.kind === 'AiDebug' && got.brains[0]!.corridor.length).toBe(AI_DEBUG_LIMITS.corridor);

    const w = new BitWriter();
    w.writeBits(MessageType.Ext, 4);
    w.writeBits(1, 3); // the AI debug report
    w.writeVarUint(1);
    w.writeVarUint(AI_DEBUG_LIMITS.brains + 1);
    expect(() => decodeMessage(w.toUint8Array())).toThrow(ProtocolError);
  });

  it('a whole squad of walking brains stays a small debug message', () => {
    const bytes = encodeMessage({ kind: 'AiDebug', tick: 9000, brains: Array.from({ length: 5 }, () => brain) }).length;
    console.log(`[T-3.09] five brains with a 3-point corridor, a cone, a target and cover: ${bytes} B`);
    expect(bytes).toBeLessThan(1200);
  });
});
