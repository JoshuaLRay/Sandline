/**
 * How an AI aims (T-3.15).
 *
 * A brain that wants to shoot names a target; the session finds a point on it
 * the shooter can see, lines up on it and pulls the trigger through the same
 * `tryFire` a human's `Fire` does. What makes an AI miss is here: an aim
 * error cone around the true line, from the archetype's accuracy block —
 * widened by distance, by the target's speed and by the shooter's own
 * suppression, narrowed by time on target — sampled from a seed of tick,
 * netId and shot (§7.9 rule 2), and applied BEFORE the weapon's own cone and
 * bloom, which are the gun's and stay the gun's.
 *
 * Server-only and never predicted (§7.9 rule 2), so `Math.atan2` is allowed
 * here, as in `followPath.ts`; the disc sample uses the shared tables anyway,
 * the same way `pelletDirection` does, so the error is on the integer path.
 */
import {
  ANGLE_MASK,
  ANGLE_UNITS,
  type BinAngle,
  type EnemyAccuracy,
  type WorldBox,
  cos,
  degToAngle,
  fromRadians,
  rayWorld,
  seedFrom,
  sin,
  unitFromSeed,
} from '@sandline/shared';
import { DEFAULT_HITBOX, type Hitbox, type Vec3, capsuleFor } from '../net/lagComp.ts';

/** What the aim cone is widened and narrowed by, at the moment of the shot. */
export interface AimConditions {
  /** Eye to aim point, metres. */
  distanceM: number;
  /** The target's horizontal speed, m/s. */
  targetSpeedMps: number;
  /** The shooter's suppression, 0..1 (T-3.16; 0 until it exists). */
  suppression: number;
  /** Seconds of continuous line of sight on this target. */
  timeOnTargetSeconds: number;
}

/**
 * The aim error half-angle, degrees. Every factor multiplies the base, so a
 * zero base is a perfect aimer however far, fast or suppressed; the ceiling is
 * the archetype's.
 */
export function aimConeDeg(accuracy: EnemyAccuracy, at: AimConditions): number {
  const distance = 1 + Math.max(0, at.distanceM) / accuracy.distanceDoublingM;
  const speed = 1 + Math.max(0, at.targetSpeedMps) * accuracy.speedFactorPerMps;
  const suppression = 1 + Math.min(1, Math.max(0, at.suppression)) * accuracy.suppressionFactor;
  const unsettled = accuracy.settleSeconds > 0 ? Math.max(0, 1 - Math.max(0, at.timeOnTargetSeconds) / accuracy.settleSeconds) : 0;
  const acquire = 1 + (accuracy.acquireFactor - 1) * unsettled;
  return Math.min(accuracy.maxConeDeg, accuracy.baseConeDeg * distance * speed * suppression * acquire);
}

/** Yaw and pitch, table units, from `eye` along the line to `at` — the angles a `Fire` carries. */
export function aimAngles(eye: Vec3, at: Vec3): { yaw: BinAngle; pitch: BinAngle } {
  const dx = at.x - eye.x;
  const dy = at.y - eye.y;
  const dz = at.z - eye.z;
  return { yaw: fromRadians(Math.atan2(dx, dz)), pitch: fromRadians(Math.atan2(dy, Math.sqrt(dx * dx + dz * dz))) };
}

/**
 * The line pushed off by a uniform sample of a disc `coneDeg` in half-angle,
 * as `pelletDirection` pushes a pellet: integer yaw and pitch deltas.
 */
export function aimError(yaw: BinAngle, pitch: BinAngle, coneDeg: number, seed: number): { yaw: BinAngle; pitch: BinAngle } {
  const cone = degToAngle(coneDeg);
  if (cone <= 0) return { yaw, pitch };
  const theta = Math.floor(unitFromSeed(seedFrom(seed, 0x41a1)) * ANGLE_UNITS) & ANGLE_MASK;
  const radius = cone * Math.sqrt(unitFromSeed(seedFrom(seed, 0x6e7d)));
  return {
    yaw: (yaw + Math.round(radius * sin(theta))) & ANGLE_MASK,
    pitch: (pitch + Math.round(radius * cos(theta))) & ANGLE_MASK,
  };
}

/** The seed of one shot's aim error: tick, shooter and shot, as a pellet's is. */
export function aimSeed(tick: number, netId: number, shotIndex: number): number {
  return seedFrom(tick, netId, shotIndex, 0xa1);
}

/**
 * Points on a soldier worth aiming at, best first: the centre of mass, then
 * the head. The head is what shows over a low wall that hides the chest.
 */
export function aimPoints(feet: Vec3, crouched: boolean, prone: boolean, hitbox: Hitbox = DEFAULT_HITBOX): Vec3[] {
  const { halfHeight, centerOffsetY } = capsuleFor(hitbox, crouched, prone);
  const centre = feet.y + centerOffsetY;
  return [
    { x: feet.x, y: centre, z: feet.z },
    { x: feet.x, y: centre + halfHeight, z: feet.z },
  ];
}

/** Whether nothing in the world stands between `eye` and `at`. */
export function lineOfSight(eye: Vec3, at: Vec3, boxes: readonly WorldBox[]): boolean {
  const dx = at.x - eye.x;
  const dy = at.y - eye.y;
  const dz = at.z - eye.z;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (length < 1e-9) return true;
  const ray = { origin: eye, direction: { x: dx / length, y: dy / length, z: dz / length }, maxDistance: length };
  return rayWorld(ray, boxes) === null;
}

/** The first aim point `eye` can see, or null: an AI never fires without one (T-3.15). */
export function visibleAimPoint(eye: Vec3, points: readonly Vec3[], boxes: readonly WorldBox[]): Vec3 | null {
  for (const point of points) if (lineOfSight(eye, point, boxes)) return point;
  return null;
}
