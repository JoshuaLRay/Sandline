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
 * (T-3.13 perception, T-3.16 aim). Those two blocks hold the fewest numbers
 * that name what they are for; the tasks that use them add the rest.
 *
 * SHARED because the client names an archetype off the `Enemy` component's
 * index (T-3.11) and the server builds one from the same row.
 */
import RAW_ENEMIES from '../data/enemies.json' with { type: 'json' };
import { TREE_DEFS } from '../ai/bt.ts';
import { WEAPON_IDS } from './weapons.ts';

export interface EnemyPerception {
  /** How far this archetype can see anything at all, metres. */
  visionRangeM: number;
  /** Full width of its view cone, degrees. */
  fovDeg: number;
}

export interface EnemyAccuracy {
  /** Aim error before distance, target speed or suppression widen it, degrees. */
  baseConeDeg: number;
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
  perception: EnemyPerception;
  accuracy: EnemyAccuracy;
}

/**
 * Wire order for archetypes, as `PROJECTILE_IDS` is for projectiles: the index
 * is the `Enemy` component's `archetype` field, so reordering this is a
 * PROTOCOL_VERSION bump. Three bits on the wire hold the five archetypes the
 * schema is written for (ADR-015 builds two); T-3.23 appends the MG.
 */
export const ENEMY_IDS = ['rifleman'] as const;
export type EnemyId = (typeof ENEMY_IDS)[number];

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
 * so a session that has spawned all 14,384 spawns no more: a rail, like
 * `MAX_PROJECTILES`, that no mission comes near.
 */
export const FIRST_ENEMY_NET_ID = 2000;
export const ENEMY_NET_ID_LIMIT = 16384;

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

const DEF_KEYS = ['id', 'name', 'health', 'weapon', 'tree', 'downable', 'corpseSeconds', 'perception', 'accuracy'] as const;

function parseEnemyDef(key: string, raw: unknown): EnemyDef {
  const where = `enemy "${key}"`;
  const row = obj(raw, where);
  only(row, DEF_KEYS, where);
  const id = str(row, 'id', where);
  if (id !== key) throw new EnemyDataError(`${where}: id field says "${id}"`);
  const weapon = str(row, 'weapon', where);
  if (!(WEAPON_IDS as readonly string[]).includes(weapon)) throw new EnemyDataError(`${where}.weapon: unknown weapon "${weapon}"`);
  const tree = str(row, 'tree', where);
  if (!TREE_DEFS.has(tree)) throw new EnemyDataError(`${where}.tree: unknown tree "${tree}"`);
  const downable = bool(row, 'downable', where);

  const perception = obj(row['perception'], `${where}.perception`);
  only(perception, ['visionRangeM', 'fovDeg'], `${where}.perception`);
  const accuracy = obj(row['accuracy'], `${where}.accuracy`);
  only(accuracy, ['baseConeDeg'], `${where}.accuracy`);

  return {
    id,
    name: str(row, 'name', where),
    // Whole points, inside the Health component's 10-bit fields (HEALTH in quantize.ts).
    health: Math.round(num(row, 'health', where, 1, 1023)),
    weapon,
    tree,
    downable,
    corpseSeconds: num(row, 'corpseSeconds', where, 0, 600),
    perception: {
      visionRangeM: num(perception, 'visionRangeM', `${where}.perception`, 1, 500),
      fovDeg: num(perception, 'fovDeg', `${where}.perception`, 1, 360),
    },
    accuracy: {
      baseConeDeg: num(accuracy, 'baseConeDeg', `${where}.accuracy`, 0, 45),
    },
  };
}

/** Validate an archetype table. Every `ENEMY_IDS` entry must be present, and nothing else. */
export function parseEnemyTable(raw: unknown): Record<string, EnemyDef> {
  const table = obj(raw, 'enemies');
  const out: Record<string, EnemyDef> = {};
  for (const [key, value] of Object.entries(table)) {
    if (!(ENEMY_IDS as readonly string[]).includes(key)) throw new EnemyDataError(`enemy "${key}": not in ENEMY_IDS (the wire order)`);
    out[key] = Object.freeze(parseEnemyDef(key, value));
  }
  for (const id of ENEMY_IDS) if (!out[id]) throw new EnemyDataError(`enemy "${id}": in ENEMY_IDS but missing from the data`);
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
  return id === undefined ? null : getEnemy(id);
}

/** An archetype's wire index. */
export function enemyIndex(id: string): number {
  const i = (ENEMY_IDS as readonly string[]).indexOf(id);
  if (i < 0) throw new RangeError(`unknown enemy archetype "${id}"`);
  return i;
}
