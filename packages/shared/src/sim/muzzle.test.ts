import { describe, expect, it } from 'vitest';
import { ANGLE_UNITS } from '../math/angles.ts';
import { cos, sin } from '../math/trig.ts';
import { DEFAULT_MUZZLE_RIG, type MuzzleRig, eyePosition, muzzlePosition } from './muzzle.ts';

const RIG: MuzzleRig = {
  shoulderRight: 0.3,
  shoulderHeight: 1.4,
  hipRight: 0.2,
  hipHeight: 1,
  eyeHeight: 1.6,
  proneEyeHeight: 0.35,
};

/** right = cross(forward, up), the definition the whole project agrees on. */
function rightOf(forwardX: number, forwardZ: number): { x: number; z: number } {
  return { x: -forwardZ, z: forwardX };
}

describe('trace origin', () => {
  it('is the centre line at eye height', () => {
    expect(eyePosition(4, 2, -7, RIG)).toEqual({ x: 4, y: 2 + RIG.eyeHeight, z: -7 });
  });

  it('is the same point whatever the stance, so the view mode is not an advantage', () => {
    // The property that matters: only the AIMED stance coincides with the trace
    // origin; the other two are visually offset while the ray they represent
    // starts in the identical place. If a stance ever moved this, first and
    // third person would hit different things from the same aim.
    const trace = eyePosition(1, 0, 2, RIG);
    for (let a = 0; a < ANGLE_UNITS; a += 256) {
      const fx = sin(a);
      const fz = cos(a);
      expect(muzzlePosition(1, 0, 2, fx, fz, 'ads', RIG)).toEqual(trace);
      expect(muzzlePosition(1, 0, 2, fx, fz, 'third', RIG)).not.toEqual(trace);
      expect(muzzlePosition(1, 0, 2, fx, fz, 'hip', RIG)).not.toEqual(trace);
    }
  });
});

describe('trace origin while prone (T-2.42)', () => {
  it('drops to the rig\'s prone eye height, and only when prone', () => {
    expect(eyePosition(4, 2, -7, RIG, true)).toEqual({ x: 4, y: 2 + RIG.proneEyeHeight, z: -7 });
    expect(eyePosition(4, 2, -7, RIG, false)).toEqual(eyePosition(4, 2, -7, RIG));
  });

  it('ships a prone eye inside the prone hit volume, well below standing eye height', () => {
    // The 0.8 m prone capsule (DEFAULT_HITBOX / MoveConfig.proneHeight): a
    // trace origin above it would let a body hidden behind cover fire over it.
    expect(DEFAULT_MUZZLE_RIG.proneEyeHeight).toBeGreaterThan(0);
    expect(DEFAULT_MUZZLE_RIG.proneEyeHeight).toBeLessThan(0.8);
    expect(DEFAULT_MUZZLE_RIG.proneEyeHeight).toBeLessThan(DEFAULT_MUZZLE_RIG.hipHeight);
  });
});

describe('visual muzzle by stance', () => {
  it('third person fires from the right shoulder, for every facing', () => {
    for (let a = 0; a < ANGLE_UNITS; a += 64) {
      const fx = sin(a);
      const fz = cos(a);
      const m = muzzlePosition(0, 0, 0, fx, fz, 'third', RIG);
      const right = rightOf(fx, fz);
      expect(m.x).toBeCloseTo(right.x * RIG.shoulderRight, 10);
      expect(m.z).toBeCloseTo(right.z * RIG.shoulderRight, 10);
      expect(m.y).toBeCloseTo(RIG.shoulderHeight, 10);
    }
  });

  it('first-person hip fires from the right hip, lower and closer in', () => {
    const shoulder = muzzlePosition(0, 0, 0, 0, 1, 'third', RIG);
    const hip = muzzlePosition(0, 0, 0, 0, 1, 'hip', RIG);
    expect(hip.y).toBeLessThan(shoulder.y);
    expect(Math.abs(hip.x)).toBeLessThan(Math.abs(shoulder.x));
    // Still the same side — a hip is not a different handedness.
    expect(Math.sign(hip.x)).toBe(Math.sign(shoulder.x));
  });

  it('aiming down sights fires from dead centre at eye height', () => {
    // The whole point of the reported bug: aimed, the muzzle IS the middle of
    // the screen, so there is no lateral offset left at all.
    for (let a = 0; a < ANGLE_UNITS; a += 256) {
      const m = muzzlePosition(3, 1, -2, sin(a), cos(a), 'ads', RIG);
      expect(m.x).toBe(3);
      expect(m.z).toBe(-2);
      expect(m.y).toBeCloseTo(1 + RIG.eyeHeight, 10);
    }
  });

  it('puts the aimed muzzle exactly on the trace origin', () => {
    const m = muzzlePosition(3, 1, -2, 0, 1, 'ads', RIG);
    expect(m).toEqual(eyePosition(3, 1, -2, RIG));
  });

  it('agrees with the camera shoulder offset on which side is right', () => {
    const fx = 0;
    const fz = 1;
    const shoulderX = -fz * 0.85; // exactly what main.ts computes for the camera
    const m = muzzlePosition(0, 0, 0, fx, fz, 'third', RIG);
    expect(Math.sign(m.x)).toBe(Math.sign(shoulderX));
  });

  it('follows the character rather than the world', () => {
    const at = muzzlePosition(10, 2, -4, 0, 1, 'hip', RIG);
    expect(at.x).toBeCloseTo(10 - RIG.hipRight, 10);
    expect(at.y).toBeCloseTo(2 + RIG.hipHeight, 10);
    expect(at.z).toBeCloseTo(-4, 10);
  });

  it('ships a rig whose shoulder is above its hip and below the eye', () => {
    expect(DEFAULT_MUZZLE_RIG.hipHeight).toBeLessThan(DEFAULT_MUZZLE_RIG.shoulderHeight);
    expect(DEFAULT_MUZZLE_RIG.shoulderHeight).toBeLessThan(DEFAULT_MUZZLE_RIG.eyeHeight);
  });
});
