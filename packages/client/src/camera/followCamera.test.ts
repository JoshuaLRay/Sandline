import { describe, expect, it } from 'vitest';
import { type ArmLimits, solveArmLength } from './followCamera.ts';

const LIMITS: ArmLimits = { minCameraY: 0.3, minDistance: 1 };
/** Eye height plus the shoulder lift, i.e. the harness's focus point at spawn. */
const FOCUS_Y = 1.85;

describe('third-person arm length', () => {
  it('leaves the arm alone when the view is level or rising', () => {
    expect(solveArmLength(5.5, FOCUS_Y, 0, LIMITS)).toBe(5.5);
    expect(solveArmLength(5.5, FOCUS_Y, -0.8, LIMITS)).toBe(5.5);
  });

  it('keeps the camera above the floor at every upward pitch', () => {
    // The bug this replaces: the camera went THROUGH the ground looking up.
    // Sweeps to the real limit: pitch up is 89 degrees since the QA request.
    for (let deg = 0; deg <= 89; deg += 1) {
      const dy = Math.sin((deg * Math.PI) / 180);
      const dist = solveArmLength(5.5, FOCUS_Y, dy, LIMITS);
      const cameraY = FOCUS_Y - dy * dist;
      expect(cameraY).toBeGreaterThanOrEqual(LIMITS.minCameraY - 1e-9);
    }
  });

  it('lands the camera exactly on the floor once the arm is the limit', () => {
    const dy = Math.sin((89 * Math.PI) / 180);
    const dist = solveArmLength(5.5, FOCUS_Y, dy, LIMITS);
    expect(dist).toBeLessThan(5.5);
    expect(FOCUS_Y - dy * dist).toBeCloseTo(LIMITS.minCameraY, 10);
  });

  it('draws in monotonically as the view keeps rising', () => {
    // What the eye expects: nearer the feet the further up you look, rather
    // than sticking at a fixed height while the character pulls away.
    let previous = Infinity;
    for (let deg = 20; deg <= 89; deg += 5) {
      const dist = solveArmLength(5.5, FOCUS_Y, Math.sin((deg * Math.PI) / 180), LIMITS);
      expect(dist).toBeLessThanOrEqual(previous + 1e-9);
      previous = dist;
    }
    expect(previous).toBeLessThan(5.5);
  });

  it('never collapses past the minimum, even at an extreme', () => {
    expect(solveArmLength(5.5, 0.4, 1, LIMITS)).toBe(LIMITS.minDistance);
    expect(solveArmLength(0, FOCUS_Y, 1, LIMITS)).toBe(LIMITS.minDistance);
    expect(solveArmLength(NaN, FOCUS_Y, 1, LIMITS)).toBe(LIMITS.minDistance);
  });
});
