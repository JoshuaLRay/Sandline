/**
 * The first-person reload (U-006): what the hands and the gun do across a
 * reload, as a pure function of its progress (0..1 of the weapon's own
 * reload clock, `CombatQA.reloadProgress`). Presentation only: nothing here
 * decides when rounds are in the magazine.
 *
 * The beats land on the reload's sound stages (`weaponSounds.json`
 * `stages`), so the picture and the audio agree by construction:
 *
 *   0          `out`   the gun comes up off the hip and out to arm's
 *                      length, canted to turn its well to the left hand,
 *                      which leaves the foregrip for the magazine;
 *   … 0.34             the hand pulls the magazine down and out of view;
 *   … `in`             it brings a fresh one up and seats it — a small jolt
 *                      on the seat;
 *   `bolt`             the bolt goes home: the gun rocks back;
 *   … 1                back to ready, exactly the hold it left.
 *
 * Every term is continuous in progress and zero at both ends, so a reload
 * neither pops in nor out; `ViewModel` eases out whatever pose an
 * interrupted reload leaves behind.
 */
import { WEAPON_SOUNDS } from '@sandline/shared';

export interface ReloadPose {
  /** Added to the hold, the viewmodel camera's space: metres (+X right, +Y up, +Z back toward the eye). */
  x: number;
  y: number;
  z: number;
  /** Added to the hold, radians: muzzle up, and the cant (negative: the top of the gun to the right, its well turned to the left hand). */
  pitch: number;
  roll: number;
  /** Metres the magazine is out of its well along the well's axis; 0 seated. */
  magOut: number;
  /** Radians the magazine tips as it comes out. */
  magTilt: number;
  /** 0 the left hand on the foregrip, 1 on the magazine. */
  handOnMag: number;
}

export const REST_POSE: Readonly<ReloadPose> = { x: 0, y: 0, z: 0, pitch: 0, roll: 0, magOut: 0, magTilt: 0, handOnMag: 0 };

/** How far the magazine goes: well below the view. */
export const MAG_OUT_M = 0.34;
/** The cant the gun is held at, radians: the top to the right, so the well faces the left hand. */
export const RELOAD_CANT = -0.5;

const smoothstep = (a: number, b: number, t: number): number => {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
};
/** Up over [a, b], held, down over [c, d]. */
const plateau = (t: number, a: number, b: number, c: number, d: number): number => smoothstep(a, b, t) * (1 - smoothstep(c, d, t));
/** A single smooth bump over [at, at + width]. */
const bump = (t: number, at: number, width: number): number => (t <= at || t >= at + width ? 0 : Math.sin((Math.PI * (t - at)) / width));

/** The pose at `progress` through a reload; the rest pose outside (0, 1). */
export function reloadPose(progress: number, stages: { in: number; bolt: number } = WEAPON_SOUNDS.stages): ReloadPose {
  if (!(progress > 0 && progress < 1)) return { ...REST_POSE };
  const p = progress;
  const seat = stages.in;
  const bolt = stages.bolt;
  // Up into the reload hold, and back down after the bolt.
  const held = plateau(p, 0, 0.14, bolt + 0.02, 1);
  // The magazine: pulled down and away, out of view, then a fresh one up and seated at `in`.
  const out = smoothstep(0.16, 0.34, p);
  const back = smoothstep(0.4, seat, p);
  const magOut = MAG_OUT_M * out * (1 - back);
  const seatJolt = bump(p, seat, 0.06);
  const boltJolt = bump(p, bolt, 0.08);
  return {
    x: -0.06 * held,
    y: 0.12 * held + 0.008 * seatJolt,
    z: -0.2 * held + 0.022 * boltJolt,
    pitch: 0.06 * held + 0.05 * seatJolt,
    roll: RELOAD_CANT * held - 0.07 * boltJolt,
    magOut,
    magTilt: 0.5 * (magOut / MAG_OUT_M),
    // To the magazine before it moves, with it all the way out and back, and home after the seat.
    handOnMag: plateau(p, 0.08, 0.16, seat + 0.02, seat + 0.12),
  };
}

/** `pose` eased toward rest by `dt` seconds at `rate` per second, in place: an interrupted reload settles, never snaps. */
export function settle(pose: ReloadPose, dt: number, rate = 12): ReloadPose {
  const k = Math.exp(-rate * Math.max(0, dt));
  for (const key of Object.keys(REST_POSE) as (keyof ReloadPose)[]) pose[key] *= k;
  return pose;
}
