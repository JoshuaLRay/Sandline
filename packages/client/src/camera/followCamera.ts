/**
 * Third-person arm-length solve (T-0.06 QA harness).
 *
 * Pulled out of the render loop so the floor behaviour is testable. The rest of
 * the camera is Three.js bookkeeping; this is the one part with a rule that can
 * be stated and checked.
 */

export interface ArmLimits {
  /** Lowest world Y the camera may occupy. The QA ground plane is y = 0. */
  minCameraY: number;
  /** Never collapse the arm past this, even to satisfy the floor. */
  minDistance: number;
}

/**
 * Shorten the arm so the camera lands on, never under, the floor.
 *
 * Looking up swings the arm down and behind the character. Left alone it drives
 * the camera through the ground plane; clamping the resulting POSITION instead
 * would leave the camera buried at a fixed height while the character kept
 * rising away from it. Solving for the length that puts the camera exactly on
 * the floor makes it draw in toward the character's feet as you keep looking
 * up, which is what the eye expects.
 *
 * `verticalDir` is the Y component of the view direction: positive looking up.
 * When it is zero or negative the arm swings level or upward and there is
 * nothing to solve.
 */
export function solveArmLength(
  desired: number,
  focusY: number,
  verticalDir: number,
  limits: ArmLimits,
): number {
  if (!Number.isFinite(desired) || desired <= 0) return limits.minDistance;
  if (verticalDir <= 0) return desired;
  const room = (focusY - limits.minCameraY) / verticalDir;
  if (room >= desired) return desired;
  return Math.max(limits.minDistance, room);
}
