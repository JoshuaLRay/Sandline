/**
 * Camera shake (T-2.09).
 *
 * WHAT THE EYE SEES, NOT WHERE THE GUN POINTS. Recoil (T-2.08) moves the aim:
 * the view climbs and the next shot goes where it now points. Shake moves
 * only the picture: a small positional and roll impulse on the camera that
 * decays away, and that the aim ray never reads. The reticle stays put and
 * the shot goes where it did; only the frame around them jolts. Letting the
 * aim follow the shake would mean the player is aiming with a shaking gun,
 * which is the one thing this must not become.
 *
 * COMPOSED AFTER THE ARM. The solve settles the camera's position against
 * the floor and the scenery first; shake is written into separate fields
 * (`CameraSolve.shake`) that the renderer adds when it places the camera.
 * `position`, `focus`, `direction` and `distance` are untouched, so collision
 * cannot be pushed into a wall by a jolt and the aim, which reads `position`
 * and `direction`, is unaffected by construction.
 *
 * IMPULSES SUM. A second shot while the first is still ringing adds its
 * magnitude rather than restarting the envelope, so a burst builds a
 * heavier judder than a single shot — bounded, because the envelope decays
 * exponentially: at a fixed cadence the sum converges rather than grows.
 *
 * FRAME-RATE INDEPENDENT, the T-2.02 form: the amplitude decays by
 * exp(-rate x dt) and the oscillation runs on elapsed seconds, so 30 and
 * 120 fps trace the same picture.
 */
import { type ProjectileDef, SUPPRESSION, type WeaponDef, blastDamageOn } from '@sandline/shared';
import type { WorldBox } from '@sandline/shared';
import type { CameraSolve } from './cameraSolve.ts';

/** Amplitude envelope decay, in reciprocal seconds. 1% remains after ~0.33 s. */
export const SHAKE_DECAY_RATE = 14;
/** Oscillation of the offset, in cycles per second. */
export const SHAKE_FREQUENCY_HZ = 23;
/** "Settled" means this fraction of the impulse remains. */
export const SHAKE_SETTLE_FRACTION = 0.01;

export interface ShakeState {
  /** Positional amplitude, metres. */
  posAmp: number;
  /** Roll amplitude, radians. */
  rollAmp: number;
  /** Seconds the envelope has been ringing, for the oscillation phase. */
  time: number;
}

export interface ShakeOffset {
  /** Camera-local: right and up, metres. */
  right: number;
  up: number;
  /** Radians. */
  roll: number;
}

export function createShake(): ShakeState {
  return { posAmp: 0, rollAmp: 0, time: 0 };
}

/** Add one impulse to whatever is still ringing. */
export function addImpulse(state: ShakeState, posM: number, rollRad: number): ShakeState {
  return {
    posAmp: state.posAmp + posM,
    rollAmp: state.rollAmp + rollRad,
    // A fresh impulse on a quiet camera starts its own phase; one landing
    // on a ringing camera rides the existing one.
    time: state.posAmp === 0 && state.rollAmp === 0 ? 0 : state.time,
  };
}

/** A shot: add the weapon's impulse to whatever is still ringing. */
export function addShake(state: ShakeState, def: WeaponDef, ads: boolean): ShakeState {
  const scale = ads ? def.recoilAdsScale : 1;
  return addImpulse(state, def.shakePosM * scale, ((def.shakeRollDeg * Math.PI) / 180) * scale);
}

/** A blast in the open, at the viewer's own feet: the hardest it can shake. */
export const BLAST_SHAKE_POS_M = 0.075;
export const BLAST_SHAKE_ROLL_DEG = 1.4;

/**
 * What a blast does to the PICTURE at a distance (T-2.33).
 *
 * Scaled by exactly the fraction of the blast that reached the viewer — the
 * same `blastDamageOn` the server scored the damage with, over the same box
 * list — so the shake and the damage cannot disagree: a blast that hurt you
 * badly rings the camera hard, one behind a wall is felt through the wall,
 * and one past its radius is not felt at all. Nothing here touches the aim,
 * for the reason at the top of this file.
 *
 * `feet` is the viewer's own position, not the camera's: the camera sits on an
 * arm behind the player's shoulder, and how hard a grenade rattles you should
 * not depend on which way you happen to be facing.
 */
export function blastShake(
  def: ProjectileDef,
  centre: { x: number; y: number; z: number },
  feet: { x: number; y: number; z: number },
  heightM: number,
  world: readonly WorldBox[],
): { posM: number; rollRad: number } {
  if (!(def.blastDamage > 0)) return { posM: 0, rollRad: 0 };
  const fraction = blastDamageOn(def, centre, feet, heightM, world) / def.blastDamage;
  const clamped = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  return {
    posM: BLAST_SHAKE_POS_M * clamped,
    rollRad: ((BLAST_SHAKE_ROLL_DEG * Math.PI) / 180) * clamped,
  };
}

/** One near miss's jolt (T-3.17): smaller than the carbine's own kick, a flinch rather than a blow. */
export const NEAR_MISS_SHAKE_POS_M = 0.02;
export const NEAR_MISS_SHAKE_ROLL_DEG = 0.6;

/**
 * The jolt for a rise in the replicated suppression level (T-3.17).
 *
 * The page is not told about near misses one by one; it is told the level
 * (T-3.16), and a near miss is what makes it jump. So a rise from `from` to
 * `to` is felt as `(to - from) / SUPPRESSION.nearMiss` near misses' worth of
 * jolt — one for one near miss, a fraction for an impact beside you, two for
 * a two-round burst landing between snapshots — capped at three, since the
 * level saturates anyway. A fall, or no change, is nothing: decay is quiet.
 * Nothing here touches the aim, for the reason at the top of this file.
 */
export function suppressionJolt(from: number, to: number): { posM: number; rollRad: number } {
  const rise = to - from;
  if (!(rise > 0) || !(SUPPRESSION.nearMiss > 0)) return { posM: 0, rollRad: 0 };
  const misses = Math.min(3, rise / SUPPRESSION.nearMiss);
  return { posM: NEAR_MISS_SHAKE_POS_M * misses, rollRad: ((NEAR_MISS_SHAKE_ROLL_DEG * Math.PI) / 180) * misses };
}

/** Let the envelope decay and the phase advance over `dtSeconds`. */
export function decayShake(state: ShakeState, dtSeconds: number): ShakeState {
  if (!(dtSeconds > 0)) return state;
  const keep = Math.exp(-SHAKE_DECAY_RATE * dtSeconds);
  const posAmp = state.posAmp * keep;
  const rollAmp = state.rollAmp * keep;
  // Snap the tail so "quiet" is an exact question and the camera sits still.
  return {
    posAmp: posAmp < 1e-6 ? 0 : posAmp,
    rollAmp: rollAmp < 1e-7 ? 0 : rollAmp,
    time: posAmp < 1e-6 && rollAmp < 1e-7 ? 0 : state.time + dtSeconds,
  };
}

/** How long an impulse takes to fall to the settle fraction. Derived, not fitted. */
export function shakeSettleSeconds(fraction = SHAKE_SETTLE_FRACTION, rate = SHAKE_DECAY_RATE): number {
  if (!(fraction > 0) || fraction >= 1 || !(rate > 0)) throw new RangeError('bad settle parameters');
  return -Math.log(fraction) / rate;
}

/**
 * The offset the current envelope produces, scaled by the player's `reduce`
 * setting (1 is full, 0 is none). Two oscillations at different phases so the
 * motion reads as a jolt rather than a metronome.
 */
export function shakeOffset(state: ShakeState, scale: number): ShakeOffset {
  if (scale <= 0 || (state.posAmp === 0 && state.rollAmp === 0)) return { right: 0, up: 0, roll: 0 };
  const w = 2 * Math.PI * SHAKE_FREQUENCY_HZ * state.time;
  return {
    right: state.posAmp * scale * Math.sin(w),
    up: state.posAmp * scale * 0.6 * Math.cos(w * 1.31),
    roll: state.rollAmp * scale * Math.sin(w * 0.77),
  };
}

/**
 * Write the shake into the solve's `shake` fields, leaving everything the aim
 * and the arm read untouched. The renderer adds `shake` to `position` along
 * the camera's own right and up axes and puts `shake.roll` in the Euler's
 * roll term — the one term the solve had always pinned at zero.
 */
export function applyShake(out: CameraSolve, state: ShakeState, scale: number): CameraSolve {
  const o = shakeOffset(state, scale);
  // Camera right for a Y-up world and a yaw-only forward is (-fwdZ, 0, fwdX);
  // up is world up, which is close enough for a centimetre of jolt at any
  // pitch a player can reach.
  const rx = -out.forward.z;
  const rz = out.forward.x;
  out.shake.x = rx * o.right;
  out.shake.y = o.up;
  out.shake.z = rz * o.right;
  out.shake.roll = o.roll;
  return out;
}
