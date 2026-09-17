/**
 * Wire quantization (T-1.02, ADR-009).
 *
 * Every field states its range, its step, and therefore its worst-case error.
 * Out-of-range values CLAMP rather than wrap: a player teleported outside the
 * world bound should appear pinned at the edge, not on the opposite side of the
 * map, which is what wrapping would do.
 */
import { WIRE_ANGLE_UNITS } from '../math/angles.ts';

export interface QuantSpec {
  readonly bits: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Worst-case round-trip error: half a step. */
  readonly maxError: number;
}

function spec(bits: number, min: number, step: number): QuantSpec {
  const levels = (1 << bits) - 1;
  return { bits, min, max: min + levels * step, step, maxError: step / 2 };
}

/** Position: +/-512 m at 1/64 m. 16 bits, worst error 7.8 mm. */
export const POSITION = spec(16, -512, 1 / 64);

/** Velocity: +/-64 m/s at 1/32 m/s. 12 bits, worst error 15.6 mm/s. */
export const VELOCITY = spec(12, -64, 1 / 32);

/** Health: 0..1023, exact (integers). */
export const HEALTH = spec(10, 0, 1);

export function quantize(value: number, s: QuantSpec): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = value < s.min ? s.min : value > s.max ? s.max : value;
  const level = Math.round((clamped - s.min) / s.step);
  const maxLevel = (1 << s.bits) - 1;
  return level < 0 ? 0 : level > maxLevel ? maxLevel : level;
}

export function dequantize(level: number, s: QuantSpec): number {
  return s.min + level * s.step;
}

/**
 * Angles are already integers everywhere in the simulation (ADR-014), so this
 * is a mask, not a rounding step — it is exact, and it is the same integer the
 * trig table indexes.
 */
export function quantizeAngle(wireAngle: number): number {
  return wireAngle & (WIRE_ANGLE_UNITS - 1);
}

export const ANGLE_BITS_WIRE = 10;
