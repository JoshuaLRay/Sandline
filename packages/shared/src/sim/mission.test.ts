/**
 * The mission on the wire (T-3.34): state and restart round-trip under the
 * extended tag's mission sub-kind, garbage is refused, and the data parses.
 */
import { describe, expect, it } from 'vitest';
import { BitWriter } from '../net/BitStream.ts';
import { MessageType, ProtocolError, decodeMessage, encodeMessage, type Message } from '../net/protocol.ts';
import RAW_MISSION from '../data/mission.json' with { type: 'json' };
import { MISSION, MISSION_STATES, parseMissionConfig } from './mission.ts';

describe('mission messages (T-3.34)', () => {
  it('round-trips every state, and the restart', () => {
    for (const state of MISSION_STATES) {
      for (const clear of [false, true]) {
        const msg: Message = { kind: 'Mission', state, clear, heldTicks: 450, holdTicks: 900, attempt: 3 };
        expect(decodeMessage(encodeMessage(msg))).toEqual(msg);
      }
    }
    expect(decodeMessage(encodeMessage({ kind: 'MissionRestart' }))).toEqual({ kind: 'MissionRestart' });
  });

  it('refuses a variant nobody sends, a state past the last, and a hold held past itself', () => {
    const mission = (fill: (w: BitWriter) => void) => {
      const w = new BitWriter();
      w.writeBits(MessageType.Ext, 4);
      w.writeBits(6, 3);
      fill(w);
      return w.toUint8Array();
    };
    expect(() => decodeMessage(mission((w) => w.writeBits(2, 2)))).toThrow(ProtocolError);
    expect(() => decodeMessage(mission((w) => w.writeBits(3, 2)))).toThrow(ProtocolError);
    expect(() =>
      decodeMessage(
        mission((w) => {
          w.writeBits(0, 2);
          w.writeBits(3, 2);
          w.writeBool(true);
          w.writeVarUint(0);
          w.writeVarUint(10);
          w.writeVarUint(1);
        }),
      ),
    ).toThrow(/unknown mission state/);
    expect(() =>
      decodeMessage(
        mission((w) => {
          w.writeBits(0, 2);
          w.writeBits(0, 2);
          w.writeBool(true);
          w.writeVarUint(11);
          w.writeVarUint(10);
          w.writeVarUint(1);
        }),
      ),
    ).toThrow(/held past its hold/);
  });
});

describe('mission.json (T-3.34)', () => {
  it('parses, and refuses what cannot mean anything, by name', () => {
    expect(MISSION.holdSeconds).toBeGreaterThan(0);
    expect(MISSION.respawn).toBe(false);
    expect(() => parseMissionConfig({ ...RAW_MISSION, flag: 'red' })).toThrow(/unknown key 'flag'/);
    expect(() => parseMissionConfig({ ...RAW_MISSION, holdSeconds: 0 })).toThrow(/holdSeconds/);
    expect(() => parseMissionConfig({ ...RAW_MISSION, respawn: 'no' })).toThrow(/respawn/);
  });
});
