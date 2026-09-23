/**
 * Vision and awareness (T-3.13).
 *
 * Pure functions of (observer, target, world): nothing here holds state or
 * reads a clock. A brain keeps one awareness number per target and hands it
 * back each think with the `dt` since the last one; the session decides when
 * that is (T-3.14 wires it).
 *
 * Three questions, in order:
 *
 *   1. **Could it see there at all?** The archetype's view cone and range.
 *      The cone is horizontal — about the observer's yaw, whatever the target's
 *      height — and its test is a dot product against the table cosine of the
 *      half angle, so no `atan2` is ever needed.
 *   2. **Can it see the target?** Line of sight by `rayWorld` from the
 *      observer's eye to the target's shin, chest and head — the blast's probe
 *      shape (`BLAST_PROBE_FRACTIONS`) up the target's stance height. The
 *      fraction of the three with a clear line is its exposure: a soldier
 *      behind a low wall shows a head standing and nothing crouched.
 *   3. **Has it noticed?** Awareness, 0..1, accumulates while the target is
 *      seen — faster close, moving, firing or standing; slower crouched, prone,
 *      half hidden or at the cone's edge — and decays while it is not.
 *      Detection is awareness at or past the archetype's threshold, never one
 *      visible frame: even the fastest rate the data allows takes several
 *      ticks to get there.
 *
 * Every number that tunes it is the archetype's perception block in
 * `enemies.json` (standing rule 4).
 */
import { ANGLE_UNITS, type BinAngle, wrapAngle } from '../math/angles.ts';
import { cos, dirFromYaw } from '../math/trig.ts';
import type { Vec3 } from '../net/prediction.ts';
import { BLAST_PROBE_FRACTIONS } from '../sim/ballistics.ts';
import { DEFAULT_MOVE_CONFIG, type MoveConfig } from '../sim/CharacterController.ts';
import type { EnemyPerception } from '../sim/enemies.ts';
import { type WorldBox, rayWorld } from '../sim/world.ts';

export type Stance = 'standing' | 'crouched' | 'prone';

/** Who is looking: an eye and a facing. */
export interface PerceptionObserver {
  eye: Vec3;
  /** Facing, table units (`dirFromYaw`: 0 along +Z, a quarter turn along +X). */
  yaw: BinAngle;
}

/** Who is being looked for. */
export interface PerceptionTarget {
  feet: Vec3;
  stance: Stance;
  /** Horizontal speed, m/s. */
  speed: number;
  /** Fired this think. */
  firing: boolean;
}

/** What the observer can make out of the target right now. */
export interface Sighting {
  /** Eye to the target's chest probe, metres. */
  distance: number;
  inRange: boolean;
  inCone: boolean;
  /**
   * Where in the cone, 0 at its edge to 1 dead ahead. Zero outside it. Linear
   * in the cosine, not the angle — a table lookup, not an arc cosine.
   */
  centrality: number;
  /** Fraction of shin, chest and head with a clear line from the eye; 0 unless in range and cone. */
  exposure: number;
  /** In range, in the cone and at least one probe clear. */
  visible: boolean;
}

/** A stance's height, from the controller's own numbers. */
export function stanceHeight(stance: Stance, config: MoveConfig = DEFAULT_MOVE_CONFIG): number {
  return stance === 'prone' ? config.proneHeight : stance === 'crouched' ? config.crouchHeight : config.height;
}

/**
 * Half the view cone in table units. Rounded to the table, so the cone's edge
 * is the same angle on every engine.
 */
export function coneHalfAngle(perception: EnemyPerception): BinAngle {
  return Math.min(ANGLE_UNITS / 2, Math.round((perception.fovDeg / 720) * ANGLE_UNITS));
}

/**
 * The cone test on its own: whether a horizontal offset (dx, dz) from the eye
 * lies inside the cone, and how central. Something directly above or below
 * the eye is dead ahead — there is no bearing to be outside of.
 */
export function inViewCone(
  yaw: BinAngle,
  dx: number,
  dz: number,
  perception: EnemyPerception,
): { inCone: boolean; centrality: number } {
  const flat = Math.sqrt(dx * dx + dz * dz);
  if (flat <= 1e-6) return { inCone: true, centrality: 1 };
  const facing = dirFromYaw(wrapAngle(yaw));
  const dot = (facing.x * dx + facing.z * dz) / flat;
  const cosHalf = cos(coneHalfAngle(perception));
  if (dot < cosHalf) return { inCone: false, centrality: 0 };
  // A full-circle cone (cosHalf = -1) still ranks what is ahead above what is behind.
  const span = 1 - cosHalf;
  return { inCone: true, centrality: span <= 1e-9 ? 1 : Math.min(1, (dot - cosHalf) / span) };
}

/** Everything the observer can make out of one target: cone, range and line of sight. */
export function sight(
  observer: PerceptionObserver,
  target: PerceptionTarget,
  world: readonly WorldBox[],
  perception: EnemyPerception,
  config: MoveConfig = DEFAULT_MOVE_CONFIG,
  probes: readonly number[] = BLAST_PROBE_FRACTIONS,
): Sighting {
  const eye = observer.eye;
  const height = stanceHeight(target.stance, config);
  const chestY = target.feet.y + height * 0.5;
  const cx = target.feet.x - eye.x;
  const cy = chestY - eye.y;
  const cz = target.feet.z - eye.z;
  const distance = Math.sqrt(cx * cx + cy * cy + cz * cz);
  const inRange = distance <= perception.visionRangeM;
  const { inCone, centrality } = inViewCone(observer.yaw, cx, cz, perception);
  if (!inRange || !inCone || probes.length === 0) {
    return { distance, inRange, inCone, centrality, exposure: 0, visible: false };
  }

  let clear = 0;
  for (const fraction of probes) {
    const dy = target.feet.y + height * fraction - eye.y;
    const d = Math.sqrt(cx * cx + dy * dy + cz * cz);
    if (d <= 1e-6) {
      clear += 1;
      continue;
    }
    const hit = rayWorld(
      // Stop a hair short, as the blast does: a target flat against the
      // observer's side of a wall is not hidden by that wall.
      { origin: eye, direction: { x: cx / d, y: dy / d, z: cz / d }, maxDistance: d - 1e-3 },
      world,
    );
    if (hit === null) clear += 1;
  }
  const exposure = clear / probes.length;
  return { distance, inRange, inCone, centrality, exposure, visible: clear > 0 };
}

/**
 * How fast awareness rises, per second, for this sighting of this target. Zero
 * when the target is not visible.
 *
 * The product of independent factors, each from the archetype's data:
 * distance (`nearRatePerSec` at the eye falling to `farRatePerSec` at the
 * edge of range, on the square of closeness so the near field is where
 * attention lives), stance (standing is 1), motion, firing, place in the cone
 * (`edgeFactor` at its edge, 1 dead ahead) and exposure — capped at
 * `maxRatePerSec`, which is what keeps a target point blank, sprinting and
 * firing from being detected in one think.
 */
export function awarenessRate(sighting: Sighting, target: PerceptionTarget, perception: EnemyPerception): number {
  if (!sighting.visible) return 0;
  const closeness = Math.max(0, 1 - sighting.distance / perception.visionRangeM);
  const distance = perception.farRatePerSec + (perception.nearRatePerSec - perception.farRatePerSec) * closeness * closeness;
  const stance =
    target.stance === 'prone' ? perception.proneFactor : target.stance === 'crouched' ? perception.crouchFactor : 1;
  const motion = target.speed >= perception.movingSpeedMps ? perception.movingFactor : 1;
  const firing = target.firing ? perception.firingFactor : 1;
  const edge = perception.edgeFactor + (1 - perception.edgeFactor) * sighting.centrality;
  return Math.min(perception.maxRatePerSec, distance * stance * motion * firing * edge * sighting.exposure);
}

/**
 * Awareness after `dt` seconds of this sighting: up by the rate while visible,
 * down by `decayPerSec` while not, clamped to 0..1.
 */
export function stepAwareness(
  awareness: number,
  sighting: Sighting,
  target: PerceptionTarget,
  perception: EnemyPerception,
  dt: number,
): number {
  const next = sighting.visible
    ? awareness + awarenessRate(sighting, target, perception) * dt
    : awareness - perception.decayPerSec * dt;
  return Math.min(1, Math.max(0, next));
}

/** Detection: awareness at or past the archetype's threshold. */
export function isDetected(awareness: number, perception: EnemyPerception): boolean {
  return awareness >= perception.detectAt;
}
