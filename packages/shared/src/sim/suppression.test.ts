import { describe, expect, it } from 'vitest';
import {
  type SuppressionConfig,
  SUPPRESSION,
  SUPPRESSION_BITS,
  blastSuppression,
  capsuleGap,
  createSuppression,
  isNearMiss,
  parseSuppressionConfig,
  passCapsule,
  raiseSuppression,
  suppressionConeUnits,
  suppressionFromWire,
  suppressionLevel,
  suppressionToWire,
} from './suppression.ts';
import { createWeaponState, currentConeUnits, degToAngle, getWeapon, tryFire } from './weapons.ts';

/** Our own numbers, so retuning suppression.json never changes what these prove. */
const RAW = {
  nearMissM: 1,
  nearMiss: 0.3,
  impactRadiusM: 2,
  impact: 0.1,
  blastRadiusM: 8,
  blast: 0.8,
  holdSeconds: 1,
  decayPerSec: 0.5,
  coneDeg: 2,
};
const C: SuppressionConfig = parseSuppressionConfig(RAW);

/** A standing soldier's capsule at the origin: axis y 0.35..1.45, radius 0.35. */
const SOLDIER = { centre: { x: 0, y: 0.9, z: 0 }, halfHeight: 0.55, radius: 0.35 };

/** A round flying along +Z at chest height, `offsetX` to the side of the axis. */
function pastAt(offsetX: number, y = 1.2) {
  return passCapsule({ x: offsetX, y, z: -50 }, { x: 0, y: 0, z: 1 }, 100, SOLDIER);
}

describe('suppression data (T-3.16)', () => {
  it('parses a full row and the committed data', () => {
    expect(C).toEqual(RAW);
    expect(SUPPRESSION.nearMissM).toBeGreaterThan(0);
  });

  it.each([
    ['an unknown key', { ...RAW, fear: 1 }, /fear/],
    ['a missing number', { ...RAW, nearMiss: undefined }, /nearMiss/],
    ['a raise past 1', { ...RAW, blast: 2 }, /blast/],
    ['a level that never falls', { ...RAW, decayPerSec: 0 }, /decayPerSec/],
    ['a zero blast radius', { ...RAW, blastRadiusM: 0 }, /blastRadiusM/],
  ])('refuses %s', (_label, raw, message) => {
    expect(() => parseSuppressionConfig(raw)).toThrow(message);
  });
});

describe('the near miss against a capsule (T-3.16)', () => {
  it('a miss by 0.4 m counts, one by 3 m does not', () => {
    const close = pastAt(SOLDIER.radius + 0.4);
    expect(close.gap).toBeCloseTo(0.4, 9);
    expect(isNearMiss(close.gap, C)).toBe(true);
    const far = pastAt(SOLDIER.radius + 3);
    expect(far.gap).toBeCloseTo(3, 9);
    expect(isNearMiss(far.gap, C)).toBe(false);
  });

  it('a hit is not a near miss', () => {
    expect(pastAt(0).gap).toBeLessThan(0);
    expect(isNearMiss(pastAt(0).gap, C)).toBe(false);
    // A graze of the surface is a touch, still not a miss.
    expect(isNearMiss(pastAt(SOLDIER.radius).gap, C)).toBe(false);
  });

  it('measures to the cap over the head, and to the end of a round that stopped short', () => {
    // Level, 0.4 m over the top of the head: the gap is to the top cap.
    const over = pastAt(0, 1.45 + 0.35 + 0.4);
    expect(over.gap).toBeCloseTo(0.4, 9);
    // A round that hit a wall 5 m short never came near.
    const short = passCapsule({ x: 0.75, y: 1.2, z: -50 }, { x: 0, y: 0, z: 1 }, 45, SOLDIER);
    expect(short.gap).toBeCloseTo(Math.sqrt(0.75 * 0.75 + 5 * 5) - 0.35, 9);
    expect(isNearMiss(short.gap, C)).toBe(false);
  });

  it('measures a point against the surface', () => {
    expect(capsuleGap({ x: 1.35, y: 0.9, z: 0 }, SOLDIER)).toBeCloseTo(1, 12);
    expect(capsuleGap({ x: 0, y: 1.45 + 0.35 + 2, z: 0 }, SOLDIER)).toBeCloseTo(2, 12);
    expect(capsuleGap({ x: 0.1, y: 0.9, z: 0 }, SOLDIER)).toBeLessThan(0);
  });

  it('works for a slanted round, and says where on the path it was closest', () => {
    const d = { x: 0, y: -0.6, z: 0.8 };
    const pass = passCapsule({ x: 0.6, y: 1.2 + 0.6 * 12.5, z: -10 }, d, 30, SOLDIER);
    // It crosses z = 0 at y = 1.2, on the cylinder's height, 0.6 m to the side.
    expect(pass.gap).toBeCloseTo(0.25, 6);
    expect(pass.at.x).toBeCloseTo(0.6, 9);
  });
});

describe('the level (T-3.16)', () => {
  it('rises per near miss and saturates at 1', () => {
    const s = createSuppression();
    raiseSuppression(s, C.nearMiss, 0, C);
    expect(suppressionLevel(s, 0, C)).toBeCloseTo(0.3, 12);
    raiseSuppression(s, C.nearMiss, 0.1, C);
    expect(suppressionLevel(s, 0.1, C)).toBeCloseTo(0.6, 12);
    for (let i = 0; i < 10; i++) raiseSuppression(s, C.nearMiss, 0.2, C);
    expect(suppressionLevel(s, 0.2, C)).toBe(1);
  });

  it('holds, then decays on its line to zero, and a raise restarts the hold', () => {
    const s = createSuppression();
    raiseSuppression(s, 0.8, 10, C);
    expect(suppressionLevel(s, 10.5, C)).toBeCloseTo(0.8, 12);
    expect(suppressionLevel(s, 11, C)).toBeCloseTo(0.8, 12);
    expect(suppressionLevel(s, 11.5, C)).toBeCloseTo(0.55, 12);
    expect(suppressionLevel(s, 12, C)).toBeCloseTo(0.3, 12);
    expect(suppressionLevel(s, 12.6, C)).toBeCloseTo(0, 12);
    expect(suppressionLevel(s, 12.7, C)).toBe(0);
    expect(suppressionLevel(s, 100, C)).toBe(0);
    // Mid-decay: the new raise is on top of what is left, and holds again.
    raiseSuppression(s, 0.1, 11.5, C);
    expect(suppressionLevel(s, 12.5, C)).toBeCloseTo(0.65, 12);
  });

  it('a blast adds its full amount at the feet, less with distance, nothing at the radius', () => {
    expect(blastSuppression(0, C)).toBeCloseTo(0.8, 12);
    expect(blastSuppression(4, C)).toBeCloseTo(0.4, 12);
    expect(blastSuppression(8, C)).toBe(0);
    expect(blastSuppression(20, C)).toBe(0);
  });
});

describe('suppression on the wire and on the cone (T-3.16)', () => {
  it('fits its bits and round-trips to the step', () => {
    const top = (1 << SUPPRESSION_BITS) - 1;
    expect(suppressionToWire(0)).toBe(0);
    expect(suppressionToWire(1)).toBe(top);
    expect(suppressionToWire(2)).toBe(top);
    expect(suppressionToWire(-1)).toBe(0);
    for (let w = 0; w <= top; w++) expect(suppressionToWire(suppressionFromWire(w))).toBe(w);
    for (const level of [0.1, 0.33, 0.5, 0.97]) expect(Math.abs(suppressionFromWire(suppressionToWire(level)) - level)).toBeLessThanOrEqual(0.5 / top);
  });

  it("widens a weapon's cone by exactly the data's amount, past the gun's own ceiling", () => {
    const carbine = getWeapon('carbine');
    const state = createWeaponState(carbine);
    const extra = suppressionConeUnits(1, C);
    expect(extra).toBe(degToAngle(C.coneDeg));
    expect(suppressionConeUnits(0, C)).toBe(0);
    expect(currentConeUnits(carbine, state, true, false, extra) - currentConeUnits(carbine, state, true)).toBe(extra);
    // Bloomed to the ceiling, still wider by the same amount.
    state.bloomUnits = degToAngle(50);
    expect(currentConeUnits(carbine, state, false, false, extra)).toBe(degToAngle(carbine.maxSpreadDeg) + extra);
    // And the shot leaves with it.
    const shot = tryFire(carbine, createWeaponState(carbine), 0, true, false, extra);
    expect(shot!.coneUnits).toBe(degToAngle(carbine.adsSpreadDeg) + extra);
  });
});
