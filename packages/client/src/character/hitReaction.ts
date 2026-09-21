import { type HitZone } from '@sandline/shared';
import type { HitReaction } from './humanoidRig.ts';

/**
 * The hit reaction's numbers (T-2.27): what a round that landed on a soldier
 * does to the body that took it.
 *
 * PURE NUMBERS, AS THE KICK IS. Nothing here touches a bone. `hitReactionFrom`
 * turns the three things every client already knows about a hit — how much
 * damage it did, where on the body it landed, and where the shooter was —
 * into the reaction the rig contract speaks (`HitReaction`), and `reactionAt`
 * says what is left of it at an age. The rig turns those into a pose through
 * `react`, and the grey box, which has no spine to turn, keeps the T-2.11
 * translation flinch instead.
 *
 * A CLOSED FORM OF THE AGE, not a per-frame integration: the reaction at t is
 * the peak times exp(-rate x t), the T-2.02 form, so 30 and 120 fps trace the
 * same recovery and a test can ask what the body looks like at t without
 * stepping to it. It also means a second hit is a new peak and a new birth —
 * the body is thrown by the newest round, from wherever that one came, rather
 * than accumulating a lean from a burst it is standing in.
 *
 * DIRECTION IS THE SHOOTER'S, NOT THE ROUND'S. The shot event carries the
 * shooter and the impact point; the direction the body turns away from is the
 * shooter's position in the TARGET'S frame, which every client can compute
 * from state it already has. Nothing new goes on the wire for this.
 */

/** Recovery rate, reciprocal seconds: 1% of the peak remains after ~0.51 s. */
export const REACTION_DECAY_RATE = 9;
/** "Recovered" means this fraction of the peak remains. */
export const REACTION_SETTLE_FRACTION = 0.01;
/** Damage at which the reaction is at full size. More does not throw the body further. */
export const REACTION_FULL_DAMAGE = 45;
/** The chest's turn away from the shooter at full strength, radians. */
export const REACTION_TURN_RAD = 0.3;
/** The chest's tilt along the shot at full strength, radians. */
export const REACTION_LEAN_RAD = 0.2;

/** Where the shooter was, in the target's own frame: unit components. */
export interface ShooterDirection {
  /** +1 directly in front of the target, -1 directly behind. */
  forward: number;
  /** +1 directly on the target's left (the model's +X), -1 on its right. */
  left: number;
}

/** The fallback when the shooter's position is not known: treat it as a shot from the front. */
export const FROM_THE_FRONT: ShooterDirection = Object.freeze({ forward: 1, left: 0 });

/** A hit with no direction and no zone behind it: a straight jolt back, full strength. */
export const FRONTAL_HIT_REACTION: HitReaction = Object.freeze({ turn: 0, lean: REACTION_LEAN_RAD, head: 0 });

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * The shooter's direction in the target's frame. `dx`/`dz` are the shooter's
 * world position minus the target's; `facingYaw` is the target's own yaw, the
 * rotation about Y that takes the model's +Z onto its facing.
 *
 * A soldier standing on the shooter, or a shooter whose position is not
 * known, is a shot from the front: there is no side to turn away from.
 */
export function shooterDirection(dx: number, dz: number, facingYaw: number): ShooterDirection {
  const length = Math.sqrt(dx * dx + dz * dz);
  if (!(length > 0) || !Number.isFinite(facingYaw)) return FROM_THE_FRONT;
  const s = Math.sin(facingYaw);
  const c = Math.cos(facingYaw);
  // Facing (the model's +Z) is (sin, 0, cos); the model's +X, the soldier's
  // own left, is (cos, 0, -sin).
  return {
    forward: (dx * s + dz * c) / length,
    left: (dx * c - dz * s) / length,
  };
}

/**
 * The reaction one hit provokes, at its peak.
 *
 * The chest turns AWAY from the shooter — a round from the soldier's left
 * turns them to their right, which is a negative rotation about the model's
 * up axis — and tilts back from a shot in front, forward from one behind.
 * A head-zone hit snaps the head on top of that; every other zone does not.
 */
export function hitReactionFrom(damage: number, zone: HitZone, from: ShooterDirection): HitReaction {
  const strength = clamp01(Number.isFinite(damage) ? damage / REACTION_FULL_DAMAGE : 0);
  const left = Number.isFinite(from.left) ? Math.max(-1, Math.min(1, from.left)) : 0;
  const forward = Number.isFinite(from.forward) ? Math.max(-1, Math.min(1, from.forward)) : 0;
  return {
    turn: -REACTION_TURN_RAD * strength * left,
    lean: REACTION_LEAN_RAD * strength * forward,
    head: zone === 'head' ? strength : 0,
  };
}

/** What is left of a reaction `ageSeconds` after the hit. The T-2.02 curve. */
export function reactionAt(peak: HitReaction, ageSeconds: number): HitReaction {
  if (!(ageSeconds > 0)) return peak;
  const keep = Math.exp(-REACTION_DECAY_RATE * ageSeconds);
  return { turn: peak.turn * keep, lean: peak.lean * keep, head: peak.head * keep };
}

/** Seconds for a reaction to fall under the settle fraction. Derived, not fitted. */
export function reactionSeconds(
  fraction = REACTION_SETTLE_FRACTION,
  rate = REACTION_DECAY_RATE,
): number {
  if (!(fraction > 0) || fraction >= 1 || !(rate > 0)) throw new RangeError('bad settle parameters');
  return -Math.log(fraction) / rate;
}
