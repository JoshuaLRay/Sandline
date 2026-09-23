import { describe, expect, it } from 'vitest';
import {
  STIMULI,
  STIMULUS_KINDS,
  type Stimulus,
  type StimulusConfig,
  closestApproach,
  hears,
  locatesSource,
  parseStimulusConfig,
  threatens,
} from './stimuli.ts';

/** Our own numbers, so retuning stimuli.json never changes what these prove. */
const RAW = {
  nearMissM: 1,
  kinds: {
    shot: { radiusM: 100, confidence: 0.8 },
    impact: { radiusM: 10, confidence: 0.3 },
    nearMiss: { radiusM: 5, confidence: 0.5 },
    detonation: { radiusM: 80, confidence: 0.3 },
    sprint: { radiusM: 12, confidence: 0.6 },
  },
};
const C: StimulusConfig = parseStimulusConfig(RAW);

const shotAt = (x: number, z: number): Stimulus => ({ kind: 'shot', at: { x, y: 1.6, z }, sourceNetId: 3 });

describe('stimuli (T-3.14)', () => {
  it('parses a full table and the committed one', () => {
    expect(C).toEqual(RAW);
    for (const kind of STIMULUS_KINDS) expect(STIMULI.kinds[kind].radiusM).toBeGreaterThan(0);
    // A shot carries further than the impact it makes, and a near miss is heard close.
    expect(STIMULI.kinds.shot.radiusM).toBeGreaterThan(STIMULI.kinds.impact.radiusM);
  });

  it('refuses malformed tables', () => {
    const bad: unknown[] = [
      null,
      { ...RAW, extra: 1 },
      { ...RAW, nearMissM: -1 },
      { ...RAW, kinds: { ...RAW.kinds, whisper: { radiusM: 1, confidence: 1 } } },
      { ...RAW, kinds: { ...RAW.kinds, shot: undefined } },
      { ...RAW, kinds: { ...RAW.kinds, shot: { radiusM: 'far', confidence: 1 } } },
      { ...RAW, kinds: { ...RAW.kinds, shot: { radiusM: 10, confidence: 0 } } },
      { ...RAW, kinds: { ...RAW.kinds, shot: { radiusM: 10, confidence: 1, pitch: 3 } } },
    ];
    for (const raw of bad) expect(() => parseStimulusConfig(raw)).toThrow();
  });

  it('a shot is heard inside its radius and not outside, in every direction', () => {
    const ear = { x: 0, y: 1.6, z: 0 };
    for (const [dx, dz] of [
      [1, 0],
      [0, 1],
      [-0.6, 0.8],
      [0.8, -0.6],
    ] as const) {
      expect(hears(ear, shotAt(dx * 99.9, dz * 99.9), C)).toBe(true);
      expect(hears(ear, shotAt(dx * 100, dz * 100), C)).toBe(true);
      expect(hears(ear, shotAt(dx * 100.1, dz * 100.1), C)).toBe(false);
      expect(hears(ear, shotAt(dx * 300, dz * 300), C)).toBe(false);
    }
  });

  it('each kind carries its own distance', () => {
    const ear = { x: 0, y: 0, z: 0 };
    for (const kind of STIMULUS_KINDS) {
      const r = C.kinds[kind].radiusM;
      expect(hears(ear, { kind, at: { x: r - 0.01, y: 0, z: 0 }, sourceNetId: 1 }, C)).toBe(true);
      expect(hears(ear, { kind, at: { x: r + 0.01, y: 0, z: 0 }, sourceNetId: 1 }, C)).toBe(false);
    }
  });

  it('shots and sprints locate their source; impacts, near misses and blasts threaten', () => {
    expect(STIMULUS_KINDS.filter(locatesSource)).toEqual(['shot', 'sprint']);
    expect(STIMULUS_KINDS.filter(threatens)).toEqual(['impact', 'nearMiss', 'detonation']);
  });

  it('closest approach of a segment to a point', () => {
    const o = { x: 0, y: 0, z: 0 };
    const d = { x: 0, y: 0, z: 1 };
    const mid = closestApproach(o, d, 10, { x: 0.4, y: 0, z: 5 });
    expect(mid.distance).toBeCloseTo(0.4, 9);
    expect(mid.at).toEqual({ x: 0, y: 0, z: 5 });
    // Behind the origin and past the end, the ends are nearest.
    expect(closestApproach(o, d, 10, { x: 0, y: 3, z: -4 }).distance).toBeCloseTo(5, 9);
    expect(closestApproach(o, d, 10, { x: 0, y: 3, z: 14 }).distance).toBeCloseTo(5, 9);
  });
});
