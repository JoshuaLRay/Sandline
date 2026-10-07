import { describe, expect, it } from 'vitest';
import { BitWriter } from './BitStream.ts';
import { Sfc32 } from '../math/prng.ts';
import { ClientConnection } from './Connection.ts';
import { createLoopbackPair } from './Transport.ts';
import { decodeMessage, encodeMessage, ProtocolError, RESTORE_RESTART_KINDS, type Message, type RestoreChoice } from './protocol.ts';

function raw(mission = 'qalat-road', host = 0, restart = 0): Uint8Array {
  const w = new BitWriter();
  w.writeBits(15, 4); // Ext
  w.writeBits(7, 3); // Events
  w.writeBits(13, 4); // RestoreGate (10–12 reserved for U-133)
  w.writeBool(true);
  w.writeString(mission);
  w.writeBits(host, 3);
  w.writeBits(restart, 2);
  return w.toUint8Array();
}

describe('incompatible restore wire contract (U-143)', () => {
  it('preserves 10,000 seeded variable-length decisions and gate clears (ADR-009)', () => {
    const rng = new Sfc32(143);
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
    for (let i = 0; i < 10_000; i++) {
      let mission = 'm';
      const length = 1 + rng.nextUint32() % 64;
      while (mission.length < length) mission += alphabet[rng.nextUint32() % alphabet.length];
      const message: Message = { kind: 'RestoreGate', choice: i % 7 === 0 ? null : {
        mission, host: rng.nextUint32() % 6, restart: RESTORE_RESTART_KINDS[rng.nextUint32() % RESTORE_RESTART_KINDS.length]!,
      } };
      expect(decodeMessage(encodeMessage(message))).toEqual(message);
    }
  });
  it.each(RESTORE_RESTART_KINDS)('round-trips %s and dispatches to a headless connection', (restart) => {
    const choice: RestoreChoice = { mission: 'qalat-road', host: 5, restart };
    const message: Message = { kind: 'RestoreGate', choice };
    expect(decodeMessage(encodeMessage(message))).toEqual(message);
    const pair = createLoopbackPair();
    const heard: Message[] = [];
    new ClientConnection(pair.b, { onRestoreGate: (gate) => heard.push(gate) });
    pair.a.send(encodeMessage(message));
    pair.a.send(encodeMessage({ kind: 'RestoreGate', choice: null }));
    pair.settle();
    expect(heard).toEqual([message, { kind: 'RestoreGate', choice: null }]);
  });

  it.each(['', '../qalat', 'x'.repeat(65)])('refuses malformed mission %s on encode and decode', (mission) => {
    expect(() => encodeMessage({ kind: 'RestoreGate', choice: { mission, host: 0, restart: 'original' } })).toThrow(ProtocolError);
    expect(() => decodeMessage(raw(mission))).toThrow(ProtocolError);
  });

  it.each([-1, 6, 1.5])('does not mask invalid host %s into a valid slot', (host) => {
    expect(() => encodeMessage({ kind: 'RestoreGate', choice: { mission: 'qalat-road', host, restart: 'legacy' } })).toThrow(ProtocolError);
  });

  it('refuses unused restart/host codes and truncated packets', () => {
    expect(() => decodeMessage(raw('qalat-road', 6))).toThrow(ProtocolError);
    expect(() => decodeMessage(raw('qalat-road', 0, 3))).toThrow(ProtocolError);
    expect(() => encodeMessage({ kind: 'RestoreGate', choice: { mission: 'qalat-road', host: 0, restart: 'unknown' as RestoreChoice['restart'] } })).toThrow(ProtocolError);
    const bytes = raw();
    for (let length = 0; length < bytes.length; length++) expect(() => decodeMessage(bytes.slice(0, length))).toThrow();
  });
});
