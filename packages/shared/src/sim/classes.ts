/**
 * The squad's characters (T-4.27, U-021), as data (`data/classes.json`,
 * `docs/design/squad-roster.md`).
 *
 * The file keeps the name "classes" and the word `classId` on the wire and in
 * saves for compatibility, but since U-021 each entry IS one of the six
 * characters, bound to its slot for good: `slotDefaults[slot]` names the
 * character a slot plays, whoever or whatever occupies it. An entry is a
 * loadout (guns, in hand-order; the pouch it spawns with), a health, whom its
 * orders reach, and what its shooter may not do (`ads`, `firstPerson`: the
 * support has neither). Enforcing a loadout (which Equip a session accepts)
 * and an order's reach is the session's; the rule for the reach, `orderReach`,
 * lives here beside the data it reads.
 */
import RAW_CLASSES from '../data/classes.json' with { type: 'json' };
import { MAX_SLOTS } from '../net/Connection.ts';
import { PROJECTILE_IDS } from './ballistics.ts';
import { WEAPON_IDS } from './weapons.ts';
import type { Fireteam } from './squad.ts';

export class ClassDataError extends Error {}

/** Whom a class's orders reach. */
export type OrderScope = 'squad' | 'fireteam';

export interface ClassDef {
  readonly id: string;
  readonly name: string;
  /** Two letters for a squad row. */
  readonly short: string;
  readonly health: number;
  /** weapons.json ids, the first in hand at spawn. */
  readonly guns: readonly string[];
  /** The pouch at spawn, indexed like PROJECTILE_IDS. */
  readonly pouch: readonly number[];
  /**
   * The pouch item in slot 5 (a projectiles.json id other than the frag, which is slot 4's), or null for an empty slot
   * (U-048). Its count is the pouch's. Brennan's launcher today; C4, the claymore and the rest arrive with their cards.
   */
  readonly equipment: string | null;
  /** May THROW placed equipment (C4, U-054); everyone else places it on a surface within reach. The support only. */
  readonly throwsPlaced: boolean;
  readonly orders: OrderScope;
  /** Health kits carried at spawn (U-047; default 3, the owner's number). */
  readonly healthKits: number;
  /**
   * How long this character's timed interactions take, as a multiple (U-049): the support's 0.8 is the owner's 20%
   * discount, so a 10 s health kit takes 8 s. Default 1. Not for firing, reloading or swapping.
   */
  readonly interactionTimeScale: number;
  /** A multiple on walking and sprinting speed (U-050): the support's 1.1 is the owner's +10%. Default 1. */
  readonly speedScale: number;
  /**
   * May carry two primaries at once (U-022): only Preach and the support. The
   * second is another AR, SMG or shotgun; never with an LMG, marksman rifle
   * or sniper rifle in hand as the first.
   */
  readonly dualPrimary: boolean;
  /** May aim down the sight (default true); the support may not (U-021). */
  readonly ads: boolean;
  /** May play in first person (default true); the support may not (U-021). */
  readonly firstPerson: boolean;
}

export interface ClassConfig {
  readonly classes: Readonly<Record<string, ClassDef>>;
  /** Class ids in file order. */
  readonly ids: readonly string[];
  /** The character each slot plays, one per slot, unique: a slot's character is fixed. */
  readonly slotDefaults: readonly string[];
}

type Obj = Record<string, unknown>;

function obj(where: string, v: unknown): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ClassDataError(`${where}: expected an object`);
  return v as Obj;
}

function str(o: Obj, key: string, where: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length === 0) throw new ClassDataError(`${where}.${key} must be a non-empty string`);
  return v;
}

function bool(o: Obj, key: string, where: string, fallback: boolean): boolean {
  const v = o[key];
  if (v === undefined) return fallback;
  if (typeof v !== 'boolean') throw new ClassDataError(`${where}.${key} must be true or false`);
  return v;
}

function num(o: Obj, key: string, where: string, min: number, max: number): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new ClassDataError(`${where}.${key} must be a number in [${min}, ${max}]`);
  return v;
}

export function parseClassConfig(raw: unknown): ClassConfig {
  const root = obj('classes.json', raw);
  const classesRaw = obj('classes.json.classes', root['classes']);
  const classes: Record<string, ClassDef> = {};
  const ids: string[] = [];
  for (const [id, rowRaw] of Object.entries(classesRaw)) {
    const where = `classes.${id}`;
    const row = obj(where, rowRaw);
    const guns = row['guns'];
    if (!Array.isArray(guns) || guns.length === 0) throw new ClassDataError(`${where}.guns must be a non-empty array`);
    for (const gun of guns) {
      if (typeof gun !== 'string' || !(WEAPON_IDS as readonly string[]).includes(gun)) throw new ClassDataError(`${where}.guns: unknown weapon ${String(gun)}`);
    }
    const pouchRaw = row['pouch'] === undefined ? {} : obj(`${where}.pouch`, row['pouch']);
    for (const key of Object.keys(pouchRaw)) {
      if (!(PROJECTILE_IDS as readonly string[]).includes(key)) throw new ClassDataError(`${where}.pouch: unknown projectile ${key}`);
    }
    const pouch = PROJECTILE_IDS.map((pid) => (pouchRaw[pid] === undefined ? 0 : num(pouchRaw, pid, `${where}.pouch`, 0, 99)));
    const equipmentRaw = row['equipment'];
    if (equipmentRaw !== undefined && (typeof equipmentRaw !== 'string' || equipmentRaw === 'frag' || !(PROJECTILE_IDS as readonly string[]).includes(equipmentRaw))) {
      throw new ClassDataError(`${where}.equipment: must be a projectile id other than the frag, got ${String(equipmentRaw)}`);
    }
    const equipment = typeof equipmentRaw === 'string' ? equipmentRaw : null;
    if (equipment !== null && (pouch[(PROJECTILE_IDS as readonly string[]).indexOf(equipment)] ?? 0) <= 0) {
      throw new ClassDataError(`${where}.equipment: ${equipment} needs a count in the pouch`);
    }
    // Anything but the frag and the chosen equipment has no slot to be drawn from.
    PROJECTILE_IDS.forEach((pid, i) => {
      if (pid !== 'frag' && pid !== equipment && (pouch[i] ?? 0) > 0) throw new ClassDataError(`${where}.pouch: ${pid} is carried but is neither the frag nor the equipment`);
    });
    const orders = str(row, 'orders', where);
    if (orders !== 'squad' && orders !== 'fireteam') throw new ClassDataError(`${where}.orders must be "squad" or "fireteam"`);
    classes[id] = {
      id,
      name: str(row, 'name', where),
      short: str(row, 'short', where),
      health: num(row, 'health', where, 1, 1000),
      guns: guns as string[],
      pouch,
      equipment,
      throwsPlaced: bool(row, 'throwsPlaced', where, false),
      orders,
      speedScale: row['speedScale'] === undefined ? 1 : num(row, 'speedScale', where, 0.5, 2),
      interactionTimeScale: row['interactionTimeScale'] === undefined ? 1 : num(row, 'interactionTimeScale', where, 0.1, 2),
      healthKits: row['healthKits'] === undefined ? 3 : num(row, 'healthKits', where, 0, 7),
      dualPrimary: bool(row, 'dualPrimary', where, false),
      ads: bool(row, 'ads', where, true),
      firstPerson: bool(row, 'firstPerson', where, true),
    };
    ids.push(id);
  }
  if (ids.length === 0) throw new ClassDataError('classes.json.classes must name at least one class');
  const defaultsRaw = root['slotDefaults'];
  if (!Array.isArray(defaultsRaw) || defaultsRaw.length !== MAX_SLOTS) throw new ClassDataError(`classes.json.slotDefaults must list ${MAX_SLOTS} classes`);
  for (const id of defaultsRaw) {
    if (typeof id !== 'string' || classes[id] === undefined) throw new ClassDataError(`classes.json.slotDefaults: unknown class ${String(id)}`);
  }
  // A character is bound to one slot: the same one twice would be two soldiers with one identity.
  if (new Set(defaultsRaw as string[]).size !== defaultsRaw.length) throw new ClassDataError('classes.json.slotDefaults: a character may take only one slot');
  return { classes, ids, slotDefaults: defaultsRaw as string[] };
}

export const CLASSES: ClassConfig = Object.freeze(parseClassConfig(RAW_CLASSES));

/** A class's non-sidearm guns in order: the first is its primary; a dual-primary class's second is its other primary (U-022). */
export function classPrimaries(def: ClassDef): readonly string[] {
  const own = def.guns.filter((gun) => gun !== 'sidearm');
  return def.dualPrimary ? own.slice(0, 2) : own.slice(0, 1);
}

/** The class for an id, or null for one the data does not know (an empty pick included). */
export function classById(id: string, config: ClassConfig = CLASSES): ClassDef | null {
  return config.classes[id] ?? null;
}

/**
 * The character every slot plays (U-021): the slot's own, fixed by the data.
 * (Until U-021 this took the humans' picks and the required leader; a
 * character is the slot's now, so a pick has nothing to decide.)
 */
export function assignClasses(config: ClassConfig = CLASSES): string[] {
  return Array.from({ length: MAX_SLOTS }, (_, slot) => config.slotDefaults[slot] ?? config.ids[0]!);
}

/**
 * The slots an order from `giverSlot`, playing `classId`, may reach out of
 * `addressed` (T-4.27): all of them for a class whose orders reach the
 * squad; for one whose orders reach its fireteam, only the addressees in
 * the giver's own fireteam. An unknown class reaches nothing.
 */
export function orderReach(
  classId: string,
  giverSlot: number,
  addressed: readonly number[],
  fireteams: readonly Fireteam[],
  config: ClassConfig = CLASSES,
): number[] {
  const def = config.classes[classId];
  if (!def) return [];
  if (def.orders === 'squad') return [...addressed];
  const own = fireteams.find((team) => team.slots.includes(giverSlot));
  if (!own) return [];
  return addressed.filter((slot) => own.slots.includes(slot));
}
