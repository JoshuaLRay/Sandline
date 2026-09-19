/**
 * Third-person spring-arm length (T-2.02).
 *
 * The arm is intentionally asymmetric:
 *   - when the desired arm gets shorter, snap inward immediately;
 *   - when the desired arm gets longer, ease outward exponentially.
 *
 * The exponential form is frame-rate independent. A naive lerp(a, b, k)
 * applies a different effective rate at 30 fps and 120 fps; integrating
 * 1 - exp(-rate * dt) gives the same continuous-time solution at both.
 *
 * current is the previous frame's arm length. solveCamera already owns
 * that state in its caller-owned CameraSolve, so this module stays pure and
 * headless.
 */

/** Outward smoothing rate, in reciprocal seconds. */
export const SPRING_ARM_OUT_RATE = 12;

/** "Settled" means this fraction of the original error remains. */
export const SPRING_ARM_SETTLE_FRACTION = 0.01;

/**
 * Time required for the exponential tail to fall to the settle fraction.
 * Derived from the smoothing constant rather than fitted to frame counts.
 */
export function springArmSettleSeconds(
  rate = SPRING_ARM_OUT_RATE,
  fraction = SPRING_ARM_SETTLE_FRACTION,
): number {
  if (!(rate > 0) || !(fraction > 0) || fraction >= 1) {
    throw new RangeError('spring-arm rate must be > 0 and fraction must be in (0, 1)');
  }
  return -Math.log(fraction) / rate;
}

/** Advance the arm one render frame. */
export function springArmLength(
  current: number,
  desired: number,
  dtSeconds: number,
  rate = SPRING_ARM_OUT_RATE,
): number {
  if (!Number.isFinite(desired)) return current;
  if (desired <= 0) return desired;
  if (!Number.isFinite(current) || current <= 0) return desired;

  // A shorter arm is a safety response. Never lag behind a new constraint.
  if (desired <= current) return desired;
  if (!(dtSeconds > 0) || !(rate > 0)) return current;

  const alpha = 1 - Math.exp(-rate * dtSeconds);
  return current + (desired - current) * alpha;
}
