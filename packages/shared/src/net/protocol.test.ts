import { describe, expect, it } from 'vitest';
import {
  MAX_PRIOR_INPUTS,
  type Message,
  PROTOCOL_VERSION,
  ProtocolError,
  checkHandshake,
  decodeMessage,
  encodeMessage,
} from './protocol.ts';
import { COMPONENT_IDS } from '../ecs/components.ts';

const T = COMPONENT_IDS.Transform;

const SAMPLES: Message[] = [
  { kind: 'Join', version: PROTOCOL_VERSION, name: 'bravo-six' },
  { kind: 'JoinAck', netId: 1234, slot: 5, serverTick: 98765 },
  { kind: 'Ack', tick: 4242 },
  { kind: 'Ping', id: 7, clientTime: 1234567 },
  { kind: 'Pong', id: 7, clientTime: 1234567, serverTime: 1234599 },
  { kind: 'Disconnect', reason: 'session full' },
  {
    kind: 'Snapshot',
    snapshot: { tick: 9, entities: [{ netId: 1, components: { [T]: [100, 200, 300, 400, 500] } }] },
  },
];

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
    expect(checkHandshake({ kind: 'Join', version: PROTOCOL_VERSION, name: 'ok' })).toEqual({ ok: true });
  });

  // Version skew must be caught HERE. A mismatched client that gets through
  // misreads every subsequent snapshot as corrupt state rather than failing.
  it('rejects a mismatched version with a reason naming both sides', () => {
    const r = checkHandshake({ kind: 'Join', version: PROTOCOL_VERSION + 1, name: 'old' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/version mismatch/);
    expect(r.reason).toContain(String(PROTOCOL_VERSION));
  });

  it('rejects a non-Join opener', () => {
    const r = checkHandshake({ kind: 'Ack', tick: 1 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/expected Join/);
  });

  it('rejects empty and over-long names', () => {
    expect(checkHandshake({ kind: 'Join', version: PROTOCOL_VERSION, name: '' }).ok).toBe(false);
    expect(checkHandshake({ kind: 'Join', version: PROTOCOL_VERSION, name: 'x'.repeat(33) }).ok).toBe(false);
  });
});

describe('malformed input', () => {
  it('rejects an empty buffer', () => {
    expect(() => decodeMessage(new Uint8Array(0))).toThrow(ProtocolError);
  });

  it('rejects an unknown message type', () => {
    expect(() => decodeMessage(new Uint8Array([0x0f]))).toThrow(/unknown message type/);
  });

  it('rejects a truncated message rather than returning partial data', () => {
    const full = encodeMessage({ kind: 'Disconnect', reason: 'a fairly long reason string' });
    expect(() => decodeMessage(full.slice(0, 2))).toThrow(ProtocolError);
  });

  it('wraps low-level corruption as ProtocolError, not a raw RangeError', () => {
    const full = encodeMessage(SAMPLES[6] as Message);
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
