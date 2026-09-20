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
import type { WeaponDef } from '@sandline/shared';
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

/** A shot: add the weapon's impulse to whatever is still ringing. */
export function addShake(state: ShakeState, def: WeaponDef, ads: boolean): ShakeState {
  const scale = ads ? def.recoilAdsScale : 1;
  return {
    posAmp: state.posAmp + def.shakePosM * scale,
    rollAmp: state.rollAmp + (def.shakeRollDeg * Math.PI) / 180 * scale,
    // A fresh impulse on a quiet camera starts its own phase; one landing
    // on a ringing camera rides the existing one.
    time: state.posAmp === 0 && state.rollAmp === 0 ? 0 : state.time,
  };
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
