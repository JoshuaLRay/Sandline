/**
 * Missions (T-3.34, grown into a sequence by T-4.14): data and the wire.
 *
 * A mission is `data/missions/<world>.json`: whether the dead respawn, and a
 * list of OBJECTIVES played in order. Each objective is one of five types,
 * each with its own parameters (see `ObjectiveDef`). The next objective
 * starts the moment one completes; the mission is complete when the last
 * does, and fails on a squad wipe whatever the objective, or when an
 * objective of its own fails (a defended area overrun).
 *
 * Validated by hand, unknown keys refused by name, as every data file is. An
 * area names a place (`start`, `objective`, or one of the encounter's
 * `areas`) or is a circle; which names exist is the encounter's and the
 * world's, so the session resolves them (`resolveArea`) and a name that
 * does not exist is refused when the mission is checked against them
 * (`checkMission`).
 *
 * The rule itself is the server's (`server/src/session/mission.ts`); what
 * travels is `MissionView`.
 */
import GREYBOX_01 from '../data/missions/greybox-01.json' with { type: 'json' };
import MISSION_01 from '../data/missions/mission-01.json' with { type: 'json' };
import type { AreaRef, Encounter } from './encounters.ts';
import type { World } from './world.ts';

export const OBJECTIVE_TYPES = ['clear-and-hold', 'reach', 'destroy', 'defend', 'survive'] as const;
export type ObjectiveType = (typeof OBJECTIVE_TYPES)[number];

export type ObjectiveDef = { label: string } & (
  /** No living enemy inside `area` and a living squad soldier in it, for `holdSeconds` in all; an enemy inside resets it. */
  | { type: 'clear-and-hold'; area: AreaRef; holdSeconds: number }
  /** Every standing squad soldier (`all`), or any one (`any`), inside `area`. */
  | { type: 'reach'; area: AreaRef; who: 'all' | 'any' }
  /** An encounter group dead: every member it will send placed and none alive. */
  | { type: 'destroy'; group: string }
  /** `seconds` pass; fails if the enemy holds `area` (living enemy in, no living squad) for `breachSeconds` straight. */
  | { type: 'defend'; area: AreaRef; seconds: number; breachSeconds: number }
  /** `seconds` pass. */
  | { type: 'survive'; seconds: number }
);

export interface MissionDef {
  id: string;
  /** The world it is played in. */
  world: string;
  /** Whether a dead slot respawns during the mission. */
  respawn: boolean;
  objectives: readonly ObjectiveDef[];
}

/** Where a mission stands. The order is the wire encoding. */
export const MISSION_STATES = ['progress', 'complete', 'failed'] as const;
export type MissionStatus = (typeof MISSION_STATES)[number];

/**
 * The mission as the host broadcasts it: the whole mission's state, and the
 * current objective's. Ticks and counts, not seconds: integers round-trip
 * exactly. Once the mission is complete the objective is the last one.
 */
export interface MissionView {
  state: MissionStatus;
  /** Which attempt this is: 1, then one more each restart. */
  attempt: number;
  /** The current objective, 0-based, and how many there are. */
  objective: number;
  objectives: number;
  type: ObjectiveType;
  /** What the HUD names it by. */
  label: string;
  /**
   * How far along, of `goal`: ticks held, passed or defended for the timed
   * types; soldiers inside for `reach`; members down for `destroy`.
   */
  progress: number;
  goal: number;
  /**
   * Whether its condition holds right now: the area clear (clear-and-hold),
   * enough of the squad inside (reach), the area not overrun (defend).
   * Always true for the others.
   */
  satisfied: boolean;
}

export class MissionDataError extends Error {}

type Obj = Record<string, unknown>;

function obj(where: string, v: unknown, keys: readonly string[], optional: readonly string[] = []): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new MissionDataError(`${where}: expected an object`);
  const o = v as Obj;
  for (const k of Object.keys(o)) if (!keys.includes(k) && !optional.includes(k) && k !== '$comment') throw new MissionDataError(`${where}: unknown key '${k}'`);
  for (const k of keys) if (!(k in o)) throw new MissionDataError(`${where}: missing '${k}'`);
  return o;
}

function seconds(where: string, v: unknown, min = 0): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= min || v > 3600) throw new MissionDataError(`${where} must be a number in (${min}, 3600], got ${JSON.stringify(v)}`);
  return v;
}

function area(where: string, v: unknown): AreaRef {
  if (typeof v === 'string' && v.length > 0) return v;
  const o = obj(where, v, ['x', 'z', 'radius']);
  for (const k of ['x', 'z', 'radius'] as const) {
    if (typeof o[k] !== 'number' || !Number.isFinite(o[k] as number)) throw new MissionDataError(`${where}.${k} must be a finite number`);
  }
  if ((o['radius'] as number) <= 0) throw new MissionDataError(`${where}.radius must be positive`);
  return { x: o['x'] as number, z: o['z'] as number, radius: o['radius'] as number };
}

function parseObjective(where: string, raw: unknown): ObjectiveDef {
  const head = obj(where, raw, ['type', 'label'], ['area', 'holdSeconds', 'who', 'group', 'seconds', 'breachSeconds']);
  const type = head['type'];
  if (typeof type !== 'string' || !(OBJECTIVE_TYPES as readonly string[]).includes(type)) {
    throw new MissionDataError(`${where}.type must be one of ${OBJECTIVE_TYPES.join(', ')}, got ${JSON.stringify(type)}`);
  }
  if (typeof head['label'] !== 'string' || head['label'].length === 0 || head['label'].length > 40) throw new MissionDataError(`${where}.label must be 1–40 characters`);
  const label = head['label'];
  switch (type as ObjectiveType) {
    case 'clear-and-hold': {
      const o = obj(where, raw, ['type', 'label', 'area', 'holdSeconds']);
      return { type: 'clear-and-hold', label, area: area(`${where}.area`, o['area']), holdSeconds: seconds(`${where}.holdSeconds`, o['holdSeconds']) };
    }
    case 'reach': {
      const o = obj(where, raw, ['type', 'label', 'area', 'who']);
      if (o['who'] !== 'all' && o['who'] !== 'any') throw new MissionDataError(`${where}.who must be all or any`);
      return { type: 'reach', label, area: area(`${where}.area`, o['area']), who: o['who'] };
    }
    case 'destroy': {
      const o = obj(where, raw, ['type', 'label', 'group']);
      if (typeof o['group'] !== 'string' || o['group'].length === 0) throw new MissionDataError(`${where}.group must name an encounter group`);
      return { type: 'destroy', label, group: o['group'] };
    }
    case 'defend': {
      const o = obj(where, raw, ['type', 'label', 'area', 'seconds', 'breachSeconds']);
      return {
        type: 'defend',
        label,
        area: area(`${where}.area`, o['area']),
        seconds: seconds(`${where}.seconds`, o['seconds']),
        breachSeconds: seconds(`${where}.breachSeconds`, o['breachSeconds']),
      };
    }
    case 'survive': {
      const o = obj(where, raw, ['type', 'label', 'seconds']);
      return { type: 'survive', label, seconds: seconds(`${where}.seconds`, o['seconds']) };
    }
  }
}

/** Validate a mission file. Its areas and groups are names until `checkMission` holds them to an encounter and a world. */
export function parseMission(raw: unknown): MissionDef {
  const o = obj('mission', raw, ['id', 'world', 'respawn', 'objectives']);
  const id = typeof o['id'] === 'string' ? o['id'] : '';
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(id)) throw new MissionDataError(`mission.id must be a lowercase id, got ${JSON.stringify(o['id'])}`);
  const where = `mission '${id}'`;
  if (typeof o['world'] !== 'string' || o['world'].length === 0) throw new MissionDataError(`${where}.world must name a world`);
  if (typeof o['respawn'] !== 'boolean') throw new MissionDataError(`${where}.respawn must be true or false, got ${JSON.stringify(o['respawn'])}`);
  const list = o['objectives'];
  if (!Array.isArray(list) || list.length === 0 || list.length > 16) throw new MissionDataError(`${where}.objectives must list 1–16 objectives`);
  return { id, world: o['world'], respawn: o['respawn'], objectives: list.map((x, i) => parseObjective(`${where}.objectives[${i}]`, x)) };
}

/**
 * Hold a mission to what it will be played with: its world, and its named
 * areas and groups to the encounter's. Throws naming the first that is not there.
 */
export function checkMission(mission: MissionDef, encounter: Encounter, world: World): void {
  const where = `mission '${mission.id}'`;
  if (mission.world !== world.id) throw new MissionDataError(`${where} is for world '${mission.world}', not '${world.id}'`);
  if (!world.mission) throw new MissionDataError(`${where}: world '${world.id}' has no mission block`);
  mission.objectives.forEach((o, i) => {
    const at = `${where}.objectives[${i}]`;
    if ('area' in o && typeof o.area === 'string' && o.area !== 'start' && o.area !== 'objective' && !(o.area in encounter.areas)) {
      throw new MissionDataError(`${at}.area: no place '${o.area}' (start, objective or one of the encounter's areas)`);
    }
    if (o.type === 'destroy' && !encounter.groups.some((g) => g.id === o.group)) throw new MissionDataError(`${at}.group: no encounter group '${o.group}'`);
  });
}

/** Every committed mission, by world id. Validated once, at import. */
const MISSIONS: ReadonlyMap<string, MissionDef> = new Map(
  [GREYBOX_01, MISSION_01].map((raw) => {
    const m = parseMission(raw);
    return [m.world, m] as const;
  }),
);

/** The committed mission for a world, or undefined when it has none. */
export function missionFor(worldId: string): MissionDef | undefined {
  return MISSIONS.get(worldId);
}

/** Every committed mission. */
export function missions(): readonly MissionDef[] {
  return [...MISSIONS.values()];
}
