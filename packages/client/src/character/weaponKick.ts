import type { WeaponDef } from '@sandline/shared';

/**
 * The fire layer's kick (T-2.26): what a shot does to the rifle in the
 * hands, as the camera shake (T-2.09) is what it does to the picture.
 *
 * A shot drives the rifle back along its own axis and its muzzle up by the
 * weapon's kick in data, scaled down when aimed; both recover on one
 * exponential, frame-rate independent, and stack under a held trigger to a
 * bound the geometric series gives. Pure numbers; the rig turns them into a
 * pose through `hold`.
 */
export const KICK_DECAY_RATE = 16;
/** Metres of travel back along the rifle per degree of the weapon's kick. */
export const KICK_BACK_M_PER_DEG = 0.045;
/** Radians of muzzle rise per degree of the weapon's kick. */
export const KICK_UP_RAD_PER_DEG = 0.11;
export const KICK_SETTLE_FRACTION = 0.01;

export interface KickState {
  /** Metres back along the rifle's own axis. */
  back: number;
  /** Radians of muzzle rise. */
  up: number;
}

export function createKick(): KickState {
  return { back: 0, up: 0 };
}

export function addKick(state: KickState, def: WeaponDef, ads: boolean): KickState {
  const degrees = def.recoilKickDeg * (ads ? def.recoilAdsScale : 1);
  return {
    back: state.back + degrees * KICK_BACK_M_PER_DEG,
    up: state.up + degrees * KICK_UP_RAD_PER_DEG,
  };
}

export function decayKick(state: KickState, dtSeconds: number): KickState {
  if (!(dtSeconds > 0)) return state;
  const keep = Math.exp(-KICK_DECAY_RATE * dtSeconds);
  const back = state.back * keep;
  const up = state.up * keep;
  // Snap the tail so "at rest" is an exact question and the hold is exact.
  return { back: back < 1e-6 ? 0 : back, up: up < 1e-6 ? 0 : up };
}

/** Seconds for a kick to fall under KICK_SETTLE_FRACTION of its size. */
export function kickSettleSeconds(): number {
  return Math.log(1 / KICK_SETTLE_FRACTION) / KICK_DECAY_RATE;
}
