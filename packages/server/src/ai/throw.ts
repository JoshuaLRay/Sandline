/**
 * AI grenades (T-3.22): whom to throw at, and the throw that reaches them.
 *
 * A target is a grenade target once its known position has stayed put for
 * `staticSeconds` (a `StillWatch` per enemy, fed on its think ticks) and the
 * thrower's standing eye cannot see its crouched body — it has gone to ground
 * behind something a rifle cannot reach round.
 *
 * The throw is searched, not solved: yaw straight at the target, and every
 * launch pitch in the data's range walked through `projectileArc` — the same
 * `stepProjectile`, at the same tick, over the same world, from the same
 * launch point (`throwLaunch`) the session's throw path uses. So the landing
 * a brain chooses by is the landing the server will fly, bounces and roll
 * included, and a grenade that would skip back off the wall into the thrower's
 * lap is seen to do so before it is thrown. Of the arcs that go off within
 * reach of the target and clear of the thrower and every friend, the nearest
 * to the target wins; ties go to the lower pitch. A grenade leaves every hand
 * at the same speed, so a short throw is a lob: the range reaches up to near
 * vertical.
 *
 * Server-only (§7.9 rule 2), deterministic: no randomness, table trig.
 */
import {
  DEFAULT_MUZZLE_RIG,
  type MemoryEntry,
  type ProjectileDef,
  type ProjectileWorld,
  type TargetMemory,
  type WorldBox,
  degToAngle,
  dirFromYawPitch,
  eyePosition,
  launchOrigin,
  launchVelocity,
  projectileArc,
} from '@sandline/shared';
import { aimAngles } from './aim.ts';
import { seesConcealed } from './group.ts';
import RAW_THROW from './throw.json' with { type: 'json' };

type Vec3 = { x: number; y: number; z: number };

/** Grenade tuning (`throw.json`). */
export interface ThrowConfig {
  /** The projectiles.json row thrown. */
  projectile: string;
  staticSeconds: number;
  staticRadiusM: number;
  minRangeM: number;
  maxRangeM: number;
  pitchMinDeg: number;
  pitchMaxDeg: number;
  pitchStepDeg: number;
  reachFraction: number;
  safetyMarginM: number;
  retrySeconds: number;
  againSeconds: number;
}

class ThrowDataError extends Error {}

export function parseThrowConfig(raw: unknown): ThrowConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ThrowDataError('throw: expected an object');
  const row = raw as Record<string, unknown>;
  const keys = [
    '$comment', 'projectile', 'staticSeconds', 'staticRadiusM', 'minRangeM', 'maxRangeM', 'pitchMinDeg', 'pitchMaxDeg', 'pitchStepDeg',
    'reachFraction', 'safetyMarginM', 'retrySeconds', 'againSeconds',
  ];
  for (const k of Object.keys(row)) if (!keys.includes(k)) throw new ThrowDataError(`throw: unknown key "${k}"`);
  const num = (key: string, min: number, max: number): number => {
    const v = row[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new ThrowDataError(`throw.${key} must be a finite number, got ${String(v)}`);
    if (v < min || v > max) throw new ThrowDataError(`throw.${key} must be in [${min}, ${max}], got ${v}`);
    return v;
  };
  if (typeof row.projectile !== 'string' || row.projectile.length === 0) throw new ThrowDataError('throw.projectile must be a projectile id');
  const out = {
    projectile: row.projectile,
    staticSeconds: num('staticSeconds', 0, 60),
    staticRadiusM: num('staticRadiusM', 0, 10),
    minRangeM: num('minRangeM', 0, 200),
    maxRangeM: num('maxRangeM', 1, 200),
    pitchMinDeg: num('pitchMinDeg', -85, 85),
    pitchMaxDeg: num('pitchMaxDeg', -85, 85),
    // Not below half a degree: a finer search costs arcs and buys nothing a table angle can hold.
    pitchStepDeg: num('pitchStepDeg', 0.5, 45),
    // At most 1: a landing outside the blast radius cannot reach the target at all.
    reachFraction: num('reachFraction', 0, 1),
    safetyMarginM: num('safetyMarginM', 0, 20),
    retrySeconds: num('retrySeconds', 0, 30),
    againSeconds: num('againSeconds', 0, 60),
  };
  if (out.maxRangeM <= out.minRangeM) throw new ThrowDataError('throw: maxRangeM is not above minRangeM');
  if (out.pitchMaxDeg < out.pitchMinDeg) throw new ThrowDataError('throw: pitchMaxDeg is below pitchMinDeg');
  return out;
}

export const THROW: ThrowConfig = parseThrowConfig(RAW_THROW);

/**
 * How far ahead of the eye a projectile leaves the hand: just past the
 * thrower's own capsule (0.35 m radius) and no further; `launchOrigin` sweeps
 * the gap, so standing against a wall shortens it rather than posting a
 * grenade through the wall.
 */
export const LAUNCH_AHEAD_M = 0.55;

/** The eye a throw leaves from: a soldier's standing eye, as a human's Throw has always used. */
export function throwEye(feet: Vec3): Vec3 {
  return eyePosition(feet.x, feet.y, feet.z);
}

/**
 * Where a throw at (`yaw`, `pitch`, table units) starts and how fast: the one
 * launch both the session's throw path and the brain's search use.
 */
export function throwLaunch(def: ProjectileDef, eye: Vec3, yaw: number, pitch: number, world: ProjectileWorld): { origin: Vec3; velocity: Vec3 } {
  const y = yaw & 0xfff;
  const p = pitch & 0xfff;
  return { origin: launchOrigin(def, eye, dirFromYawPitch(y, p), LAUNCH_AHEAD_M, world), velocity: launchVelocity(def, y, p) };
}

// ---------------------------------------------------------------------------
// Whom
// ---------------------------------------------------------------------------

/** Where and since when a brain's target has been standing still, as it knows it. */
export interface StillWatch {
  netId: number | null;
  x: number;
  y: number;
  z: number;
  /** Seconds. */
  since: number;
}

export function createStillWatch(): StillWatch {
  return { netId: null, x: 0, y: 0, z: 0, since: 0 };
}

/**
 * A memory entry's feet: a shot is remembered at the shooter's eye, a
 * sighting at its feet, so one well above the watcher's own feet is lowered.
 */
export function knownFeet(entry: MemoryEntry, fromY: number): Vec3 {
  const lifted = entry.y - fromY >= DEFAULT_MUZZLE_RIG.eyeHeight * 0.5;
  return { x: entry.x, y: lifted ? entry.y - DEFAULT_MUZZLE_RIG.eyeHeight : entry.y, z: entry.z };
}

/**
 * Feed the watch on a think: a new target, or one known to have moved more
 * than `staticRadiusM` from where it was still, starts it again from now.
 */
export function watchStill(watch: StillWatch, target: number | null, memory: TargetMemory, fromY: number, now: number, config: ThrowConfig = THROW): void {
  const entry = target === null ? undefined : memory.entries.get(target);
  if (target === null || !entry) {
    watch.netId = null;
    return;
  }
  const feet = knownFeet(entry, fromY);
  const moved = Math.sqrt((feet.x - watch.x) ** 2 + (feet.z - watch.z) ** 2) > config.staticRadiusM;
  if (watch.netId !== target || moved) {
    watch.netId = target;
    watch.x = feet.x;
    watch.y = feet.y;
    watch.z = feet.z;
    watch.since = now;
  }
}

/** Seconds the watched target has been still, or 0 if it is not `target`. */
export function stillFor(watch: StillWatch, target: number | null, now: number): number {
  return target !== null && watch.netId === target ? now - watch.since : 0;
}

/**
 * Whether the target at `feet` is one to throw at from `from` (feet): still
 * long enough, in range, and in cover — its crouched body hidden from a
 * standing eye here.
 */
export function isGrenadeTarget(from: Vec3, feet: Vec3, stillSeconds: number, boxes: readonly WorldBox[], config: ThrowConfig = THROW): boolean {
  if (stillSeconds < config.staticSeconds) return false;
  const range = Math.sqrt((feet.x - from.x) ** 2 + (feet.z - from.z) ** 2);
  if (range < config.minRangeM || range > config.maxRangeM) return false;
  return !seesConcealed(from, feet, boxes);
}

// ---------------------------------------------------------------------------
// How
// ---------------------------------------------------------------------------

export interface ThrowChoice {
  /** Table units, as a Throw carries them. */
  yaw: number;
  pitch: number;
  /** Where the arc goes off. */
  landing: Vec3;
  /** Metres from where it goes off to the middle of the target's crouched body. */
  missM: number;
}

/**
 * How far up a target its reach is measured to: the middle of a crouched body,
 * as `blastDamageOn` measures to a body's middle. A grenade that goes off in
 * the air over a wall has to be near enough to that, not merely above the feet.
 */
const TARGET_MIDDLE_M = 0.6;

/** Seconds of flight a search walks: the fuse or the life, whichever ends the throw, and a tick over. */
function flightSeconds(def: ProjectileDef): number {
  const ends = def.detonateOnImpact ? def.maxLifeSeconds : Math.min(def.fuseSeconds, def.maxLifeSeconds);
  return ends + 1 / 30;
}

/**
 * The throw from `eye` that lands within reach of `target` (feet) and clear of
 * everyone in `friends` (feet, the thrower's own included), or null.
 */
export function chooseThrow(
  def: ProjectileDef,
  eye: Vec3,
  target: Vec3,
  friends: readonly Vec3[],
  world: ProjectileWorld,
  config: ThrowConfig = THROW,
): ThrowChoice | null {
  const yaw = aimAngles(eye, target).yaw;
  const reach = def.blastRadiusM * config.reachFraction;
  const clear = def.blastRadiusM + config.safetyMarginM;
  const seconds = flightSeconds(def);
  let best: ThrowChoice | null = null;
  const steps = Math.floor((config.pitchMaxDeg - config.pitchMinDeg) / config.pitchStepDeg + 1e-9);
  for (let i = 0; i <= steps; i++) {
    const pitch = degToAngle(config.pitchMinDeg + i * config.pitchStepDeg) & 0xfff;
    const { origin, velocity } = throwLaunch(def, eye, yaw, pitch, world);
    const arc = projectileArc(def, origin, velocity, { dt: 1 / 30, maxSeconds: seconds, world });
    const landing = arc.detonation ?? arc.points[arc.points.length - 1]!;
    const missM = Math.sqrt((landing.x - target.x) ** 2 + (landing.y - target.y - TARGET_MIDDLE_M) ** 2 + (landing.z - target.z) ** 2);
    if (missM > reach) continue;
    if (friends.some((f) => Math.sqrt((landing.x - f.x) ** 2 + (landing.z - f.z) ** 2) <= clear)) continue;
    if (best === null || missM < best.missM) best = { yaw, pitch, landing, missM };
  }
  return best;
}
