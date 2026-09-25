/**
 * Missions on the wire and in data (T-3.34; a sequence of objective types
 * since T-4.14): every state and type round-trips under the extended tag's
 * mission sub-kind, garbage is refused, the committed missions parse and
 * hold to their worlds and encounters, and bad files are refused by name.
 */
import { describe, expect, it } from 'vitest';
import { BitWriter } from '../net/BitStream.ts';
import { MessageType, ProtocolError, decodeMessage, encodeMessage, type Message } from '../net/protocol.ts';
import RAW_GREYBOX from '../data/missions/greybox-01.json' with { type: 'json' };
import { encounterFor } from './encounters.ts';
import { MISSION_STATES, OBJECTIVE_TYPES, checkMission, missionFor, missions, parseMission } from './mission.ts';
import { requireWorld } from './world.ts';

describe('mission messages (T-3.34, T-4.14)', () => {
  it('round-trips every state and every objective type, and the restart', () => {
    for (const state of MISSION_STATES) {
      for (const type of OBJECTIVE_TYPES) {
        for (const satisfied of [false, true]) {
          const msg: Message = { kind: 'Mission', state, attempt: 3, objective: 1, objectives: 3, type, label: 'the compound', satisfied, progress: 450, goal: 900 };
          expect(decodeMessage(encodeMessage(msg))).toEqual(msg);
        }
      }
    }
    expect(decodeMessage(encodeMessage({ kind: 'MissionRestart' }))).toEqual({ kind: 'MissionRestart' });
  });

  it('refuses malformed room state, a state or a type past the last, an objective outside the mission, and progress past its goal', () => {
    const mission = (fill: (w: BitWriter) => void) => {
      const w = new BitWriter();
      w.writeBits(MessageType.Ext, 4);
      w.writeBits(6, 3);
      fill(w);
      return w.toUint8Array();
    };
    const state = (o: { state?: number; type?: number; objective?: number; objectives?: number; progress?: number; goal?: number }) =>
      mission((w) => {
        w.writeBits(0, 2);
        w.writeBits(o.state ?? 0, 2);
        w.writeVarUint(1);
        w.writeVarUint(o.objective ?? 0);
        w.writeVarUint(o.objectives ?? 1);
        w.writeBits(o.type ?? 0, 3);
        w.writeString('x');
        w.writeBool(true);
        w.writeVarUint(o.progress ?? 0);
        w.writeVarUint(o.goal ?? 10);
      });
    expect(() => decodeMessage(mission((w) => {
      w.writeBits(2, 2);
      w.writeBool(false);
      w.writeBits(0, 3);
      w.writeString('mission-01');
      w.writeBits(7, 3);
    }))).toThrow(/more than six slots/);
    expect(() => decodeMessage(state({ state: 3 }))).toThrow(/unknown mission state/);
    expect(() => decodeMessage(state({ type: 7 }))).toThrow(/unknown objective type/);
    expect(() => decodeMessage(state({ objective: 3, objectives: 3 }))).toThrow(/out of the mission/);
    expect(() => decodeMessage(state({ progress: 11, goal: 10 }))).toThrow(/past its goal/);
    expect(decodeMessage(state({}))).toMatchObject({ kind: 'Mission', type: 'clear-and-hold' });
  });
});

describe('mission files (T-4.14)', () => {
  it('ships the grey-box mission as T-3.34 left it: one clear-and-hold of the compound, no respawn', () => {
    const m = missionFor('greybox-01')!;
    expect(m.respawn).toBe(false);
    expect(m.objectives).toEqual([{ type: 'clear-and-hold', label: 'the compound', area: 'objective', holdSeconds: 30 }]);
    for (const mission of missions()) checkMission(mission, encounterFor(mission.world)!, requireWorld(mission.world));
  });

  it('parses every type with its own parameters, and refuses what cannot mean anything, by name', () => {
    const base = RAW_GREYBOX as Record<string, unknown>;
    const all = parseMission({
      ...base,
      objectives: [
        { type: 'reach', label: 'the ford', area: { x: 1, z: 2, radius: 3 }, who: 'any' },
        { type: 'destroy', label: 'the garrison', group: 'garrison' },
        { type: 'defend', label: 'the compound', area: 'objective', seconds: 60, breachSeconds: 5 },
        { type: 'survive', label: 'the night', seconds: 90 },
      ],
    });
    expect(all.objectives.map((o) => o.type)).toEqual(['reach', 'destroy', 'defend', 'survive']);
    const one = (o: unknown) => ({ ...base, objectives: [o] });
    expect(parseMission({ ...base, failure: { timeLimitSeconds: 120 } }).failure).toEqual({ timeLimitSeconds: 120 });
    expect(parseMission({ ...base, failure: { protectedGroup: 'garrison' } }).failure).toEqual({ protectedGroup: 'garrison' });
    expect(() => parseMission({ ...base, failure: {} })).toThrow(/must set timeLimitSeconds or protectedGroup/);
    expect(() => parseMission({ ...base, failure: { timeLimitSeconds: 0 } })).toThrow(/timeLimitSeconds/);
    expect(() => parseMission({ ...base, failure: { protectedGroup: '' } })).toThrow(/protectedGroup/);
    expect(() => parseMission({ ...base, flag: 'red' })).toThrow(/unknown key 'flag'/);
    expect(() => parseMission({ ...base, objectives: [] })).toThrow(/1–16 objectives/);
    expect(() => parseMission(one({ type: 'escort', label: 'x' }))).toThrow(/type must be one of/);
    expect(() => parseMission(one({ type: 'survive', label: 'x', seconds: 0 }))).toThrow(/seconds/);
    expect(() => parseMission(one({ type: 'survive', label: 'x', seconds: 5, area: 'objective' }))).toThrow(/unknown key 'area'/);
    expect(() => parseMission(one({ type: 'reach', label: 'x', area: 'objective', who: 'most' }))).toThrow(/who must be all or any/);
    expect(() => parseMission(one({ type: 'reach', label: 'x', area: { x: 0, z: 0, radius: -1 }, who: 'any' }))).toThrow(/radius must be positive/);
    expect(() => parseMission(one({ type: 'defend', label: 'x', area: 'objective', seconds: 5 }))).toThrow(/missing 'breachSeconds'/);
    expect(() => parseMission(one({ type: 'survive', label: '', seconds: 5 }))).toThrow(/label/);
    expect(() => parseMission({ ...base, respawn: 'no' })).toThrow(/respawn/);
  });

  it('holds a mission to its world and encounter', () => {
    const world = requireWorld('greybox-01');
    const encounter = encounterFor('greybox-01')!;
    const bad = (o: unknown) => parseMission({ ...(RAW_GREYBOX as object), objectives: [o] });
    expect(() => checkMission(bad({ type: 'reach', label: 'x', area: 'assault-entry', who: 'all' }), encounter, world)).not.toThrow();
    expect(() => checkMission(bad({ type: 'reach', label: 'x', area: 'moon', who: 'all' }), encounter, world)).toThrow(/no place 'moon'/);
    expect(() => checkMission(bad({ type: 'destroy', label: 'x', group: 'nobody' }), encounter, world)).toThrow(/no encounter group 'nobody'/);
    expect(() => checkMission(parseMission({ ...(RAW_GREYBOX as object), failure: { protectedGroup: 'nobody' } }), encounter, world)).toThrow(/no encounter group 'nobody'/);
    expect(() => checkMission(parseMission({ ...(RAW_GREYBOX as object), failure: { protectedGroup: 'garrison' } }), encounter, world)).toThrow(/must contain exactly one entity/);
    expect(() => checkMission(missionFor('greybox-01')!, encounter, requireWorld('range'))).toThrow(/is for world 'greybox-01'/);
  });
});
