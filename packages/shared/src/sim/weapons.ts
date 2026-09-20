/**
 * Hitscan weapons (T-1.17, ADR-014).
 *
 * Two halves, deliberately kept apart:
 *
 *   - Weapon *definitions* are data (`../data/weapons.json`), validated once at
 *     import. Systems never hardcode an RPM or a damage number.
 *   - Weapon *behaviour* is pure functions of (definition, state, injected
 *     time). Nothing here reads a clock and nothing here calls Math.random, so
 *     a failing test fails the same way on every re-run.
 *
 * DECISION (the one T-1.17 asks to make before implementing). §2.3 exempts
 * weapon spread from client/server parity *if* the client draws tracers from
 * the server hit event rather than predicting them. We implement the
 * deterministic path anyway, because with T-0.14 already shipped it costs
 * nothing: the spread seed is integer-hashed from (tick, entityId, shotIndex,
 * pelletIndex) and the cone offset goes through the table trig, so both sides
 * compute the same vector from numbers they already have, with nothing on the
 * wire. That keeps predicted tracers available as a later tuning choice instead
 * of closing the door on them. It is a free option, not a parity obligation:
 * the bound still belongs in a test fixture, never in this file.
 *
 * Spread is quantised to whole binary-angle units (1/4096 turn ~= 0.088 deg).
 * That is what makes it exact across engines — an integer index into the trig
 * table, not a transcendental. The visible cost is granularity: a 0.05 deg
 * marksman ADS cone rounds to zero and fires dead centre, which is the intended
 * behaviour for that weapon anyway.
 */
import { ANGLE_MASK, ANGLE_UNITS, type BinAngle, wrapAngle } from '../math/angles.ts';
import { seedFrom, unitFromSeed } from '../math/prng.ts';
import { cos, sin } from '../math/trig.ts';
import RAW_WEAPONS from '../data/weapons.json' with { type: 'json' };

export interface WeaponDef {
  id: string;
  name: string;
  /** Rounds per minute. Cadence is 60 / rpm seconds between shots. */
  rpm: number;
  /** Damage per pellet at or inside `falloffStartM`. */
  damage: number;
  /** Pellets per trigger pull. 1 for rifles; the shotgun fires a group. */
  pellets: number;
  /** Cone half-angles, in degrees for authoring. Converted once, below. */
  hipSpreadDeg: number;
  adsSpreadDeg: number;
  /** Bloom added per shot fired, and the ceiling it clamps to. */
  bloomPerShotDeg: number;
  maxSpreadDeg: number;
  /** Bloom recovery while not firing. */
  bloomDecayDegPerSec: number;
  /** Full damage within start; `falloffMinFraction` of it beyond end. */
  falloffStartM: number;
  falloffEndM: number;
  falloffMinFraction: number;
  /** Beyond this the ray stops; it cannot hit. */
  maxRangeM: number;
  magSize: number;
  reloadSeconds: number;
  /**
   * Full auto: holding the trigger keeps firing at the weapon's cadence.
   * Semi-auto weapons need a fresh trigger pull per shot, which is a real
   * balance lever (the marksman's 180 rpm means nothing if you can hold it
   * down), not a presentation detail — so it lives in data with the rest.
   */
  auto: boolean;
  /**
   * Recoil (T-2.08): what one shot does to the VIEW, in degrees. Never to the
   * server's ray — the next shot fires wherever the kicked view then points,
   * and the server already resolves that. Kick is straight up; drift is
   * sideways with a seeded sign per shot so a burst walks a pattern the player
   * can learn; the total is capped; recovery is an exponential rate in
   * reciprocal seconds; aiming scales the kick by `recoilAdsScale`.
   */
  recoilKickDeg: number;
  recoilDriftDeg: number;
  recoilMaxDeg: number;
  recoilRecoveryPerSec: number;
  recoilAdsScale: number;
  /**
   * Camera shake (T-2.09): the jolt one shot gives the PICTURE, as a
   * positional amplitude in metres and a roll in degrees. Distinct from
   * recoil, which moves the aim; shake never does. Scaled by
   * `recoilAdsScale` while aiming, like recoil.
   */
  shakePosM: number;
  shakeRollDeg: number;
}

/**
 * Whether the trigger state permits a shot this tick. Cadence, magazine and
 * reload are `tryFire`'s job; this is only the auto/semi distinction, kept
 * separate so the caller can own trigger edge detection (the client latches it
 * per tick, exactly as it latches jump — a click shorter than 33 ms must not
 * fall between two samples).
 */
export function allowsFire(def: WeaponDef, triggerHeld: boolean, triggerEdge: boolean): boolean {
  return def.auto ? triggerHeld : triggerEdge;
}

/** Seconds between shots. */
export function shotIntervalSeconds(def: WeaponDef): number {
  return 60 / def.rpm;
}

/**
 * Degrees to binary angle units. Math.round and division are exactly specified
 * by IEEE-754, so this is deterministic; it is the transcendental *functions*
 * that are not (ADR-014).
 */
export function degToAngle(deg: number): number {
  return Math.round((deg / 360) * ANGLE_UNITS);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Hand-written rather than zod. §0.3 rule 4 asks for JSON validated by a
 * schema; rule 3 forbids a new runtime dependency without an ADR, and zod would
 * be one — in `shared`, which ships to every client. Flagged rather than
 * silently decided: if zod is wanted here, it needs an ADR line first and this
 * function is the only thing that has to change.
 */
class WeaponDataError extends Error {}

function num(row: Record<string, unknown>, key: string, id: string, min: number, max: number): number {
  const v = row[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new WeaponDataError(`weapon "${id}": ${key} must be a finite number, got ${String(v)}`);
  }
  if (v < min || v > max) {
    throw new WeaponDataError(`weapon "${id}": ${key} must be in [${min}, ${max}], got ${v}`);
  }
  return v;
}

function bool(row: Record<string, unknown>, key: string, id: string): boolean {
  const v = row[key];
  if (typeof v !== 'boolean') {
    throw new WeaponDataError(`weapon "${id}": ${key} must be a boolean, got ${String(v)}`);
  }
  return v;
}

function str(row: Record<string, unknown>, key: string, id: string): string {
  const v = row[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new WeaponDataError(`weapon "${id}": ${key} must be a non-empty string`);
  }
  return v;
}

function parseWeaponDef(key: string, raw: unknown): WeaponDef {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new WeaponDataError(`weapon "${key}": expected an object`);
  }
  const row = raw as Record<string, unknown>;
  const id = str(row, 'id', key);
  if (id !== key) throw new WeaponDataError(`weapon "${key}": id field says "${id}"`);

  const def: WeaponDef = {
    id,
    name: str(row, 'name', key),
    rpm: num(row, 'rpm', key, 1, 3000),
    damage: num(row, 'damage', key, 0, 1000),
    pellets: num(row, 'pellets', key, 1, 64),
    hipSpreadDeg: num(row, 'hipSpreadDeg', key, 0, 45),
    adsSpreadDeg: num(row, 'adsSpreadDeg', key, 0, 45),
    bloomPerShotDeg: num(row, 'bloomPerShotDeg', key, 0, 45),
    maxSpreadDeg: num(row, 'maxSpreadDeg', key, 0, 45),
    bloomDecayDegPerSec: num(row, 'bloomDecayDegPerSec', key, 0, 180),
    falloffStartM: num(row, 'falloffStartM', key, 0, 1000),
    falloffEndM: num(row, 'falloffEndM', key, 0, 1000),
    falloffMinFraction: num(row, 'falloffMinFraction', key, 0, 1),
    maxRangeM: num(row, 'maxRangeM', key, 1, 2000),
    magSize: num(row, 'magSize', key, 1, 500),
    reloadSeconds: num(row, 'reloadSeconds', key, 0, 60),
    auto: bool(row, 'auto', key),
    recoilKickDeg: num(row, 'recoilKickDeg', key, 0, 30),
    recoilDriftDeg: num(row, 'recoilDriftDeg', key, 0, 30),
    recoilMaxDeg: num(row, 'recoilMaxDeg', key, 0, 60),
    recoilRecoveryPerSec: num(row, 'recoilRecoveryPerSec', key, 0.1, 100),
    recoilAdsScale: num(row, 'recoilAdsScale', key, 0, 1),
    shakePosM: num(row, 'shakePosM', key, 0, 0.5),
    shakeRollDeg: num(row, 'shakeRollDeg', key, 0, 10),
  };

  if (!Number.isInteger(def.pellets)) throw new WeaponDataError(`weapon "${key}": pellets must be an integer`);
  if (!Number.isInteger(def.magSize)) throw new WeaponDataError(`weapon "${key}": magSize must be an integer`);
  if (def.falloffEndM < def.falloffStartM) {
    throw new WeaponDataError(`weapon "${key}": falloffEndM (${def.falloffEndM}) is before falloffStartM (${def.falloffStartM})`);
  }
  if (def.maxSpreadDeg < def.hipSpreadDeg) {
    throw new WeaponDataError(`weapon "${key}": maxSpreadDeg (${def.maxSpreadDeg}) is below hipSpreadDeg (${def.hipSpreadDeg})`);
  }
  if (def.adsSpreadDeg > def.hipSpreadDeg) {
    throw new WeaponDataError(`weapon "${key}": adsSpreadDeg (${def.adsSpreadDeg}) exceeds hipSpreadDeg (${def.hipSpreadDeg})`);
  }
  if (def.recoilMaxDeg < def.recoilKickDeg) {
    throw new WeaponDataError(`weapon "${key}": recoilMaxDeg (${def.recoilMaxDeg}) is below recoilKickDeg (${def.recoilKickDeg}) — one shot would exceed the cap`);
  }
  return def;
}

/** Validate a whole weapon table. Throws on the first bad row, naming it. */
export function parseWeaponTable(raw: unknown): Record<string, WeaponDef> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new WeaponDataError('weapon table: expected an object keyed by weapon id');
  }
  const out: Record<string, WeaponDef> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[key] = parseWeaponDef(key, value);
  }
  if (Object.keys(out).length === 0) throw new WeaponDataError('weapon table: empty');
  return out;
}

/**
 * Wire order for weapon selection. The index is what travels in a Fire message,
 * so this order is part of the protocol: reordering it silently reassigns every
 * client's weapons and is a PROTOCOL_VERSION bump.
 */
export const WEAPON_IDS = ['carbine', 'marksman', 'breacher', 'sidearm'] as const;

/** The shipped table, validated at import so bad data fails loudly at boot. */
export const WEAPONS: Readonly<Record<string, WeaponDef>> = Object.freeze(parseWeaponTable(RAW_WEAPONS));

export function getWeapon(id: string): WeaponDef {
  const def = WEAPONS[id];
  if (def === undefined) throw new WeaponDataError(`unknown weapon id "${id}"`);
  return def;
}

// ---------------------------------------------------------------------------
// Spread
// ---------------------------------------------------------------------------

export interface Dir3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Aim direction for a yaw/pitch pair, matching the yaw convention of
 * `dirFromYaw` (T-1.12): +Z is forward at yaw 0.
 */
export function dirFromYawPitch(yaw: BinAngle, pitch: BinAngle): Dir3 {
  const y = wrapAngle(yaw);
  const p = wrapAngle(pitch);
  const cp = cos(p);
  return { x: sin(y) * cp, y: sin(p), z: cos(y) * cp };
}

/**
 * Seed for one pellet of one shot. Stateless on purpose: the client can compute
 * it from the tick and its own entity id without the server sending anything.
 */
export function pelletSeed(tick: number, entityId: number, shotIndex: number, pelletIndex: number): number {
  return seedFrom(tick, entityId, shotIndex, pelletIndex);
}

/**
 * One pellet's direction: the aim direction pushed off-axis by a uniformly
 * sampled point in a disc of `coneUnits` half-angle.
 *
 * `Math.sqrt` gives the uniform-disc radius and is exactly specified by
 * IEEE-754 — it is deliberately not on the banned list. The offset is applied
 * as integer yaw/pitch deltas rather than a true tangent-plane rotation; at the
 * pitch range the camera allows (T-1.11) the difference is far below the
 * 0.088 deg angle quantum, and it keeps every step on the exact integer path.
 */
export function pelletDirection(yaw: BinAngle, pitch: BinAngle, coneUnits: number, seed: number): Dir3 {
  if (coneUnits <= 0) return dirFromYawPitch(yaw, pitch);
  const u1 = unitFromSeed(seedFrom(seed, 0x5f1e));
  const u2 = unitFromSeed(seedFrom(seed, 0x2b7d));
  const theta = Math.floor(u1 * ANGLE_UNITS) & ANGLE_MASK;
  const radius = coneUnits * Math.sqrt(u2);
  const dYaw = Math.round(radius * sin(theta));
  const dPitch = Math.round(radius * cos(theta));
  return dirFromYawPitch(yaw + dYaw, pitch + dPitch);
}

// ---------------------------------------------------------------------------
// Damage falloff
// ---------------------------------------------------------------------------

/**
 * Damage for one pellet at `distanceM`. Full damage inside the falloff start,
 * a linear ramp to `falloffMinFraction` at the end, flat beyond, and zero past
 * `maxRangeM` where the ray no longer reaches.
 */
export function damageAtDistance(def: WeaponDef, distanceM: number): number {
  if (!Number.isFinite(distanceM) || distanceM < 0) return 0;
  if (distanceM > def.maxRangeM) return 0;
  if (distanceM <= def.falloffStartM) return def.damage;
  const span = def.falloffEndM - def.falloffStartM;
  if (span <= 0 || distanceM >= def.falloffEndM) return def.damage * def.falloffMinFraction;
  const t = (distanceM - def.falloffStartM) / span;
  return def.damage * (1 - t * (1 - def.falloffMinFraction));
}

// ---------------------------------------------------------------------------
// Firing state
// ---------------------------------------------------------------------------

export interface WeaponState {
  ammo: number;
  /** Earliest time the next shot may leave the barrel. */
  nextShotAt: number;
  /** Time the in-progress reload completes, or 0 when not reloading. */
  reloadEndsAt: number;
  /** Current bloom above the base cone, in binary angle units. */
  bloomUnits: number;
  /** Monotonic shot counter; feeds the spread seed so no two shots match. */
  shotIndex: number;
}

export function createWeaponState(def: WeaponDef): WeaponState {
  return { ammo: def.magSize, nextShotAt: 0, reloadEndsAt: 0, bloomUnits: 0, shotIndex: 0 };
}

export function isReloading(state: WeaponState, now: number): boolean {
  return state.reloadEndsAt > now;
}

/** Current cone half-angle in binary angle units, base plus accumulated bloom. */
export function currentConeUnits(def: WeaponDef, state: WeaponState, ads: boolean): number {
  const base = degToAngle(ads ? def.adsSpreadDeg : def.hipSpreadDeg);
  const max = degToAngle(def.maxSpreadDeg);
  const cone = base + state.bloomUnits;
  return cone > max ? max : cone;
}

/** Bloom recovery. Call once per tick with the tick's dt; never with a clock read. */
export function decayBloom(def: WeaponDef, state: WeaponState, dt: number): void {
  const recovered = state.bloomUnits - degToAngle(def.bloomDecayDegPerSec) * dt;
  state.bloomUnits = recovered > 0 ? recovered : 0;
}

export function startReload(def: WeaponDef, state: WeaponState, now: number): boolean {
  if (isReloading(state, now) || state.ammo >= def.magSize) return false;
  state.reloadEndsAt = now + def.reloadSeconds;
  return true;
}

/** Complete a reload whose end time has passed. Idempotent. */
export function finishReload(def: WeaponDef, state: WeaponState, now: number): void {
  if (state.reloadEndsAt !== 0 && state.reloadEndsAt <= now) {
    state.ammo = def.magSize;
    state.reloadEndsAt = 0;
  }
}

export interface Shot {
  /** Monotonic index of this shot for the firing entity; feeds the seed. */
  shotIndex: number;
  /** Cone half-angle the shot left the barrel with, in binary angle units. */
  coneUnits: number;
}

/**
 * Attempt to fire. Returns the shot, or null if the weapon is reloading, on
 * cadence cooldown, or empty. Mutates `state`.
 *
 * `now` is injected: nothing in here reads a clock, which is what makes cadence
 * and reload behaviour exactly testable.
 */
export function tryFire(
  def: WeaponDef,
  state: WeaponState,
  now: number,
  ads: boolean,
): Shot | null {
  finishReload(def, state, now);
  if (isReloading(state, now)) return null;
  if (now < state.nextShotAt) return null;
  if (state.ammo <= 0) return null;

  const coneUnits = currentConeUnits(def, state, ads);
  const shotIndex = state.shotIndex;
  state.ammo -= 1;
  state.shotIndex += 1;
  state.nextShotAt = now + shotIntervalSeconds(def);
  state.bloomUnits += degToAngle(def.bloomPerShotDeg);

  return { shotIndex, coneUnits };
}

/**
 * Pellet directions for a shot. Split from `tryFire` so the caller supplies the
 * aim it wants: lag compensation (T-1.18) resolves the same shot against a
 * rewound world without re-running the cadence state machine.
 */
export function shotDirections(
  def: WeaponDef,
  shot: Shot,
  entityId: number,
  tick: number,
  yaw: BinAngle,
  pitch: BinAngle,
): Dir3[] {
  const out: Dir3[] = [];
  for (let i = 0; i < def.pellets; i += 1) {
    out.push(pelletDirection(yaw, pitch, shot.coneUnits, pelletSeed(tick, entityId, shot.shotIndex, i)));
  }
  return out;
}
