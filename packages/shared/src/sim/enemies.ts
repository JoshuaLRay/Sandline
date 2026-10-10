/**
 * Enemy archetypes and enemy netIds (T-3.10).
 *
 * Enemies are the second class of entity that comes and goes, after
 * projectiles: the session spawns one, steps it through `stepCharacter` with a
 * brain of its own, records it into the hitbox history and hurts it through
 * `applyDamage`, exactly as it does a slot (PLAN.md §7.9 rule 1). What makes a
 * rifleman a rifleman is here, as data: its health, its weapon, the tree its
 * brain runs, whether it can be downed (no — an enemy dies), how long its
 * corpse lies, and the perception and accuracy blocks later tasks read
 * (T-3.13 perception, T-3.15 aim). T-3.13 filled in the perception block,
 * T-3.15 the accuracy block.
 *
 * T-3.23: five archetypes have a place in the wire order, and each has a
 * SHAPE — the block of its own it must carry and no other archetype may: the
 * MG's `deploy`, the RPG's `launcher`, the sniper's `scope`, the officer's
 * `command`; the rifleman has none. The data holds the rifleman and MG
 * (ADR-015) and, since U-157, the RPG; the sniper and officer are valid rows the
 * schema accepts, waiting for their work.
 *
 * SHARED because the client names an archetype off the `Enemy` component's
 * index (T-3.11) and the server builds one from the same row.
 */
import RAW_ENEMIES from '../data/enemies.json' with { type: 'json' };
import { TREE_DEFS } from '../ai/bt.ts';
import { WEAPONS } from './weapons.ts';
import { PROJECTILES, PROJECTILE_IDS } from './ballistics.ts';

export interface EnemyPerception {
  /** How far this archetype can see anything at all, metres. */
  visionRangeM: number;
  /** Full width of its view cone, degrees. */
  fovDeg: number;
  /** Awareness (0..1) at or past which a target is detected (T-3.13). */
  detectAt: number;
  /** Awareness rise per second for a target at the eye: standing, still, dead ahead, fully exposed. */
  nearRatePerSec: number;
  /** The same at the edge of vision range. Between the two it falls on the square of closeness. */
  farRatePerSec: number;
  /** Ceiling on the rise per second whatever the factors say, so no one think detects. */
  maxRatePerSec: number;
  /** Awareness fall per second while a target is not seen. */
  decayPerSec: number;
  /** Rate multiplier for a crouched target (standing is 1). */
  crouchFactor: number;
  /** Rate multiplier for a prone target. */
  proneFactor: number;
  /** Horizontal speed, m/s, at or past which a target counts as moving. */
  movingSpeedMps: number;
  /** Rate multiplier for a moving target. */
  movingFactor: number;
  /** Rate multiplier for a target that fired this think. */
  firingFactor: number;
  /** Rate multiplier at the cone's edge, rising linearly (in the cosine) to 1 dead ahead. */
  edgeFactor: number;
}

/**
 * How well an archetype aims (T-3.15), read by `server/src/ai/aim.ts`. The aim
 * error is a cone around the true line to the target, applied before the
 * weapon's own cone and bloom — the gun is the gun a player carries; this is
 * the hand and the eye holding it.
 */
export interface EnemyAccuracy {
  /** Aim error half-angle, degrees, at the muzzle, settled on a still target, unsuppressed. */
  baseConeDeg: number;
  /** Metres of target distance over which the cone widens by another `baseConeDeg`. */
  distanceDoublingM: number;
  /** Cone growth per m/s of the target's speed: ×(1 + speed × this). */
  speedFactorPerMps: number;
  /** Cone growth at full suppression (level 1, T-3.16): ×(1 + level × this). */
  suppressionFactor: number;
  /** The cone's multiplier the moment it starts aiming at a target, falling to 1 over `settleSeconds`. */
  acquireFactor: number;
  /** Seconds of continuous time on target until the acquire widening is gone. */
  settleSeconds: number;
  /** Ceiling on the aim cone whatever the factors say, degrees. */
  maxConeDeg: number;
  /**
   * Trigger discipline: it does not pull while its weapon's bloom is above
   * this many degrees, so it fires in bursts rather than spraying at the
   * weapon's worst cone.
   */
  holdBloomDeg: number;
  /**
   * T-3.23: a burst is this many rounds, and then it lets go of the trigger
   * for `burstPauseSeconds` — the rifleman's short bursts, the MG's long ones.
   * Holding for bloom above paces a burst; this ends it.
   */
  burstRounds: number;
  burstPauseSeconds: number;
  /**
   * The hit rate this archetype is tuned to — rule 5's number, written down
   * where the tuning is. Firing at a standing, still, unsuppressed soldier
   * `rangeM` away, a seeded run lands between `min` and `max` (T-3.15's test).
   */
  hitBand: { rangeM: number; min: number; max: number };
}

/** The MG's (T-3.23): it fires only once it has stood still this long. */
export interface EnemyDeploy {
  /** Seconds stationary before it may fire. */
  seconds: number;
  /** Horizontal speed, m/s, above which it counts as moving, and packs up. */
  movingSpeedMps: number;
}

/**
 * The RPG's (U-157): what it fires and how it fights with it. Read by `server/src/ai/actions/rpg.ts` and the
 * session's launch. Between `minRangeM` and `maxRangeM` it holds the launcher and fires at a target it has known to
 * be still, behind cover or with others about it; inside the band, or with no rockets left, its rifle is in its hands.
 */
export interface EnemyLauncher {
  /** A `PROJECTILE_IDS` entry of kind `rocket`. */
  projectile: string;
  /** Rockets it carries: its pouch of that projectile on spawn. */
  rockets: number;
  /** The band it fires in, metres across the ground to its target. Inside the near edge its rifle comes out. */
  minRangeM: number;
  maxRangeM: number;
  /** Metres past `minRangeM` a target must go before the launcher comes back out, so it does not swap on the line. */
  rifleHysteresisM: number;
  /** Seconds its target must be known still before a rocket goes at it: a rocket is slow. */
  stillSeconds: number;
  /** Seconds since its target's position was last learnt, at most, for a rocket at it. */
  knownSeconds: number;
  /** The wind-up: seconds it stands on a locked point, launcher shouldered, before the rocket leaves. */
  tellSeconds: number;
  /** Seconds from a launch to the next rocket loaded. */
  reloadSeconds: number;
  /** A group: this many squad soldiers it knows of (the target among them) within `groupFraction` of the blast radius of the burst. */
  groupMin: number;
  groupFraction: number;
  /** A target is in cover when the line to its lower body stops on something within this many metres of it. */
  coverNearM: number;
  /** The burst must land within this fraction of the blast radius of its target's middle. */
  reachFraction: number;
  /** Every friend, and itself, farther than the blast radius and this from the burst, and none on the flight. */
  safetyMarginM: number;
  /** After a shot it moves to cover at least this far from where it fired. */
  relocateM: number;
  /** A search that found no shot is not made again for this long, seconds. */
  retrySeconds: number;
}

/** The sniper's: how long it holds a sight picture before it fires. Not built (ADR-015). */
export interface EnemyScope {
  aimSeconds: number;
}

/** The officer's: how far its orders carry. Not built (ADR-015). */
export interface EnemyCommand {
  radiusM: number;
}

/** A group role (T-3.21) an archetype is given first when there is a choice. */
export type EnemyRolePreference = 'suppressor' | 'flanker';

/** U-066: one solid of a vehicle's body, a capsule in the vehicle's frame: `[right, up, forward]` metres from its feet. */
export interface VehiclePart {
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  radius: number;
}

/**
 * U-066: a tank's body and armour. It is an enemy on rails (owner, 2026-09-30), not a rigid body: the hull and the turret
 * are the capsules a shot is traced against, and `armour` is how much of a hit's damage gets through by its class.
 */
/** U-068: a tank's cannon: a shell from a `rocket`-kind projectile row with the tank's own numbers, fired on a cadence after a tell. */
export interface TankCannon {
  /** A `PROJECTILE_IDS` entry of kind `rocket`: what the shell looks like and flies as. */
  projectile: string;
  /** Seconds between shells. */
  intervalSeconds: number;
  /** Seconds the turret is locked on its aim point before the shell leaves: the squad's window to move. */
  tellSeconds: number;
  rangeM: number;
  /** The turret must be this near the bearing (degrees) to start a tell. */
  alignDeg: number;
  /** The shell's own numbers, over the projectile row's. */
  speedMPerSec: number;
  blastDamage: number;
  blastRadiusM: number;
  /** Where the shell leaves, `[right, up, forward]` metres from the tank's feet, turning with the turret. */
  muzzle: readonly [number, number, number];
}

/** U-068: the coaxial machine gun: the tank's `weapon` (the LMG) in bursts on sight, with the archetype's `accuracy`. */
export interface TankMachineGun {
  rangeM: number;
  /** The turret must be this near the bearing (degrees) to fire. */
  alignDeg: number;
  muzzle: readonly [number, number, number];
}

export interface EnemyVehicle {
  /** U-068: how fast the turret turns, apart from the hull. */
  turretTurnDegPerSec: number;
  /** U-068: it fires only while driving no faster than this, so at a firing position or a slow crawl. */
  fireMaxSpeedMps: number;
  cannon: TankCannon;
  machineGun: TankMachineGun;
  /** How far out from its centre a blast reaches the hull, m: a blast is measured to the hull, not to its middle. */
  radiusM: number;
  /** U-067: how it drives — its speed, how fast the hull turns, and how near a waypoint counts as reached. */
  speedMps: number;
  turnDegPerSec: number;
  arriveM: number;
  hull: VehiclePart;
  turret: VehiclePart;
  armour: {
    /** The share of a bullet's damage that gets through. */
    bullet: number;
    /** The share of a blast's, by projectile id; `blastDefault` for any not listed. */
    blast: Readonly<Record<string, number>>;
    blastDefault: number;
  };
}

export interface EnemyDef {
  id: string;
  name: string;
  /** Full health; also the replicated `max`. */
  health: number;
  /** A `WEAPON_IDS` entry: the gun it carries. */
  weapon: string;
  /** A committed tree id (`data/trees/`): what its brain runs. */
  tree: string;
  /**
   * Whether zero health downs it rather than kills it. False for every
   * committed archetype: the downed state is a squad mechanic (T-2.13) — a
   * revive needs a teammate who comes — and an enemy that went down would lie
   * there with nobody coming. Data rather than a rule so the session honours
   * whatever a row says through the one `applyDamage`.
   */
  downable: boolean;
  /** Seconds a corpse lies before the entity despawns. */
  corpseSeconds: number;
  /**
   * U-075: an escorted character: on the squad's side, not a target for it and not counted as an enemy, unarmed in
   * play (its tree never fires). Absent in the data means false.
   */
  friendly: boolean;
  perception: EnemyPerception;
  accuracy: EnemyAccuracy;
  /** T-3.23: the group role it is handed first (the MG suppresses), or null for none. */
  prefersRole: EnemyRolePreference | null;
  /** T-3.23: the archetype's own block — the one its shape names — or null where the shape has none. */
  deploy: EnemyDeploy | null;
  launcher: EnemyLauncher | null;
  scope: EnemyScope | null;
  command: EnemyCommand | null;
  /** U-066: a tank's body and armour, or null for a soldier. */
  vehicle: EnemyVehicle | null;
}

/**
 * Wire order for archetypes, as `PROJECTILE_IDS` is for projectiles: the index
 * is the `Enemy` component's `archetype` field, so reordering this is a
 * PROTOCOL_VERSION bump (appending is not: an old client names an index it
 * has no row for as nothing). Three bits on the wire hold the archetypes the
 * schema is written for; `enemyByIndex` is null for one the data has no row for
 * (the sniper and the officer).
 */
export const ENEMY_IDS = ['rifleman', 'mg', 'rpg', 'sniper', 'officer', 'tank', 'pow'] as const;
export type EnemyId = (typeof ENEMY_IDS)[number];

/** Each archetype's own block (its shape): required on it, refused on every other. None for the rifleman. */
export const ENEMY_SHAPES: Readonly<Record<EnemyId, 'deploy' | 'launcher' | 'scope' | 'command' | 'vehicle' | null>> = {
  rifleman: null,
  mg: 'deploy',
  rpg: 'launcher',
  sniper: 'scope',
  officer: 'command',
  tank: 'vehicle',
  pow: null,
};
const SHAPE_BLOCKS = ['deploy', 'launcher', 'scope', 'command', 'vehicle'] as const;

/** Bits of the `Enemy` component's archetype index: eight archetypes. */
export const ENEMY_ARCHETYPE_BITS = 3;
/** Bits of the `Enemy` component's faction: four sides. 0 is hostile to the squad. */
export const ENEMY_FACTION_BITS = 2;

/**
 * Where enemy netIds start, and the first one past them.
 *
 * Its own bounded range, clear of the six slots (from 1), the range targets
 * (1000..) and projectiles (`FIRST_PROJECTILE_NET_ID`, from 16384 since this
 * task). Enemies take the band below projectiles rather than above them for
 * bandwidth: a netId is a varuint on the wire, everything under 16384 costs two
 * bytes, and enemies are the many, long-lived entities — forty of them in a
 * snapshot — where projectiles are a handful of short-lived ones that can
 * afford a third byte. An id is never reused within a session (NetId's rule),
 * so a session that has spawned all 10,288 spawns no more: a rail, like
 * `MAX_PROJECTILES`, that no mission comes near. (U-017 gave the band's top
 * 4,096 ids, from 12288, to world pickups — `FIRST_PICKUP_NET_ID`.)
 */
export const FIRST_ENEMY_NET_ID = 2000;
export const ENEMY_NET_ID_LIMIT = 12288;

/** True for a netId in the enemy band. Bounded on both sides, as `isRangeTarget` is. */
export function isEnemyNetId(netId: number): boolean {
  return netId >= FIRST_ENEMY_NET_ID && netId < ENEMY_NET_ID_LIMIT;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Hand-written for the reason `weapons.ts` gives: zod would be a new runtime dep. */
class EnemyDataError extends Error {}

type Row = Record<string, unknown>;

function obj(raw: unknown, where: string): Row {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new EnemyDataError(`${where}: expected an object`);
  return raw as Row;
}

function only(row: Row, keys: readonly string[], where: string): void {
  for (const k of Object.keys(row)) if (!keys.includes(k)) throw new EnemyDataError(`${where}: unknown key "${k}"`);
}

function num(row: Row, key: string, where: string, min: number, max: number): number {
  const v = row[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new EnemyDataError(`${where}.${key} must be a finite number, got ${String(v)}`);
  if (v < min || v > max) throw new EnemyDataError(`${where}.${key} must be in [${min}, ${max}], got ${v}`);
  return v;
}

function str(row: Row, key: string, where: string): string {
  const v = row[key];
  if (typeof v !== 'string' || v.length === 0) throw new EnemyDataError(`${where}.${key} must be a non-empty string`);
  return v;
}

function bool(row: Row, key: string, where: string): boolean {
  const v = row[key];
  if (typeof v !== 'boolean') throw new EnemyDataError(`${where}.${key} must be a boolean, got ${String(v)}`);
  return v;
}

const PERCEPTION_KEYS = [
  'visionRangeM',
  'fovDeg',
  'detectAt',
  'nearRatePerSec',
  'farRatePerSec',
  'maxRatePerSec',
  'decayPerSec',
  'crouchFactor',
  'proneFactor',
  'movingSpeedMps',
  'movingFactor',
  'firingFactor',
  'edgeFactor',
] as const;

function parsePerception(raw: unknown, where: string): EnemyPerception {
  const row = obj(raw, where);
  only(row, PERCEPTION_KEYS, where);
  const out: EnemyPerception = {
    visionRangeM: num(row, 'visionRangeM', where, 1, 500),
    fovDeg: num(row, 'fovDeg', where, 1, 360),
    // Above zero: a threshold of 0 would detect on no sighting at all.
    detectAt: num(row, 'detectAt', where, 0.01, 1),
    nearRatePerSec: num(row, 'nearRatePerSec', where, 0, 100),
    farRatePerSec: num(row, 'farRatePerSec', where, 0, 100),
    maxRatePerSec: num(row, 'maxRatePerSec', where, 0, 100),
    decayPerSec: num(row, 'decayPerSec', where, 0, 100),
    crouchFactor: num(row, 'crouchFactor', where, 0, 1),
    proneFactor: num(row, 'proneFactor', where, 0, 1),
    movingSpeedMps: num(row, 'movingSpeedMps', where, 0, 20),
    movingFactor: num(row, 'movingFactor', where, 1, 10),
    firingFactor: num(row, 'firingFactor', where, 1, 10),
    edgeFactor: num(row, 'edgeFactor', where, 0, 1),
  };
  // "Faster when close" is the rule, not a tuning choice.
  if (out.farRatePerSec > out.nearRatePerSec) throw new EnemyDataError(`${where}: farRatePerSec is above nearRatePerSec`);
  // "Slower when prone than crouched", likewise.
  if (out.proneFactor > out.crouchFactor) throw new EnemyDataError(`${where}: proneFactor is above crouchFactor`);
  return out;
}

const ACCURACY_KEYS = [
  'baseConeDeg',
  'distanceDoublingM',
  'speedFactorPerMps',
  'suppressionFactor',
  'acquireFactor',
  'settleSeconds',
  'maxConeDeg',
  'holdBloomDeg',
  'burstRounds',
  'burstPauseSeconds',
  'hitBand',
] as const;

function parseHitBand(raw: unknown, where: string): EnemyAccuracy['hitBand'] {
  const row = obj(raw, where);
  only(row, ['rangeM', 'min', 'max'], where);
  return { rangeM: num(row, 'rangeM', where, 1, 500), min: num(row, 'min', where, 0, 1), max: num(row, 'max', where, 0, 1) };
}

function parseAccuracy(raw: unknown, where: string): EnemyAccuracy {
  const row = obj(raw, where);
  only(row, ACCURACY_KEYS, where);
  const out: EnemyAccuracy = {
    baseConeDeg: num(row, 'baseConeDeg', where, 0, 45),
    // Above zero: it is a divisor.
    distanceDoublingM: num(row, 'distanceDoublingM', where, 0.1, 1000),
    speedFactorPerMps: num(row, 'speedFactorPerMps', where, 0, 10),
    suppressionFactor: num(row, 'suppressionFactor', where, 0, 10),
    // At least 1: time on target narrows the cone, never widens it.
    acquireFactor: num(row, 'acquireFactor', where, 1, 10),
    settleSeconds: num(row, 'settleSeconds', where, 0, 30),
    maxConeDeg: num(row, 'maxConeDeg', where, 0, 45),
    holdBloomDeg: num(row, 'holdBloomDeg', where, 0, 45),
    // Whole rounds, at least one: a burst of none never fires.
    burstRounds: Math.round(num(row, 'burstRounds', where, 1, 500)),
    burstPauseSeconds: num(row, 'burstPauseSeconds', where, 0, 30),
    hitBand: parseHitBand(row['hitBand'], `${where}.hitBand`),
  };
  if (out.maxConeDeg < out.baseConeDeg) throw new EnemyDataError(`${where}: maxConeDeg is below baseConeDeg`);
  if (out.hitBand.min > out.hitBand.max) throw new EnemyDataError(`${where}.hitBand: min is above max`);
  return out;
}

const DEF_KEYS = ['id', 'name', 'health', 'weapon', 'tree', 'downable', 'corpseSeconds', 'friendly', 'perception', 'accuracy', 'prefersRole', ...SHAPE_BLOCKS] as const;

function parseDeploy(raw: unknown, where: string): EnemyDeploy {
  const row = obj(raw, where);
  only(row, ['seconds', 'movingSpeedMps'], where);
  return { seconds: num(row, 'seconds', where, 0, 30), movingSpeedMps: num(row, 'movingSpeedMps', where, 0, 10) };
}

const LAUNCHER_KEYS = [
  'projectile',
  'rockets',
  'minRangeM',
  'maxRangeM',
  'rifleHysteresisM',
  'stillSeconds',
  'knownSeconds',
  'tellSeconds',
  'reloadSeconds',
  'groupMin',
  'groupFraction',
  'coverNearM',
  'reachFraction',
  'safetyMarginM',
  'relocateM',
  'retrySeconds',
] as const;

function parseLauncher(raw: unknown, where: string): EnemyLauncher {
  const row = obj(raw, where);
  only(row, LAUNCHER_KEYS, where);
  const projectile = str(row, 'projectile', where);
  if (!(PROJECTILE_IDS as readonly string[]).includes(projectile)) throw new EnemyDataError(`${where}.projectile: unknown projectile "${projectile}"`);
  // A rocket flies and bursts on what it meets, as the tank's shell does: not a grenade that bounces and waits.
  const def = PROJECTILES[projectile]!;
  if (def.kind !== 'rocket') throw new EnemyDataError(`${where}.projectile: "${projectile}" is not a rocket`);
  const out: EnemyLauncher = {
    projectile,
    // Whole rockets, inside a pouch count.
    rockets: Math.round(num(row, 'rockets', where, 1, 20)),
    minRangeM: num(row, 'minRangeM', where, 1, 500),
    maxRangeM: num(row, 'maxRangeM', where, 1, 500),
    rifleHysteresisM: num(row, 'rifleHysteresisM', where, 0, 20),
    stillSeconds: num(row, 'stillSeconds', where, 0, 30),
    knownSeconds: num(row, 'knownSeconds', where, 0, 30),
    // Long enough to see and react to; short of the reload it sits inside.
    tellSeconds: num(row, 'tellSeconds', where, 0.2, 10),
    reloadSeconds: num(row, 'reloadSeconds', where, 1, 120),
    // At least two: one soldier is not a group.
    groupMin: Math.round(num(row, 'groupMin', where, 2, 6)),
    groupFraction: num(row, 'groupFraction', where, 0.1, 1),
    coverNearM: num(row, 'coverNearM', where, 0.1, 20),
    // At most 1: a burst past the blast radius cannot reach the target at all.
    reachFraction: num(row, 'reachFraction', where, 0.05, 1),
    safetyMarginM: num(row, 'safetyMarginM', where, 0, 20),
    relocateM: num(row, 'relocateM', where, 0, 100),
    retrySeconds: num(row, 'retrySeconds', where, 0.1, 30),
  };
  if (out.maxRangeM <= out.minRangeM) throw new EnemyDataError(`${where}: maxRangeM is not above minRangeM`);
  // Its near edge clear of its own blast, with the margin: it never fires a rocket that could reach itself.
  if (out.minRangeM <= def.blastRadiusM + out.safetyMarginM) {
    throw new EnemyDataError(`${where}: minRangeM is inside the blast radius of "${projectile}" plus safetyMarginM`);
  }
  return out;
}

function parseScope(raw: unknown, where: string): EnemyScope {
  const row = obj(raw, where);
  only(row, ['aimSeconds'], where);
  return { aimSeconds: num(row, 'aimSeconds', where, 0, 30) };
}

function parseCommand(raw: unknown, where: string): EnemyCommand {
  const row = obj(raw, where);
  only(row, ['radiusM'], where);
  return { radiusM: num(row, 'radiusM', where, 1, 500) };
}

function triple(row: Row, key: string, where: string, limit: number): [number, number, number] {
  const v = row[key];
  if (!Array.isArray(v) || v.length !== 3 || v.some((n) => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > limit)) {
    throw new EnemyDataError(`${where}.${key} must be [right, up, forward] metres within ±${limit}`);
  }
  return [v[0] as number, v[1] as number, v[2] as number];
}

function parseVehiclePart(raw: unknown, where: string): VehiclePart {
  const row = obj(raw, where);
  only(row, ['from', 'to', 'radius'], where);
  return { from: triple(row, 'from', where, 20), to: triple(row, 'to', where, 20), radius: num(row, 'radius', where, 0.1, 5) };
}

function parseCannon(raw: unknown, where: string): TankCannon {
  const row = obj(raw, where);
  only(row, ['projectile', 'intervalSeconds', 'tellSeconds', 'rangeM', 'alignDeg', 'speedMPerSec', 'blastDamage', 'blastRadiusM', 'muzzle'], where);
  const projectile = str(row, 'projectile', where);
  if (!(PROJECTILE_IDS as readonly string[]).includes(projectile)) throw new EnemyDataError(`${where}.projectile: unknown projectile "${projectile}"`);
  // A shell flies and bursts on impact: a rocket-kind row, not a grenade that bounces and waits.
  if (PROJECTILES[projectile]?.kind !== 'rocket') throw new EnemyDataError(`${where}.projectile: "${projectile}" is not a rocket`);
  const intervalSeconds = num(row, 'intervalSeconds', where, 1, 60);
  const tellSeconds = num(row, 'tellSeconds', where, 0.2, 10);
  // The tell sits inside the wait between shells.
  if (tellSeconds >= intervalSeconds) throw new EnemyDataError(`${where}: tellSeconds is not below intervalSeconds`);
  return {
    projectile,
    // A shell every few seconds, with a tell long enough to react to.
    intervalSeconds,
    tellSeconds,
    rangeM: num(row, 'rangeM', where, 5, 500),
    alignDeg: num(row, 'alignDeg', where, 0.5, 45),
    speedMPerSec: num(row, 'speedMPerSec', where, 5, 200),
    blastDamage: num(row, 'blastDamage', where, 1, 1000),
    blastRadiusM: num(row, 'blastRadiusM', where, 0.5, 20),
    muzzle: triple(row, 'muzzle', where, 20),
  };
}

function parseMachineGun(raw: unknown, where: string): TankMachineGun {
  const row = obj(raw, where);
  only(row, ['rangeM', 'alignDeg', 'muzzle'], where);
  return { rangeM: num(row, 'rangeM', where, 5, 500), alignDeg: num(row, 'alignDeg', where, 0.5, 45), muzzle: triple(row, 'muzzle', where, 20) };
}

function parseVehicle(raw: unknown, where: string): EnemyVehicle {
  const row = obj(raw, where);
  only(row, ['radiusM', 'speedMps', 'turnDegPerSec', 'arriveM', 'turretTurnDegPerSec', 'fireMaxSpeedMps', 'cannon', 'machineGun', 'hull', 'turret', 'armour'], where);
  const armourRow = obj(row['armour'], `${where}.armour`);
  only(armourRow, ['bullet', 'blast', 'blastDefault'], `${where}.armour`);
  const blastRow = obj(armourRow['blast'], `${where}.armour.blast`);
  const blast: Record<string, number> = {};
  for (const id of Object.keys(blastRow)) {
    if (!(PROJECTILE_IDS as readonly string[]).includes(id)) throw new EnemyDataError(`${where}.armour.blast: unknown projectile "${id}"`);
    blast[id] = num(blastRow, id, `${where}.armour.blast`, 0, 2);
  }
  return {
    radiusM: num(row, 'radiusM', where, 0.5, 10),
    // A slow walk to a fast one, and a turn from a crawl to a spin: a tank is neither a statue nor a car.
    speedMps: num(row, 'speedMps', where, 0.1, 6),
    turnDegPerSec: num(row, 'turnDegPerSec', where, 1, 120),
    arriveM: num(row, 'arriveM', where, 0.1, 10),
    turretTurnDegPerSec: num(row, 'turretTurnDegPerSec', where, 1, 360),
    fireMaxSpeedMps: num(row, 'fireMaxSpeedMps', where, 0, 6),
    cannon: parseCannon(row['cannon'], `${where}.cannon`),
    machineGun: parseMachineGun(row['machineGun'], `${where}.machineGun`),
    hull: parseVehiclePart(row['hull'], `${where}.hull`),
    turret: parseVehiclePart(row['turret'], `${where}.turret`),
    armour: {
      bullet: num(armourRow, 'bullet', `${where}.armour`, 0, 1),
      blast,
      blastDefault: num(armourRow, 'blastDefault', `${where}.armour`, 0, 2),
    },
  };
}

function parseEnemyDef(key: string, raw: unknown): EnemyDef {
  const where = `enemy "${key}"`;
  const row = obj(raw, where);
  only(row, DEF_KEYS, where);
  const id = str(row, 'id', where);
  if (id !== key) throw new EnemyDataError(`${where}: id field says "${id}"`);
  const weapon = str(row, 'weapon', where);
  // Any row of weapons.json, not only the players' loadout (WEAPON_IDS): the MG's LMG is carried by nobody else.
  if (!WEAPONS[weapon]) throw new EnemyDataError(`${where}.weapon: unknown weapon "${weapon}"`);
  const tree = str(row, 'tree', where);
  if (!TREE_DEFS.has(tree)) throw new EnemyDataError(`${where}.tree: unknown tree "${tree}"`);
  const downable = bool(row, 'downable', where);

  const perception = parsePerception(row['perception'], `${where}.perception`);
  const accuracy = parseAccuracy(row['accuracy'], `${where}.accuracy`);

  const prefers = row['prefersRole'];
  if (prefers !== undefined && prefers !== 'suppressor' && prefers !== 'flanker') {
    throw new EnemyDataError(`${where}.prefersRole must be "suppressor" or "flanker", got ${String(prefers)}`);
  }
  // The shape: its own block present, every other archetype's absent.
  const shape = ENEMY_SHAPES[key as EnemyId];
  for (const block of SHAPE_BLOCKS) {
    if (block === shape && row[block] === undefined) throw new EnemyDataError(`${where}: a ${key} needs a "${block}" block`);
    if (block !== shape && row[block] !== undefined) throw new EnemyDataError(`${where}: "${block}" is not a ${key}'s`);
  }

  return {
    id,
    name: str(row, 'name', where),
    // Whole points, inside the Health component's 10-bit fields (HEALTH in quantize.ts).
    health: Math.round(num(row, 'health', where, 1, 1023)),
    weapon,
    tree,
    downable,
    corpseSeconds: num(row, 'corpseSeconds', where, 0, 600),
    friendly: row['friendly'] === undefined ? false : bool(row, 'friendly', where),
    perception,
    accuracy,
    prefersRole: prefers ?? null,
    deploy: shape === 'deploy' ? parseDeploy(row['deploy'], `${where}.deploy`) : null,
    launcher: shape === 'launcher' ? parseLauncher(row['launcher'], `${where}.launcher`) : null,
    scope: shape === 'scope' ? parseScope(row['scope'], `${where}.scope`) : null,
    command: shape === 'command' ? parseCommand(row['command'], `${where}.command`) : null,
    vehicle: shape === 'vehicle' ? parseVehicle(row['vehicle'], `${where}.vehicle`) : null,
  };
}

/** Validate an archetype table: rows only for `ENEMY_IDS` entries, at least one, each in its own shape. */
export function parseEnemyTable(raw: unknown): Record<string, EnemyDef> {
  const table = obj(raw, 'enemies');
  const out: Record<string, EnemyDef> = {};
  for (const [key, value] of Object.entries(table)) {
    if (!(ENEMY_IDS as readonly string[]).includes(key)) throw new EnemyDataError(`enemy "${key}": not in ENEMY_IDS (the wire order)`);
    out[key] = Object.freeze(parseEnemyDef(key, value));
  }
  if (Object.keys(out).length === 0) throw new EnemyDataError('enemies: no archetypes');
  return out;
}

/** The committed archetypes, validated at import. */
export const ENEMIES: Readonly<Record<string, EnemyDef>> = Object.freeze(parseEnemyTable(RAW_ENEMIES));

export function getEnemy(id: string): EnemyDef {
  const def = ENEMIES[id];
  if (!def) throw new RangeError(`unknown enemy archetype "${id}"`);
  return def;
}

/** The archetype at a wire index, or null for an index nothing has. */
export function enemyByIndex(index: number): EnemyDef | null {
  const id = ENEMY_IDS[index];
  return id === undefined ? null : (ENEMIES[id] ?? null);
}

/** An archetype's wire index. */
export function enemyIndex(id: string): number {
  const i = (ENEMY_IDS as readonly string[]).indexOf(id);
  if (i < 0) throw new RangeError(`unknown enemy archetype "${id}"`);
  return i;
}
