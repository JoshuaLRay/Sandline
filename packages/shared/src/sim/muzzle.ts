/**
 * Where a shot leaves the character.
 *
 * In `shared` because BOTH sides need it and must agree: the client draws the
 * tracer from here, and the server traces the authoritative hitscan ray from
 * here (T-1.18). Two copies of this that drifted apart would mean shots that
 * visibly leave the barrel but are traced from somewhere else — a whole class
 * of "that clearly hit" complaints with no visible cause.
 *
 * Pure arithmetic, no transcendentals, so it is safe under ADR-014.
 *
 * Reported in QA: hip fire appeared to come from the LEFT hip. The muzzle was
 * not on the left — it was on the character's centre line, at eye height, with
 * no lateral offset at all. The camera sits over the RIGHT shoulder, so a
 * centre-line origin is left of the camera's axis and reads as a left-handed
 * shooter. The fix is to put the muzzle where the weapon actually is.
 *
 * Right is cross(forward, up), which for a yaw-only forward and Y up reduces to
 * (-forwardZ, 0, forwardX) — the SAME expression the shoulder offset uses. That
 * shared derivation is the point: get it backwards in one place and not the
 * other and the muzzle ends up on the opposite side from the camera, which is
 * precisely the bug being fixed. This project has already lost time to a
 * handedness slip once (strafe was inverted because right was computed as
 * cross(up, forward)), hence the tests asserting against the cross product
 * rather than against a hardcoded axis.
 */

import type { Vec3 } from '../net/prediction.ts';

export interface MuzzleRig {
  /** Lateral offset toward the character's right, hip and aimed. */
  hipRight: number;
  adsRight: number;
  /** Height above the character's feet, hip and aimed. */
  hipHeight: number;
  adsHeight: number;
}

/**
 * Scaled against the 1.8 m reference figure. Hip is a weapon carried at the
 * right hip; aiming brings it up and in toward the eye line, which is what
 * shouldering a weapon does and what makes ADS read as a different stance.
 */
export const DEFAULT_MUZZLE_RIG: MuzzleRig = {
  hipRight: 0.26,
  adsRight: 0.08,
  hipHeight: 1.05,
  adsHeight: 1.5,
};

/**
 * Muzzle position in world space.
 *
 * `forwardX`/`forwardZ` are the character's facing — sin and cos of yaw, the
 * same pair the camera and character mesh use.
 */
export function muzzlePosition(
  feetX: number,
  feetY: number,
  feetZ: number,
  forwardX: number,
  forwardZ: number,
  ads: boolean,
  rig: MuzzleRig = DEFAULT_MUZZLE_RIG,
): Vec3 {
  const lateral = ads ? rig.adsRight : rig.hipRight;
  const height = ads ? rig.adsHeight : rig.hipHeight;
  // right = cross(forward, up) = (-forwardZ, 0, forwardX)
  return {
    x: feetX - forwardZ * lateral,
    y: feetY + height,
    z: feetZ + forwardX * lateral,
  };
}
