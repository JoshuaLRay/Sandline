/**
 * Aim (T-3.15): the cone, the error it samples, the points and the line of
 * sight. The session tests (`session/aiFire.test.ts`) prove the shots; these
 * prove the arithmetic with numbers of their own, so retuning `enemies.json`
 * never changes what they show.
 */
import { describe, expect, it } from 'vitest';
import { ANGLE_UNITS, type EnemyAccuracy, type WorldBox, angleDelta, degToAngle } from '@sandline/shared';
import { aimAngles, aimConeDeg, aimError, aimPoints, aimSeed, lineOfSight, visibleAimPoint } from './aim.ts';
import { DEFAULT_HITBOX } from '../net/lagComp.ts';

const ACCURACY: EnemyAccuracy = {
  baseConeDeg: 1,
  distanceDoublingM: 20,
  speedFactorPerMps: 0.5,
  suppressionFactor: 2,
  acquireFactor: 3,
  settleSeconds: 2,
  maxConeDeg: 12,
  holdBloomDeg: 1,
  burstRounds: 5,
  burstPauseSeconds: 0.4,
  hitBand: { rangeM: 20, min: 0, max: 1 },
};

const STILL = { distanceM: 0, targetSpeedMps: 0, suppression: 0, timeOnTargetSeconds: 10 };

/** A wall across z = 5, 2 m tall, from x = −5 to 5. */
const WALL: WorldBox = { id: 'wall', kind: 'cover', minX: -5, maxX: 5, minY: 0, maxY: 2, minZ: 4.9, maxZ: 5.1 };
/** A low wall across z = 5, 1.2 m tall: over the chest of a soldier behind it, under the head. */
const LOW: WorldBox = { ...WALL, id: 'low', maxY: 1.2 };

describe('aim cone (T-3.15)', () => {
  it('is the base settled, still, unsuppressed and at the muzzle', () => {
    expect(aimConeDeg(ACCURACY, STILL)).toBeCloseTo(1, 12);
  });

  it('widens with distance: another base every doubling distance', () => {
    expect(aimConeDeg(ACCURACY, { ...STILL, distanceM: 20 })).toBeCloseTo(2, 12);
    expect(aimConeDeg(ACCURACY, { ...STILL, distanceM: 40 })).toBeCloseTo(3, 12);
  });

  it("widens with the target's speed and the shooter's suppression", () => {
    expect(aimConeDeg(ACCURACY, { ...STILL, targetSpeedMps: 4 })).toBeCloseTo(3, 12);
    expect(aimConeDeg(ACCURACY, { ...STILL, suppression: 0.5 })).toBeCloseTo(2, 12);
    // Suppression is a level in 0..1: past full it widens no further.
    expect(aimConeDeg(ACCURACY, { ...STILL, suppression: 5 })).toBeCloseTo(3, 12);
  });

  it('narrows with time on target, from the acquire factor to 1 over the settle time', () => {
    const at = (t: number) => aimConeDeg(ACCURACY, { ...STILL, timeOnTargetSeconds: t });
    expect(at(0)).toBeCloseTo(3, 12);
    expect(at(1)).toBeCloseTo(2, 12);
    expect(at(2)).toBeCloseTo(1, 12);
    expect(at(5)).toBeCloseTo(1, 12);
    for (let t = 0; t < 2; t += 0.1) expect(at(t + 0.1)).toBeLessThan(at(t));
  });

  it('never passes the ceiling', () => {
    expect(aimConeDeg(ACCURACY, { distanceM: 200, targetSpeedMps: 6, suppression: 1, timeOnTargetSeconds: 0 })).toBe(12);
  });
});

describe('aim error (T-3.15)', () => {
  it('is nothing for a zero cone', () => {
    expect(aimError(100, 50, 0, 7)).toEqual({ yaw: 100, pitch: 50 });
  });

  it('stays inside the cone, is reproducible from its seed, and fills the disc', () => {
    const cone = degToAngle(3);
    let widest = 0;
    let sum = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const seed = aimSeed(40, 2000, i);
      const e = aimError(1000, 0, 3, seed);
      expect(aimError(1000, 0, 3, seed)).toEqual(e);
      const r = Math.hypot(angleDelta(e.yaw, 1000), angleDelta(e.pitch, 0));
      widest = Math.max(widest, r);
      sum += r;
    }
    // Rounding to whole units is the only way past the edge.
    expect(widest).toBeLessThanOrEqual(cone + 1);
    expect(widest).toBeGreaterThan(cone * 0.95);
    // A uniform disc's mean radius is two thirds of its edge.
    expect(sum / n / cone).toBeCloseTo(2 / 3, 1);
  });

  it('a wider cone spreads the same seeds wider', () => {
    let narrow = 0;
    let wide = 0;
    for (let i = 0; i < 500; i++) {
      const seed = aimSeed(3, 2001, i);
      const a = aimError(0, 0, 1, seed);
      const b = aimError(0, 0, 3, seed);
      narrow += Math.hypot(angleDelta(a.yaw, 0), angleDelta(a.pitch, 0));
      wide += Math.hypot(angleDelta(b.yaw, 0), angleDelta(b.pitch, 0));
    }
    // In the ratio of the cones as whole angle units, which is what is sampled.
    expect(wide / narrow).toBeCloseTo(degToAngle(3) / degToAngle(1), 1);
  });
});

describe('aim line and points (T-3.15)', () => {
  it('points +Z at yaw 0 and a quarter turn to +X, level at pitch 0', () => {
    const eye = { x: 0, y: 1.6, z: 0 };
    expect(aimAngles(eye, { x: 0, y: 1.6, z: 10 })).toEqual({ yaw: 0, pitch: 0 });
    expect(aimAngles(eye, { x: 10, y: 1.6, z: 0 })).toEqual({ yaw: ANGLE_UNITS / 4, pitch: 0 });
    expect(aimAngles(eye, { x: 0, y: 11.6, z: 10 }).pitch).toBe(ANGLE_UNITS / 8);
  });

  it('aims at the centre of the capsule, then the head, for every stance', () => {
    const feet = { x: 1, y: 0, z: 2 };
    const [chest, head] = aimPoints(feet, false, false);
    expect(chest).toEqual({ x: 1, y: DEFAULT_HITBOX.centerOffsetY, z: 2 });
    expect(head!.y).toBeCloseTo(DEFAULT_HITBOX.centerOffsetY + DEFAULT_HITBOX.halfHeight, 12);
    expect(aimPoints(feet, true, false)[0]!.y).toBe(DEFAULT_HITBOX.crouchCenterOffsetY);
    expect(aimPoints(feet, false, true)[0]!.y).toBe(DEFAULT_HITBOX.proneCenterOffsetY);
  });

  it('has no line of sight through a wall, and one past it', () => {
    const eye = { x: 0, y: 1.6, z: 0 };
    expect(lineOfSight(eye, { x: 0, y: 1, z: 10 }, [WALL])).toBe(false);
    expect(lineOfSight(eye, { x: 12, y: 1, z: 10 }, [WALL])).toBe(true);
    expect(lineOfSight(eye, { x: 0, y: 1, z: 4 }, [WALL])).toBe(true);
  });

  it('takes the head over a low wall that hides the chest, and nothing behind a tall one', () => {
    const eye = { x: 0, y: 1.6, z: 0 };
    const points = aimPoints({ x: 0, y: 0, z: 6 }, false, false);
    expect(visibleAimPoint(eye, points, [LOW])).toBe(points[1]);
    expect(visibleAimPoint(eye, points, [WALL])).toBeNull();
    expect(visibleAimPoint(eye, points, [])).toBe(points[0]);
  });
});
