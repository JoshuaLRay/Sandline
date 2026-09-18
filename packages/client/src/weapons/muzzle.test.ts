import { describe, expect, it } from 'vitest';
import { DEFAULT_MUZZLE_RIG, type MuzzleRig, muzzlePosition } from './muzzle.ts';

const RIG: MuzzleRig = { hipRight: 0.3, adsRight: 0.1, hipHeight: 1, adsHeight: 1.5 };

/** right = cross(forward, up), the definition the whole project agrees on. */
function rightOf(forwardX: number, forwardZ: number): { x: number; z: number } {
  return { x: -forwardZ, z: forwardX };
}

describe('muzzle placement', () => {
  it('sits on the character right, for every facing', () => {
    // Asserted against the cross product rather than a fixed axis: a change of
    // forward convention must not silently flip which hip fires.
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = (deg * Math.PI) / 180;
      const fx = Math.sin(rad);
      const fz = Math.cos(rad);
      const m = muzzlePosition(0, 0, 0, fx, fz, false, RIG);
      const right = rightOf(fx, fz);
      expect(m.x).toBeCloseTo(right.x * RIG.hipRight, 10);
      expect(m.z).toBeCloseTo(right.z * RIG.hipRight, 10);
    }
  });

  it('is on the same side as the camera shoulder offset', () => {
    // The reported bug in one assertion: muzzle and camera must agree on which
    // side "right" is, or the shot appears to come from the wrong hip.
    const fx = 0;
    const fz = 1;
    const shoulderX = -fz * 0.85; // exactly what main.ts computes for the camera
    const m = muzzlePosition(0, 0, 0, fx, fz, false, RIG);
    expect(Math.sign(m.x)).toBe(Math.sign(shoulderX));
  });

  it('is never on the centre line while hip firing', () => {
    const m = muzzlePosition(0, 0, 0, 0, 1, false, RIG);
    expect(Math.abs(m.x) + Math.abs(m.z)).toBeGreaterThan(0.1);
  });

  it('comes up and in when aiming', () => {
    const hip = muzzlePosition(0, 0, 0, 0, 1, false, RIG);
    const ads = muzzlePosition(0, 0, 0, 0, 1, true, RIG);
    expect(ads.y).toBeGreaterThan(hip.y);
    expect(Math.abs(ads.x)).toBeLessThan(Math.abs(hip.x));
    // Still on the same side, just closer in.
    expect(Math.sign(ads.x)).toBe(Math.sign(hip.x));
  });

  it('follows the character rather than the world', () => {
    const at = muzzlePosition(10, 2, -4, 0, 1, false, RIG);
    expect(at.x).toBeCloseTo(10 - RIG.hipRight, 10);
    expect(at.y).toBeCloseTo(2 + RIG.hipHeight, 10);
    expect(at.z).toBeCloseTo(-4, 10);
  });

  it('ships a rig whose hip is below its aimed height', () => {
    expect(DEFAULT_MUZZLE_RIG.hipHeight).toBeLessThan(DEFAULT_MUZZLE_RIG.adsHeight);
    expect(DEFAULT_MUZZLE_RIG.adsRight).toBeLessThan(DEFAULT_MUZZLE_RIG.hipRight);
  });
});
