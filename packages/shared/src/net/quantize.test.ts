import { describe, expect, it } from 'vitest';
import { HEALTH, POSITION, VELOCITY, dequantize, quantize, quantizeAngle } from './quantize.ts';
import { WIRE_ANGLE_UNITS } from '../math/angles.ts';
import { Sfc32 } from '../math/prng.ts';

const SPECS = [
  ['POSITION', POSITION],
  ['VELOCITY', VELOCITY],
  ['HEALTH', HEALTH],
] as const;

describe('quantization (T-1.02)', () => {
  it.each(SPECS)('%s round-trips within its documented error bound', (_name, s) => {
    const rng = new Sfc32(1234);
    let worst = 0;
    for (let i = 0; i < 20_000; i++) {
      const v = s.min + rng.next() * (s.max - s.min);
      worst = Math.max(worst, Math.abs(dequantize(quantize(v, s), s) - v));
    }
    expect(worst).toBeLessThanOrEqual(s.maxError + 1e-9);
  });

  it.each(SPECS)('%s stays inside its declared bit width', (_name, s) => {
    const maxLevel = (1 << s.bits) - 1;
    for (const v of [s.min, s.max, 0, s.min - 1e6, s.max + 1e6]) {
      const q = quantize(v, s);
      expect(q).toBeGreaterThanOrEqual(0);
      expect(q).toBeLessThanOrEqual(maxLevel);
    }
  });

  // The important one: out-of-range must CLAMP. Wrapping would put a player who
  // left the world on the opposite side of the map.
  it.each(SPECS)('%s clamps out-of-range values rather than wrapping', (_name, s) => {
    expect(dequantize(quantize(s.min - 1000, s), s)).toBeCloseTo(s.min, 6);
    expect(dequantize(quantize(s.max + 1000, s), s)).toBeCloseTo(s.max, 6);
    expect(dequantize(quantize(s.min - 1000, s), s)).not.toBeCloseTo(s.max, 3);
  });

  it.each(SPECS)('%s survives non-finite input', (_name, s) => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const q = quantize(bad, s);
      expect(Number.isInteger(q)).toBe(true);
      expect(q).toBeGreaterThanOrEqual(0);
    }
  });

  it('documents position precision as better than a centimetre', () => {
    expect(POSITION.maxError).toBeLessThan(0.01);
    expect(POSITION.min).toBe(-512);
    expect(POSITION.max).toBeGreaterThan(511);
  });

  it('keeps velocity precision fine enough not to show in a tick', () => {
    // Worst-case error over one 30Hz tick must stay well under a millimetre.
    expect(VELOCITY.maxError / 30).toBeLessThan(0.001);
  });

  it('represents health exactly, since it is already an integer', () => {
    for (let hp = 0; hp <= 1023; hp++) {
      expect(dequantize(quantize(hp, HEALTH), HEALTH)).toBe(hp);
    }
  });

  it('quantizes angles exactly - they are already integers', () => {
    for (let a = 0; a < WIRE_ANGLE_UNITS; a++) expect(quantizeAngle(a)).toBe(a);
  });

  it('wraps angles rather than clamping them, unlike positions', () => {
    // Angles are cyclic, so wrapping is correct here and clamping would be wrong.
    expect(quantizeAngle(WIRE_ANGLE_UNITS)).toBe(0);
    expect(quantizeAngle(WIRE_ANGLE_UNITS + 5)).toBe(5);
    expect(quantizeAngle(-1)).toBe(WIRE_ANGLE_UNITS - 1);
  });

  it('is idempotent: re-quantizing a decoded value is a no-op', () => {
    // This is what makes delta change-detection stable. Without it a field would
    // look dirty forever and be resent every single tick.
    const rng = new Sfc32(99);
    for (let i = 0; i < 5000; i++) {
      const v = POSITION.min + rng.next() * (POSITION.max - POSITION.min);
      const once = quantize(v, POSITION);
      expect(quantize(dequantize(once, POSITION), POSITION)).toBe(once);
    }
  });
});
