import { describe, expect, it } from 'vitest';
import { ANGLE_QUARTER, ANGLE_UNITS, angleDelta, fromRadians, tableToWire, toRadians, wireToTable, wrapAngle } from './angles.ts';
import { cos, dirFromYaw, sin } from './trig.ts';

describe('binary angles', () => {
  it('wraps exactly in both directions', () => {
    expect(wrapAngle(ANGLE_UNITS)).toBe(0);
    expect(wrapAngle(-1)).toBe(ANGLE_UNITS - 1);
    expect(wrapAngle(ANGLE_UNITS * 3 + 7)).toBe(7);
  });

  it('takes the shortest signed path', () => {
    expect(angleDelta(10, 4)).toBe(6);
    expect(angleDelta(4, 10)).toBe(-6);
    // Across the wrap point, the short way round is 20 units, not 4076.
    expect(angleDelta(10, ANGLE_UNITS - 10)).toBe(20);
  });

  it('round-trips every wire angle onto an exact table index', () => {
    for (let w = 0; w < 1024; w++) {
      expect(tableToWire(wireToTable(w))).toBe(w);
    }
  });
});

describe('deterministic trig', () => {
  // T-0.14 acceptance: table trig matches Math.sin/cos within 1e-6 across the
  // full range. It is not expected to be bit-identical to Math — only to itself,
  // on every engine.
  it('matches Math.sin within 1e-6 over the whole turn', () => {
    let worst = 0;
    for (let a = 0; a < ANGLE_UNITS; a++) {
      worst = Math.max(worst, Math.abs(sin(a) - Math.sin(toRadians(a))));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('matches Math.cos within 1e-6 over the whole turn', () => {
    let worst = 0;
    for (let a = 0; a < ANGLE_UNITS; a++) {
      worst = Math.max(worst, Math.abs(cos(a) - Math.cos(toRadians(a))));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('hits the cardinal directions exactly, not approximately', () => {
    // Exactness at the quadrant boundaries is what makes symmetry lossless.
    expect(sin(0)).toBe(0);
    expect(sin(ANGLE_QUARTER)).toBe(1);
    expect(sin(ANGLE_QUARTER * 2)).toBe(0);
    expect(sin(ANGLE_QUARTER * 3)).toBe(-1);
    expect(cos(0)).toBe(1);
    expect(cos(ANGLE_QUARTER * 2)).toBe(-1);
  });

  it('never returns negative zero', () => {
    // -0 and 0 have different bit patterns, so a byte-level state hash would
    // see them as divergence. sin() normalises so parity tests cannot trip on it.
    for (let a = 0; a < ANGLE_UNITS; a++) {
      expect(Object.is(sin(a), -0)).toBe(false);
      expect(Object.is(cos(a), -0)).toBe(false);
    }
  });

  it('satisfies the Pythagorean identity to f64 precision', () => {
    for (let a = 0; a < ANGLE_UNITS; a += 7) {
      expect(sin(a) * sin(a) + cos(a) * cos(a)).toBeCloseTo(1, 12);
    }
  });

  it('is symmetric: sin(-a) === -sin(a) exactly', () => {
    // Exact equality is correct here — the negative branch is literally a
    // negation of the same table entry (ADR-014: exact where the path is exact).
    for (let a = 1; a < ANGLE_UNITS; a += 13) {
      expect(sin(wrapAngle(-a))).toBe(-sin(a));
    }
  });

  it('produces unit-length yaw directions', () => {
    for (let a = 0; a < ANGLE_UNITS; a += 11) {
      const d = dirFromYaw(a);
      expect(Math.sqrt(d.x * d.x + d.z * d.z)).toBeCloseTo(1, 12);
    }
  });

  it('is a pure function of its input', () => {
    for (let a = 0; a < ANGLE_UNITS; a += 97) {
      expect(sin(a)).toBe(sin(a));
      expect(dirFromYaw(a)).toEqual(dirFromYaw(a));
    }
  });

  it('accepts unnormalised input without drifting', () => {
    expect(sin(ANGLE_UNITS * 5 + 123)).toBe(sin(123));
  });

  it('round-trips radians within one angle unit', () => {
    const step = (Math.PI * 2) / ANGLE_UNITS;
    for (let a = 0; a < ANGLE_UNITS; a += 31) {
      expect(Math.abs(toRadians(fromRadians(toRadians(a))) - toRadians(a))).toBeLessThan(step);
    }
  });
});
