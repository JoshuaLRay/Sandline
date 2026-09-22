/**
 * Ballistic projectiles (T-2.30, E-2.5).
 *
 * A grenade and a rocket are the first things in this game that are neither a
 * ray nor a soldier: they take TIME to arrive, they bounce, and what they hurt
 * is decided by where they end up rather than by where they were pointed. This
 * file is all of that, and nothing else — no entity, no wire, no scene.
 *
 * DATA, THEN BEHAVIOUR, exactly as `weapons.ts` splits them. Definitions come
 * from `../data/projectiles.json` and are validated once at import; behaviour
 * is pure functions of (definition, state, dt, world), with time injected and
 * no clock read anywhere, so a two-and-a-half second fuse is tested in
 * microseconds.
 *
 * NO RAPIER, DELIBERATELY. ADR-005's 2026-09-19 addendum named projectiles as
 * Rapier's; its 2026-09-21 addendum amends that for this epic and says why, so
 * this is an amended decision rather than a quietly substituted one. The short
 * version: the player aims a grenade by the ARC THEY ARE SHOWN, so the preview
 * and the authoritative flight have to be the same arithmetic over the same
 * box list — the one-list rule `world.ts` was written for — and a sphere
 * against axis-aligned boxes with gravity, restitution and friction is a few
 * lines of it. Rapier would put a WASM world in the preview path to get a
 * different answer. Ragdolls and debris, which nothing has to agree about,
 * remain Rapier's.
 *
 * NOT PREDICTED, THOUGH IT LOOKS LIKE IT (§2.3). The server owns every
 * projectile: where it is, when it goes off, and who it hurts. A client may
 * draw the arc it expects from these same functions, and that drawing settles
 * nothing — the same split T-1.17 made between a predicted tracer and an
 * authoritative hit. Determinism is therefore not load-bearing here the way it
 * is in the character controller; it is simply free, since everything below is
 * arithmetic, comparison and `Math.sqrt`, and the launch direction goes
 * through the table trig like every other angle in this package.
 *
 * COLLISION IS A SWEEP, NEVER A TEST AT THE NEW POSITION. A rocket covers 1.5 m
 * in a tick and a grenade lands on a 5 cm rail: point-sampling the end of the
 * step would put both straight through the world some of the time, and "some
 * of the time" is the worst kind of bug to be handed by a playtester. Each
 * step sweeps the projectile's sphere along the chord it travels
 * (`rayWorld`'s `inflate`), so nothing is ever tunnelled through.
 */
import RAW_PROJECTILES from '../data/projectiles.json' with { type: 'json' };
import type { BinAngle } from '../math/angles.ts';
import type { Vec3 } from '../net/prediction.ts';
import { dirFromYawPitch, degToAngle } from './weapons.ts';
import { DEFAULT_WORLD, type WorldBox, rayWorld } from './world.ts';

/**
 * How a projectile behaves when it arrives. `thrown` bounces and goes off on a
 * fuse; `rocket` flies flat and goes off on the first thing it touches.
 */
export type ProjectileKind = 'thrown' | 'rocket';

export interface ProjectileDef {
  id: string;
  name: string;
  kind: ProjectileKind;
  /** Launch speed along the aim, metres per second. */
  speedMPerSec: number;
  /** Added to the aim pitch at launch, so a level throw still arcs. */
  loftDeg: number;
  /** Downward acceleration. A rocket under thrust sags less than a grenade. */
  gravity: number;
  /** Linear air drag as a fraction of speed shed per second. */
  dragPerSec: number;
  /** Collision radius: the sphere that is swept along each step. */
  radiusM: number;
  /** Fraction of the normal speed kept through a bounce. */
  restitution: number;
  /** Fraction of the tangential speed SHED by a bounce: 1 stops a skid dead. */
  friction: number;
  /**
   * Speed shed per second while SKIDDING along a floor it has settled on,
   * as a fraction of the remaining speed. Separate from `friction` because a
   * bounce and a roll are different events on different clocks: one number
   * for both makes a grenade that stops dead on landing or one that skates
   * across the range, depending on which of the two you tuned last.
   */
  rollDragPerSec: number;
  /** Seconds from launch to detonation; 0 for a projectile with no fuse. */
  fuseSeconds: number;
  /** Detonate on the first surface struck, rather than bouncing off it. */
  detonateOnImpact: boolean;
  /** Backstop: a projectile that has neither hit nor fused goes off here. */
  maxLifeSeconds: number;
  /** Blast geometry and damage (see `blastDamageAt`). */
  blastRadiusM: number;
  blastDamage: number;
  /** Fraction of the damage still dealt at the very edge of the radius. */
  blastMinFraction: number;
  /** What a target takes with the whole body behind cover (see `blastExposure`). */
  blastCoverFraction: number;
  /** How many a soldier carries. */
  carried: number;
  /** Minimum seconds between two of these leaving the same hand. */
  cooldownSeconds: number;
}

/**
 * Wire order for projectile selection, as `WEAPON_IDS` is for weapons: the
 * index is what travels in a Throw message and in the `Projectile` component,
 * so reordering this is a PROTOCOL_VERSION bump.
 */
export const PROJECTILE_IDS = ['frag', 'rocket'] as const;

/**
 * Where projectile netIds start (T-2.31).
 *
 * Clear of the six player slots, which are handed out from 1, and clear of the
 * range targets at 1000, which is why `isRangeTarget` became a bounded test
 * when this arrived. A projectile's id is never reused within a session: a
 * recycled one arriving at a client that still holds the old grenade would be
 * a grenade that teleports, which is exactly what NetId exists to prevent.
 */
export const FIRST_PROJECTILE_NET_ID = 2000;
export type ProjectileId = (typeof PROJECTILE_IDS)[number];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Hand-written for the reason `weapons.ts` gives: zod would be a new runtime dep. */
class ProjectileDataError extends Error {}

function num(row: Record<string, unknown>, key: string, id: string, min: number, max: number): number {
  const v = row[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ProjectileDataError(`projectile "${id}": ${key} must be a finite number, got ${String(v)}`);
  }
  if (v < min || v > max) {
    throw new ProjectileDataError(`projectile "${id}": ${key} must be in [${min}, ${max}], got ${v}`);
  }
  return v;
}

function bool(row: Record<string, unknown>, key: string, id: string): boolean {
  const v = row[key];
  if (typeof v !== 'boolean') {
    throw new ProjectileDataError(`projectile "${id}": ${key} must be a boolean, got ${String(v)}`);
  }
  return v;
}

function str(row: Record<string, unknown>, key: string, id: string): string {
  const v = row[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new ProjectileDataError(`projectile "${id}": ${key} must be a non-empty string`);
  }
  return v;
}

function parseProjectileDef(key: string, raw: unknown): ProjectileDef {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ProjectileDataError(`projectile "${key}": expected an object`);
  }
  const row = raw as Record<string, unknown>;
  const id = str(row, 'id', key);
  if (id !== key) throw new ProjectileDataError(`projectile "${key}": id field says "${id}"`);
  const kind = str(row, 'kind', key);
  if (kind !== 'thrown' && kind !== 'rocket') {
    throw new ProjectileDataError(`projectile "${key}": kind must be "thrown" or "rocket", got "${kind}"`);
  }

  const def: ProjectileDef = {
    id,
    name: str(row, 'name', key),
    kind,
    speedMPerSec: num(row, 'speedMPerSec', key, 1, 300),
    loftDeg: num(row, 'loftDeg', key, -45, 45),
    gravity: num(row, 'gravity', key, 0, 30),
    dragPerSec: num(row, 'dragPerSec', key, 0, 5),
    radiusM: num(row, 'radiusM', key, 0.01, 1),
    restitution: num(row, 'restitution', key, 0, 1),
    friction: num(row, 'friction', key, 0, 1),
    rollDragPerSec: num(row, 'rollDragPerSec', key, 0, 20),
    fuseSeconds: num(row, 'fuseSeconds', key, 0, 30),
    detonateOnImpact: bool(row, 'detonateOnImpact', key),
    maxLifeSeconds: num(row, 'maxLifeSeconds', key, 0.1, 60),
    blastRadiusM: num(row, 'blastRadiusM', key, 0.1, 50),
    blastDamage: num(row, 'blastDamage', key, 0, 1000),
    blastMinFraction: num(row, 'blastMinFraction', key, 0, 1),
    blastCoverFraction: num(row, 'blastCoverFraction', key, 0, 1),
    carried: num(row, 'carried', key, 0, 99),
    cooldownSeconds: num(row, 'cooldownSeconds', key, 0, 60),
  };

  if (!Number.isInteger(def.carried)) throw new ProjectileDataError(`projectile "${key}": carried must be an integer`);
  if (def.fuseSeconds === 0 && !def.detonateOnImpact) {
    throw new ProjectileDataError(
      `projectile "${key}": with no fuse and no impact detonation it can only die of old age`,
    );
  }
  if (def.fuseSeconds > def.maxLifeSeconds) {
    throw new ProjectileDataError(
      `projectile "${key}": fuseSeconds (${def.fuseSeconds}) is past maxLifeSeconds (${def.maxLifeSeconds})`,
    );
  }
  return def;
}

/** Validate a whole projectile table. Throws on the first bad row, naming it. */
export function parseProjectileTable(raw: unknown): Record<string, ProjectileDef> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ProjectileDataError('projectile table: expected an object keyed by projectile id');
  }
  const out: Record<string, ProjectileDef> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[key] = parseProjectileDef(key, value);
  }
  for (const id of PROJECTILE_IDS) {
    if (out[id] === undefined) throw new ProjectileDataError(`projectile table: "${id}" is on the wire and missing`);
  }
  return out;
}

/** The shipped table, validated at import so bad data fails loudly at boot. */
export const PROJECTILES: Readonly<Record<string, ProjectileDef>> = Object.freeze(
  parseProjectileTable(RAW_PROJECTILES),
);

export function getProjectile(id: string): ProjectileDef {
  const def = PROJECTILES[id];
  if (def === undefined) throw new ProjectileDataError(`unknown projectile id "${id}"`);
  return def;
}

/** The definition an index on the wire refers to, or null when out of range. */
export function projectileByIndex(index: number): ProjectileDef | null {
  const id = PROJECTILE_IDS[index];
  return id === undefined ? null : getProjectile(id);
}

// ---------------------------------------------------------------------------
// Flight
// ---------------------------------------------------------------------------

export interface ProjectileState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds since launch. The fuse is a comparison against this. */
  age: number;
  /** Surfaces struck so far. */
  bounces: number;
  /** Come to rest on a floor: it stays where it is until the fuse ends it. */
  resting: boolean;
}

/** What a step did. `detonation` is set on the step that ends the projectile. */
export type ProjectileOutcome = 'flying' | 'bounced' | 'resting' | 'detonated';

export interface ProjectileImpact {
  /** The point on the SURFACE, one radius in from the sphere's centre. */
  point: Vec3;
  /** Outward face normal, axis-aligned; (0, 1, 0) for the ground plane. */
  normal: Vec3;
  /** The box struck, or null for the ground plane, which is not a box. */
  box: WorldBox | null;
}

export interface ProjectileStep {
  state: ProjectileState;
  outcome: ProjectileOutcome;
  /** The chord travelled this step, for a caller with colliders of its own. */
  from: Vec3;
  to: Vec3;
  /** The first surface struck this step, or null. */
  impact: ProjectileImpact | null;
  /** Set on the step the projectile goes off, with the reason it did. */
  detonation: { point: Vec3; reason: 'fuse' | 'impact' | 'life' } | null;
}

export interface ProjectileWorld {
  boxes: readonly WorldBox[];
  /** The ground plane, which is not in the box list and stops everything. */
  groundY: number;
}

export const DEFAULT_PROJECTILE_WORLD: ProjectileWorld = { boxes: DEFAULT_WORLD, groundY: 0 };

/**
 * Collisions resolved within one tick. A grenade landing in a corner can take
 * two; three is generous, and the bound is what guarantees this function
 * returns rather than trading bounces with a wall forever.
 */
export const MAX_COLLISIONS_PER_STEP = 3;

/** Below this, a projectile on a floor is lying still rather than rolling. */
export const REST_SPEED_M_PER_SEC = 0.55;

/** How level a face must be to be a floor something can rest on. */
const FLOOR_NORMAL_Y = 0.7;

/** Lifted off the surface by this much after a bounce, so it cannot re-hit it. */
const SURFACE_EPSILON_M = 1e-4;

export function createProjectileState(origin: Vec3, velocity: Vec3): ProjectileState {
  return {
    x: origin.x,
    y: origin.y,
    z: origin.z,
    vx: velocity.x,
    vy: velocity.y,
    vz: velocity.z,
    age: 0,
    bounces: 0,
    resting: false,
  };
}

/**
 * Launch velocity for an aim: the aim direction, lofted by the definition's
 * own angle, at the definition's speed. Table trig, so every client and the
 * server compute the same vector from the same two integers.
 */
export function launchVelocity(def: ProjectileDef, yaw: BinAngle, pitch: BinAngle): Vec3 {
  const dir = dirFromYawPitch(yaw, pitch + degToAngle(def.loftDeg));
  return { x: dir.x * def.speedMPerSec, y: dir.y * def.speedMPerSec, z: dir.z * def.speedMPerSec };
}

/**
 * Where a projectile leaves the hand: ahead of the eye along the aim, clear of
 * the thrower's own body — and no further than the first thing in the way.
 *
 * The clamp is the whole point of putting this here rather than writing the
 * three multiplications at the call site. Half a metre ahead of the eye is
 * inside the wall when you are standing against one, and a projectile that
 * begins inside a box is the one case `stepProjectile` cannot resolve: there
 * is no face to bounce off. Sweeping the same sphere over the same half metre
 * means the worst case is a grenade that goes off in your face, which is the
 * correct outcome for throwing one into a wall you are touching.
 */
export function launchOrigin(
  def: ProjectileDef,
  eye: Vec3,
  direction: Vec3,
  aheadM: number,
  world: ProjectileWorld = DEFAULT_PROJECTILE_WORLD,
): Vec3 {
  let ahead = aheadM;
  const blocked = rayWorld({ origin: eye, direction, maxDistance: aheadM }, world.boxes, def.radiusM);
  if (blocked !== null && blocked.distance < ahead) ahead = blocked.distance;
  const floor = world.groundY + def.radiusM;
  const y = eye.y + direction.y * ahead;
  return {
    x: eye.x + direction.x * ahead,
    y: y < floor ? floor : y,
    z: eye.z + direction.z * ahead,
  };
}

function sphereGroundDistance(from: Vec3, dir: Vec3, groundY: number, radiusM: number, maxDistance: number): number | null {
  const floor = groundY + radiusM;
  if (from.y <= floor) return dir.y < 0 ? 0 : null;
  if (dir.y >= 0) return null;
  const distance = (from.y - floor) / -dir.y;
  return distance <= maxDistance ? distance : null;
}

/**
 * Advance one projectile by `dt`.
 *
 * The step is integrated as a parabola — `p + v·dt - ½g·dt²`, the closed form
 * the shells in `effects.ts` already fly on — and then COLLIDED as the straight
 * chord between the two ends. That is the standard approximation and worth
 * stating: over a 33 ms tick the chord departs from the arc by under a
 * millimetre at these speeds, which is an order of magnitude inside the
 * collision radius.
 *
 * A bounce splits the step: the projectile reaches the surface, reflects, and
 * the rest of the tick is spent on the new heading. Without that a grenade
 * would lose whatever was left of its tick on every bounce and come to rest
 * far too eagerly, which reads as the world being made of glue.
 */
export function stepProjectile(
  def: ProjectileDef,
  state: ProjectileState,
  dt: number,
  world: ProjectileWorld = DEFAULT_PROJECTILE_WORLD,
): ProjectileStep {
  const next: ProjectileState = { ...state };
  const from: Vec3 = { x: state.x, y: state.y, z: state.z };
  let impact: ProjectileImpact | null = null;
  let outcome: ProjectileOutcome = state.resting ? 'resting' : 'flying';

  let remaining = dt > 0 ? dt : 0;
  let collisions = 0;
  while (!next.resting && remaining > 0 && collisions < MAX_COLLISIONS_PER_STEP) {
    const segment = remaining;
    const ay = -def.gravity;
    const endX = next.x + next.vx * segment;
    const endY = next.y + next.vy * segment + 0.5 * ay * segment * segment;
    const endZ = next.z + next.vz * segment;
    const dx = endX - next.x;
    const dy = endY - next.y;
    const dz = endZ - next.z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (length <= 0) {
      next.vy += ay * segment;
      remaining = 0;
      break;
    }

    const dir: Vec3 = { x: dx / length, y: dy / length, z: dz / length };
    const box = rayWorld({ origin: { x: next.x, y: next.y, z: next.z }, direction: dir, maxDistance: length }, world.boxes, def.radiusM);
    const ground = sphereGroundDistance({ x: next.x, y: next.y, z: next.z }, dir, world.groundY, def.radiusM, length);
    const boxDistance = box === null ? Infinity : box.distance;
    const groundDistance = ground === null ? Infinity : ground;
    const distance = boxDistance < groundDistance ? boxDistance : groundDistance;

    if (!Number.isFinite(distance)) {
      // Clear air for the whole segment: take the parabola's own endpoint
      // rather than walking along the chord, so a long flight is the exact arc.
      next.x = endX;
      next.y = endY;
      next.z = endZ;
      next.vy += ay * segment;
      applyDrag(def, next, segment);
      remaining = 0;
      break;
    }

    const normal: Vec3 =
      boxDistance <= groundDistance && box !== null ? box.normal : { x: 0, y: 1, z: 0 };
    const consumed = (distance / length) * segment;
    next.x += dir.x * distance + normal.x * SURFACE_EPSILON_M;
    next.y += dir.y * distance + normal.y * SURFACE_EPSILON_M;
    next.z += dir.z * distance + normal.z * SURFACE_EPSILON_M;
    next.vy += ay * consumed;
    applyDrag(def, next, consumed);
    next.bounces += 1;
    collisions += 1;
    remaining -= consumed;
    if (impact === null) {
      impact = {
        point: {
          x: next.x - normal.x * (def.radiusM + SURFACE_EPSILON_M),
          y: next.y - normal.y * (def.radiusM + SURFACE_EPSILON_M),
          z: next.z - normal.z * (def.radiusM + SURFACE_EPSILON_M),
        },
        normal,
        box: boxDistance <= groundDistance && box !== null ? box.box : null,
      };
    }
    outcome = 'bounced';

    /**
     * A ray that began inside a box has no entry face and comes back with a
     * zero normal (`rayWorld`). Nothing should ever put a projectile there,
     * but a zero normal reflects to nothing and the loop would spend its
     * whole budget re-hitting the same box, so it stops dead instead of
     * pretending.
     */
    if (normal.x === 0 && normal.y === 0 && normal.z === 0) {
      next.vx = 0;
      next.vy = 0;
      next.vz = 0;
      next.resting = true;
      break;
    }

    if (def.detonateOnImpact) {
      next.vx = 0;
      next.vy = 0;
      next.vz = 0;
      remaining = 0;
      break;
    }

    /**
     * A DEAD bounce on a floor is a landing, not a bounce.
     *
     * Without this branch it is the loop's worst case: the sphere sits a
     * hair above the ground with no vertical speed left, gravity dips the
     * next chord below the floor, and every substep resolves another contact
     * at distance zero until the budget runs out — a grenade that stops dead
     * the instant it lands, however hard it was thrown along the ground.
     * So once the rebound would be slower than the rest threshold, the floor
     * simply holds it up and the rest of the tick is a SKID: tangential
     * motion with friction as a rate, stopped by whatever it runs into.
     */
    const approach = -(next.vx * normal.x + next.vy * normal.y + next.vz * normal.z);
    if (normal.y >= FLOOR_NORMAL_Y && approach * def.restitution < REST_SPEED_M_PER_SEC) {
      const vn = next.vx * normal.x + next.vy * normal.y + next.vz * normal.z;
      next.vx -= vn * normal.x;
      next.vy -= vn * normal.y;
      next.vz -= vn * normal.z;
      const skid = slideAlongSurface(def, next, remaining, world);
      if (impact === null && skid !== null) impact = skid;
      remaining = 0;
      if (speedOf(next) < REST_SPEED_M_PER_SEC) {
        next.vx = 0;
        next.vy = 0;
        next.vz = 0;
        next.resting = true;
        outcome = 'resting';
      }
      break;
    }

    reflect(def, next, normal);
    if (normal.y >= FLOOR_NORMAL_Y && speedOf(next) < REST_SPEED_M_PER_SEC) {
      next.vx = 0;
      next.vy = 0;
      next.vz = 0;
      next.resting = true;
      outcome = 'resting';
    }
  }

  next.age = state.age + (dt > 0 ? dt : 0);

  const to: Vec3 = { x: next.x, y: next.y, z: next.z };
  let detonation: ProjectileStep['detonation'] = null;
  if (def.detonateOnImpact && impact !== null) {
    detonation = { point: impact.point, reason: 'impact' };
  } else if (def.fuseSeconds > 0 && next.age >= def.fuseSeconds) {
    detonation = { point: to, reason: 'fuse' };
  } else if (next.age >= def.maxLifeSeconds) {
    detonation = { point: to, reason: 'life' };
  }
  if (detonation !== null) outcome = 'detonated';

  return { state: next, outcome, from, to, impact, detonation };
}

function applyDrag(def: ProjectileDef, state: ProjectileState, seconds: number): void {
  if (def.dragPerSec <= 0 || seconds <= 0) return;
  const keep = 1 - def.dragPerSec * seconds;
  const scale = keep > 0 ? keep : 0;
  state.vx *= scale;
  state.vy *= scale;
  state.vz *= scale;
}

/**
 * Slide along the surface it has settled on for `seconds`, shedding speed at
 * `rollDragPerSec` — a rate, because a skid is not a bounce and the bounce's
 * own fraction applied thirty times a second would stop a grenade dead the
 * moment it landed. Anything the skid runs into stops it there.
 */
function slideAlongSurface(
  def: ProjectileDef,
  state: ProjectileState,
  seconds: number,
  world: ProjectileWorld,
): ProjectileImpact | null {
  const decay = 1 - def.rollDragPerSec * seconds;
  const keep = decay > 0 ? decay : 0;
  state.vx *= keep;
  state.vy *= keep;
  state.vz *= keep;
  const dx = state.vx * seconds;
  const dy = state.vy * seconds;
  const dz = state.vz * seconds;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (length <= 0) return null;
  const dir: Vec3 = { x: dx / length, y: dy / length, z: dz / length };
  const hit = rayWorld(
    { origin: { x: state.x, y: state.y, z: state.z }, direction: dir, maxDistance: length },
    world.boxes,
    def.radiusM,
  );
  if (hit === null) {
    state.x += dx;
    state.y += dy;
    state.z += dz;
    return null;
  }
  state.x += dir.x * hit.distance + hit.normal.x * SURFACE_EPSILON_M;
  state.y += dir.y * hit.distance + hit.normal.y * SURFACE_EPSILON_M;
  state.z += dir.z * hit.distance + hit.normal.z * SURFACE_EPSILON_M;
  // Whatever it slid into takes the speed out of that direction; a grenade
  // against a skirting board does not bounce back across the room.
  const vn = state.vx * hit.normal.x + state.vy * hit.normal.y + state.vz * hit.normal.z;
  state.vx -= vn * hit.normal.x;
  state.vy -= vn * hit.normal.y;
  state.vz -= vn * hit.normal.z;
  state.bounces += 1;
  return {
    point: {
      x: state.x - hit.normal.x * (def.radiusM + SURFACE_EPSILON_M),
      y: state.y - hit.normal.y * (def.radiusM + SURFACE_EPSILON_M),
      z: state.z - hit.normal.z * (def.radiusM + SURFACE_EPSILON_M),
    },
    normal: hit.normal,
    box: hit.box,
  };
}

function speedOf(state: ProjectileState): number {
  return Math.sqrt(state.vx * state.vx + state.vy * state.vy + state.vz * state.vz);
}

/**
 * Bounce: the normal component comes back scaled by restitution, the
 * tangential component is shed by friction. A ball is the normal half; a
 * grenade that skids realistically is the tangential half, and a shooter
 * notices the second one more than the first.
 */
function reflect(def: ProjectileDef, state: ProjectileState, normal: Vec3): void {
  const vn = state.vx * normal.x + state.vy * normal.y + state.vz * normal.z;
  const tx = state.vx - vn * normal.x;
  const ty = state.vy - vn * normal.y;
  const tz = state.vz - vn * normal.z;
  const keep = 1 - def.friction;
  const bounce = -vn * def.restitution;
  state.vx = tx * keep + normal.x * bounce;
  state.vy = ty * keep + normal.y * bounce;
  state.vz = tz * keep + normal.z * bounce;
}

// ---------------------------------------------------------------------------
// The arc a thrower is shown
// ---------------------------------------------------------------------------

export interface ArcOptions {
  /** Step used to walk the arc. The tick, so the preview is the server's path. */
  dt: number;
  /** Stop after this long, whatever the projectile is still doing. */
  maxSeconds: number;
  world?: ProjectileWorld;
}

export interface ProjectileArc {
  /** The path, launch point first, one entry per step until it ends. */
  points: Vec3[];
  /** Where it would go off, or null if the arc ran out of time first. */
  detonation: Vec3 | null;
  /** The first surface it would touch, or null. */
  impact: ProjectileImpact | null;
  /** Seconds of flight the arc covers. */
  seconds: number;
}

/**
 * Walk a projectile's whole flight without simulating anything.
 *
 * THE SAME `stepProjectile`, at the same dt, over the same world: an arc drawn
 * from a second, prettier integrator would be a picture of a throw the server
 * is not going to make, and the player aims by this line. It is still only a
 * picture — the throw that actually happens starts from the server's idea of
 * where the thrower stood, a fraction of a second later.
 */
export function projectileArc(
  def: ProjectileDef,
  origin: Vec3,
  velocity: Vec3,
  options: ArcOptions,
): ProjectileArc {
  const world = options.world ?? DEFAULT_PROJECTILE_WORLD;
  const dt = options.dt > 0 ? options.dt : 1 / 30;
  const points: Vec3[] = [{ x: origin.x, y: origin.y, z: origin.z }];
  let state = createProjectileState(origin, velocity);
  let impact: ProjectileImpact | null = null;
  let seconds = 0;
  /**
   * A COUNT of steps, not a running comparison against the horizon: fifteen
   * thirtieths is 0.49999999999999994, so `while (seconds < 0.5)` walks a
   * sixteenth step and the arc is a frame longer than it was asked for.
   */
  const steps = Math.max(1, Math.round(options.maxSeconds / dt));
  for (let i = 0; i < steps; i += 1) {
    const step = stepProjectile(def, state, dt, world);
    state = step.state;
    seconds += dt;
    points.push({ x: state.x, y: state.y, z: state.z });
    if (impact === null && step.impact !== null) impact = step.impact;
    if (step.detonation !== null) {
      return { points, detonation: step.detonation.point, impact, seconds };
    }
  }
  return { points, detonation: null, impact, seconds };
}

// ---------------------------------------------------------------------------
// Blast
// ---------------------------------------------------------------------------

/**
 * Damage at a distance from the centre of a blast: full inside a tenth of the
 * radius, a linear ramp to `blastMinFraction` at the edge, nothing beyond.
 *
 * Linear rather than the inverse square a physicist would want, for the reason
 * the weapon falloff curve is linear: a designer tunes two endpoints and a
 * player learns one rule. The flat core stops a hair of measurement error at
 * the centre from deciding whether a grenade at someone's feet downs them.
 */
export function blastDamageAt(def: ProjectileDef, distanceM: number): number {
  if (!Number.isFinite(distanceM) || distanceM < 0) return 0;
  if (distanceM >= def.blastRadiusM) return 0;
  const core = def.blastRadiusM * 0.1;
  if (distanceM <= core) return def.blastDamage;
  const t = (distanceM - core) / (def.blastRadiusM - core);
  return def.blastDamage * (1 - t * (1 - def.blastMinFraction));
}

/**
 * Where a blast is sampled up a target: shin, chest, head. Three probes, not
 * one, because a soldier crouched behind a crate has their head in the open
 * and a whole-body yes/no is the difference between cover mattering and cover
 * being a coin toss.
 */
export const BLAST_PROBE_FRACTIONS: readonly number[] = [0.1, 0.5, 0.9];

/**
 * How much of a target the blast can see, 0..1: the fraction of the probes
 * with a clear line from the centre.
 *
 * Deliberately not an integral over the body, and deliberately not a hitbox
 * test — the target's own capsule is not in the world list, so only scenery
 * can block. A proper solid-angle occlusion belongs with real levels; this is
 * three rays and it answers the question a grey box asks.
 */
export function blastExposure(
  centre: Vec3,
  feet: Vec3,
  heightM: number,
  world: readonly WorldBox[] = DEFAULT_WORLD,
  probes: readonly number[] = BLAST_PROBE_FRACTIONS,
): number {
  if (probes.length === 0) return 1;
  let visible = 0;
  for (const fraction of probes) {
    const target: Vec3 = { x: feet.x, y: feet.y + heightM * fraction, z: feet.z };
    const dx = target.x - centre.x;
    const dy = target.y - centre.y;
    const dz = target.z - centre.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance <= 1e-6) {
      visible += 1;
      continue;
    }
    const hit = rayWorld(
      {
        origin: centre,
        direction: { x: dx / distance, y: dy / distance, z: dz / distance },
        // Stop a hair short: a probe that ends ON a box face (a soldier
        // standing flat against a wall) must not count that wall as cover
        // from a blast on their own side of it.
        maxDistance: distance - 1e-3,
      },
      world,
    );
    if (hit === null) visible += 1;
  }
  return visible / probes.length;
}

/**
 * What one soldier takes from one blast: the falloff at their distance, scaled
 * by how much of them the blast can see, with `blastCoverFraction` as the
 * floor for a body entirely behind something.
 *
 * Distance is measured to the target's MIDDLE rather than their feet, so lying
 * prone at the lip of a crater and standing in it are not the same number.
 */
export function blastDamageOn(
  def: ProjectileDef,
  centre: Vec3,
  feet: Vec3,
  heightM: number,
  world: readonly WorldBox[] = DEFAULT_WORLD,
): number {
  const midY = feet.y + heightM / 2;
  const dx = feet.x - centre.x;
  const dy = midY - centre.y;
  const dz = feet.z - centre.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const base = blastDamageAt(def, distance);
  if (base <= 0) return 0;
  const exposure = blastExposure(centre, feet, heightM, world);
  const scale = def.blastCoverFraction + (1 - def.blastCoverFraction) * exposure;
  return base * scale;
}
