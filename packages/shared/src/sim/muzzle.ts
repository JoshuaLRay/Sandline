/**
 * Where a shot leaves the character.
 *
 * TWO DIFFERENT POINTS, and conflating them was the bug this replaces.
 *
 * `eyePosition` is the GAMEPLAY origin: the centre line at eye height, with no
 * lateral offset and no dependence on which camera the player is using. It is
 * what the server traces the authoritative ray from and what the client aims
 * along. It must be identical on both sides, and it must NOT vary with the view
 * mode — otherwise the same aim hits different things in first and third
 * person, which is a competitive advantage handed to whichever view is
 * currently luckier.
 *
 * `muzzlePosition` is the VISUAL origin: where the tracer is drawn from, so the
 * shot appears to leave the weapon rather than the player's forehead. It is
 * cosmetic, it varies with stance, and it is allowed to differ from the trace
 * origin — every third-person shooter does exactly this.
 *
 * The stances, which follow from where the camera is:
 *   - `third`  — over the right SHOULDER. The third-person camera looks past
 *                that shoulder, so a hip-height origin reads as the shot
 *                coming from below and behind the weapon.
 *   - `hip`    — first person, not aiming: the right hip, which is where a
 *                weapon carried at rest actually is.
 *   - `ads`    — first person, aiming: dead centre at eye height, because the
 *                weapon is shouldered and the sight IS the middle of the
 *                screen.
 *
 * Right is cross(forward, up), which for a yaw-only forward and Y up reduces to
 * (-forwardZ, 0, forwardX) — the SAME expression the camera shoulder offset
 * uses. Getting it backwards in one place and not the other puts the muzzle on
 * the opposite side from the camera, which is a bug this project has already
 * shipped once (and strafe was inverted before that, for the same reason).
 * Hence tests that assert against the cross product rather than a fixed axis.
 *
 * Pure arithmetic, no transcendentals, so it is safe under ADR-014.
 */
import type { Vec3 } from '../net/prediction.ts';

/** Which point the weapon is being held at. Follows the camera, not the input. */
export type MuzzleStance = 'third' | 'hip' | 'ads';

export interface MuzzleRig {
  /** Third person: over the right shoulder. */
  shoulderRight: number;
  shoulderHeight: number;
  /** First person at rest: the right hip. */
  hipRight: number;
  hipHeight: number;
  /**
   * Eye height. Doubles as the first-person aimed muzzle (dead centre) and, via
   * `eyePosition`, as the authoritative trace origin.
   */
  eyeHeight: number;
  /**
   * Eye height while prone (T-2.42): the trace origin of a soldier lying on the
   * ground. Inside the 0.8 m prone hit volume, not 0.75 m above it — a shot
   * from standing eye height would let a prone body fire over cover it is
   * hidden behind.
   */
  proneEyeHeight: number;
  /**
   * Eye height while crouched (U-002, B-09): the trace and throw origin of a
   * crouched soldier — the first-person camera's crouched pivot, inside the
   * crouched head (its capsule reaches about 1.29 m), so a crouched body can
   * only fire over cover its head shows above.
   */
  crouchEyeHeight: number;
}

/** Scaled against the 1.8 m reference figure the movement harness uses. */
export const DEFAULT_MUZZLE_RIG: MuzzleRig = {
  shoulderRight: 0.3,
  shoulderHeight: 1.42,
  hipRight: 0.26,
  hipHeight: 1.05,
  eyeHeight: 1.55,
  proneEyeHeight: 0.4,
  crouchEyeHeight: 1.15,
};

/** The body stance an eye follows (U-002): server-authoritative state both sides already agree on. */
export type EyeStance = 'standing' | 'crouched' | 'prone';

/** Prone beats crouched, as it does in the movement and the hitboxes. */
export function eyeStance(crouched: boolean, prone: boolean): EyeStance {
  return prone ? 'prone' : crouched ? 'crouched' : 'standing';
}

/** The rig's eye height above the feet for a body stance. */
export function eyeHeightFor(stance: EyeStance, rig: MuzzleRig = DEFAULT_MUZZLE_RIG): number {
  return stance === 'prone' ? rig.proneEyeHeight : stance === 'crouched' ? rig.crouchEyeHeight : rig.eyeHeight;
}

/**
 * The authoritative trace origin: centre line, eye height.
 *
 * Deliberately free of the muzzle stance and of camera tuning. The server has
 * no idea which view a client is using and must not need to, and a player who
 * drags the camera's pivot-height slider must not thereby move where their
 * bullets come from.
 *
 * The BODY's stance is different: it is server-authoritative state both sides
 * already agree on, so a prone body (T-2.42) traces from `proneEyeHeight` and a
 * crouched one (U-002, B-09) from `crouchEyeHeight` — each inside its own hit
 * volume, so no stance fires over cover from an eye it does not have.
 */
export function eyePosition(
  feetX: number,
  feetY: number,
  feetZ: number,
  rig: MuzzleRig = DEFAULT_MUZZLE_RIG,
  stance: EyeStance = 'standing',
): Vec3 {
  return { x: feetX, y: feetY + eyeHeightFor(stance, rig), z: feetZ };
}

/** `eyePosition` for a body as it stands: its feet and its stance flags. */
export function stanceEye(body: { x: number; y: number; z: number; crouched?: boolean; prone?: boolean }, rig: MuzzleRig = DEFAULT_MUZZLE_RIG): Vec3 {
  return eyePosition(body.x, body.y, body.z, rig, eyeStance(body.crouched ?? false, body.prone ?? false));
}

/**
 * The visual muzzle for a stance. Cosmetic: tracers are drawn from here, but
 * hits are resolved from `eyePosition`.
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
  stance: MuzzleStance,
  rig: MuzzleRig = DEFAULT_MUZZLE_RIG,
): Vec3 {
  if (stance === 'ads') {
    // Shouldered and sighted: the muzzle is the middle of the screen.
    return eyePosition(feetX, feetY, feetZ, rig);
  }
  const lateral = stance === 'third' ? rig.shoulderRight : rig.hipRight;
  const height = stance === 'third' ? rig.shoulderHeight : rig.hipHeight;
  // right = cross(forward, up) = (-forwardZ, 0, forwardX)
  return {
    x: feetX - forwardZ * lateral,
    y: feetY + height,
    z: feetZ + forwardX * lateral,
  };
}
