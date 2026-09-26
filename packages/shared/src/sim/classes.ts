/**
 * Soldier classes (T-4.27): the slice's Team Leader and Marksman, as data
 * (`data/classes.json`, PLAN §1.3 and §4.1).
 *
 * A class is a loadout (guns, in hand-order; the pouch it spawns with), a
 * health, and what it may do: whom its orders reach. Which slot takes which
 * class is the one piece of arithmetic here — `assignClasses` — and it is
 * pure, so the session and a test agree on it: a human's pick stands, a
 * slot without one takes the slot's default, and bots then fill whatever
 * the squad is required to have and lacks, lowest slot first. Enforcing a
 * loadout (which Equip a session accepts) and an order's reach is the
 * session's; the rule for the reach, `orderReach`, lives here beside the
 * data it reads.
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
  readonly orders: OrderScope;
}

export interface ClassConfig {
  readonly classes: Readonly<Record<string, ClassDef>>;
  /** Class ids in file order: the order a picker offers them. */
  readonly ids: readonly string[];
  /** The class a slot takes with no pick, one per slot. */
  readonly slotDefaults: readonly string[];
  /** Class id → how many the squad must have; bots make up the shortfall. */
  readonly required: Readonly<Record<string, number>>;
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
    const orders = str(row, 'orders', where);
    if (orders !== 'squad' && orders !== 'fireteam') throw new ClassDataError(`${where}.orders must be "squad" or "fireteam"`);
    classes[id] = {
      id,
      name: str(row, 'name', where),
      short: str(row, 'short', where),
      health: num(row, 'health', where, 1, 1000),
      guns: guns as string[],
      pouch,
      orders,
    };
    ids.push(id);
  }
  if (ids.length === 0) throw new ClassDataError('classes.json.classes must name at least one class');
  const defaultsRaw = root['slotDefaults'];
  if (!Array.isArray(defaultsRaw) || defaultsRaw.length !== MAX_SLOTS) throw new ClassDataError(`classes.json.slotDefaults must list ${MAX_SLOTS} classes`);
  for (const id of defaultsRaw) {
    if (typeof id !== 'string' || classes[id] === undefined) throw new ClassDataError(`classes.json.slotDefaults: unknown class ${String(id)}`);
  }
  const requiredRaw = root['required'] === undefined ? {} : obj('classes.json.required', root['required']);
  const required: Record<string, number> = {};
  for (const [id, count] of Object.entries(requiredRaw)) {
    if (classes[id] === undefined) throw new ClassDataError(`classes.json.required: unknown class ${id}`);
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > MAX_SLOTS) throw new ClassDataError(`classes.json.required.${id} must be an integer in [0, ${MAX_SLOTS}]`);
    required[id] = count;
  }
  return { classes, ids, slotDefaults: defaultsRaw as string[], required };
}

export const CLASSES: ClassConfig = Object.freeze(parseClassConfig(RAW_CLASSES));

/** The class for an id, or null for one the data does not know (an empty pick included). */
export function classById(id: string, config: ClassConfig = CLASSES): ClassDef | null {
  return config.classes[id] ?? null;
}

/**
 * The class every slot plays (T-4.27): a human's pick where it names a
 * class, else the slot's default; then, for each class the squad is
 * required to have and is short of, bots switch to it, lowest slot first
 * (a bot already playing a required class that is not itself short stays).
 * With no bots to switch, the shortfall stands: humans pick freely.
 */
export function assignClasses(isBot: readonly boolean[], picks: readonly string[], config: ClassConfig = CLASSES): string[] {
  const out: string[] = [];
  for (let slot = 0; slot < MAX_SLOTS; slot += 1) {
    const pick = isBot[slot] ? '' : picks[slot] ?? '';
    out.push(config.classes[pick] !== undefined ? pick : config.slotDefaults[slot] ?? config.ids[0]!);
  }
  const count = (id: string): number => out.filter((c) => c === id).length;
  const shortOf = (id: string): number => (config.required[id] ?? 0) - count(id);
  for (const id of Object.keys(config.required)) {
    for (let slot = 0; slot < MAX_SLOTS && shortOf(id) > 0; slot += 1) {
      if (!isBot[slot] || out[slot] === id) continue;
      // A bot on another required class is switched only when that class can spare it.
      const from = out[slot]!;
      if ((config.required[from] ?? 0) > 0 && shortOf(from) >= 0 && count(from) - 1 < (config.required[from] ?? 0)) continue;
      out[slot] = id;
    }
  }
  return out;
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
