import { describe, expect, it } from 'vitest';
import {
  SPRING_ARM_OUT_RATE,
  SPRING_ARM_SETTLE_FRACTION,
  springArmLength,
  springArmSettleSeconds,
} from './springArm.ts';

function simulate(
  start: number,
  desired: number,
  fps: number,
  seconds: number,
): number {
  const dt = 1 / fps;
  const frames = Math.round(seconds * fps);
  let current = start;
  for (let i = 0; i < frames; i++) {
    current = springArmLength(current, desired, dt);
  }
  return current;
}

describe('spring arm (T-2.02)', () => {
  it('snaps inward in one frame', () => {
    expect(springArmLength(5.5, 2.0, 1 / 60)).toBe(2.0);
  });

  it('eases outward instead of snapping', () => {
    const next = springArmLength(2.0, 5.5, 1 / 60);
    expect(next).toBeGreaterThan(2.0);
    expect(next).toBeLessThan(5.5);
  });

  it('settles within the time derived from the smoothing rate', () => {
    const settleSeconds = springArmSettleSeconds();
    const start = 2.0;
    const desired = 5.5;
    const allowedError = (desired - start) * SPRING_ARM_SETTLE_FRACTION;

    for (const fps of [30, 60, 120]) {
      const settled = simulate(start, desired, fps, settleSeconds + 1 / fps);
      expect(desired - settled).toBeLessThanOrEqual(allowedError + 1e-12);
    }
  });

  it('is frame-rate independent over the same elapsed time', () => {
    const at30 = simulate(2.0, 5.5, 30, 0.5);
    const at120 = simulate(2.0, 5.5, 120, 0.5);
    const expected = 5.5 - (5.5 - 2.0) * Math.exp(-SPRING_ARM_OUT_RATE * 0.5);

    expect(at30).toBeCloseTo(at120, 12);
    expect(at30).toBeCloseTo(expected, 12);
  });

  it('initializes a fresh arm at the requested length', () => {
    expect(springArmLength(0, 5.5, 1 / 60)).toBe(5.5);
  });
});
