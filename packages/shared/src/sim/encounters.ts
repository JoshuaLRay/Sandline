/**
 * Encounters (T-3.32): who a world's mission sends, from where, when, and
 * standing how — one file per world, `data/encounters/<world>.json`.
 *
 * A GROUP is some enemies of named archetypes, spawned together in one of
 * the world's spawn zones (`World.mission.spawnZones`, T-3.31), with a
 * posture they take on spawn and go back to once nothing is left to fight:
 *
 * - `hold` — stand where it spawned, facing a named place (the start by default);
 * - `patrol` — walk from where it spawned through `route`, and round again;
 * - `garrison` — take cover inside an area (a named place, or a circle), and
 *   fight from inside it.
 *
 * A group spawns on its TRIGGER: the mission's start, a time since it,
 * the squad entering an area, another group dying, or — `script` (U-001) —
 * only when the mission's event script sends it. With `waves` it spawns
 * again, `everySeconds` after each wave, `count` times in all — the
 * reinforcements. The spawner (`server/src/ai/director/spawner.ts`) never
 * puts an enemy where a human can see it and never lets more than
 * `aliveCap` live at once; what the cap holds back waits its turn.
 *
 * STRAGGLERS (U-001): a group down to `stragglers.alive` living members (and
 * at least one lost) for `stragglers.seconds` counts as beaten for whatever
 * waits on its death — a `dead` trigger, a script's `group-dead` — so one
 * survivor hidden somewhere, or unable to reach anyone, cannot hold the rest
 * of the mission back for ever. A `destroy` objective still wants them all.
 *
 * Validated by hand, unknown keys refused by name, as the other data files
 * are; and against the world, so a zone or place that does not exist is a
 * load-time error rather than a group that never comes.
 */
import { parseAreaHeightBounds } from './areas.ts';
import { COMMITTED, type CampaignEntry } from './campaignRegistry.ts';
import { blockedAt } from './world.ts';
import { MAX_DRIVE_POINTS } from './vehicle.ts';
import { ENEMIES } from './enemies.ts';
import { type GroundArea, type World, getWorld } from './world.ts';

/** A named place (`areas`, or the mission's `start` and `objective`), or a circle. */
export type AreaRef = string | GroundArea;

export type Posture =
  | { kind: 'hold'; face: AreaRef }
  | { kind: 'patrol'; route: readonly { x: number; z: number }[] }
  | { kind: 'garrison'; at: AreaRef };
export const POSTURE_KINDS = ['hold', 'patrol', 'garrison'] as const;

export type Trigger =
  | { kind: 'start' }
  | { kind: 'time'; seconds: number }
  | { kind: 'enter'; area: AreaRef }
  | { kind: 'dead'; group: string }
  | { kind: 'script' };
export const TRIGGER_KINDS = ['start', 'time', 'enter', 'dead', 'script'] as const;

export interface EncounterGroup {
  id: string;
  members: readonly { archetype: string; count: number }[];
  /** A spawn zone id of the world's mission. */
  zone: string;
  posture: Posture;
  trigger: Trigger;
  /**
   * Spawn again after each wave, `count` waves in all (the first included):
   * `everySeconds` after the last as a rule, never sooner than `minSeconds`
   * nor later than `maxSeconds` — the bounds the director (T-3.33) paces inside.
   */
  fixedCount?: boolean;
  captive?: boolean;
  path?: readonly { x: number; z: number }[];
  waves: { count: number; everySeconds: number; minSeconds: number; maxSeconds: number };
}

export interface Encounter {
  world: string;
  /** At most this many enemies alive at once; the rest wait. */
  aliveCap: number;
  /** Heights above a spawn point's feet a human must see none of for it to be used, metres. */
  probes: readonly number[];
  /** Places triggers and postures may name, beside the mission's `start` and `objective`. */
  areas: Readonly<Record<string, GroundArea>>;
  groups: readonly EncounterGroup[];
  /** A group this far gone, this long, counts as beaten to what waits on it (U-001). */
  stragglers: { alive: number; seconds: number };
}

/** Without a `stragglers` entry: one survivor for a minute. */
export const DEFAULT_STRAGGLERS = { alive: 1, seconds: 60 } as const;

export class EncounterDataError extends Error {}

type Obj = Record<string, unknown>;

function obj(where: string, v: unknown, keys: readonly string[], optional: readonly string[] = []): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new EncounterDataError(`${where}: expected an object`);
  const o = v as Obj;
  for (const k of Object.keys(o)) if (!keys.includes(k) && !optional.includes(k) && k !== '$comment') throw new EncounterDataError(`${where}: unknown key '${k}'`);
  for (const k of keys) if (!(k in o)) throw new EncounterDataError(`${where}: missing '${k}'`);
  return o;
}

function num(where: string, v: unknown, min: number, max = Infinity): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw new EncounterDataError(`${where} must be a number in [${min}, ${max}], got ${JSON.stringify(v)}`);
  }
  return v;
}

function whole(where: string, v: unknown, min: number, max = Infinity): number {
  const n = num(where, v, min, max);
  if (!Number.isInteger(n)) throw new EncounterDataError(`${where} must be a whole number, got ${n}`);
  return n;
}

function circle(where: string, v: unknown): GroundArea {
  const o = obj(where, v, ['x', 'z', 'radius'], ['minY', 'maxY']);
  return { x: num(`${where}.x`, o['x'], -Infinity), z: num(`${where}.z`, o['z'], -Infinity), radius: num(`${where}.radius`, o['radius'], 1e-3), ...parseAreaHeightBounds(where, o, EncounterDataError) };
}

/** Parse and check an encounter file against its world. */
export function parseEncounter(raw: unknown, worldOf: (id: string) => World | undefined = getWorld): Encounter {
  const top = obj('encounter', raw, ['world', 'aliveCap', 'probes', 'areas', 'groups'], ['stragglers']);
  const worldId = top['world'];
  const world = typeof worldId === 'string' ? worldOf(worldId) : undefined;
  if (!world) throw new EncounterDataError(`encounter: no world ${JSON.stringify(worldId)}`);
  const mission = world.mission;
  if (!mission) throw new EncounterDataError(`encounter: world '${world.id}' has no mission`);
  const at = `encounter '${world.id}'`;
  const aliveCap = whole(`${at}.aliveCap`, top['aliveCap'], 1, 64);
  if (!Array.isArray(top['probes']) || top['probes'].length === 0) throw new EncounterDataError(`${at}.probes: expected a non-empty list`);
  const probes = top['probes'].map((h, i) => num(`${at}.probes[${i}]`, h, 0, 3));
  let stragglers: Encounter['stragglers'] = { ...DEFAULT_STRAGGLERS };
  if (top['stragglers'] !== undefined) {
    const so = obj(`${at}.stragglers`, top['stragglers'], ['alive', 'seconds']);
    stragglers = { alive: whole(`${at}.stragglers.alive`, so['alive'], 0, 16), seconds: num(`${at}.stragglers.seconds`, so['seconds'], 0) };
  }

  const areasRaw = top['areas'];
  if (typeof areasRaw !== 'object' || areasRaw === null || Array.isArray(areasRaw)) throw new EncounterDataError(`${at}.areas: expected an object of named circles`);
  const areas: Record<string, GroundArea> = {};
  for (const [name, v] of Object.entries(areasRaw)) {
    if (name === '$comment') continue;
    if (name === 'start' || name === 'objective') throw new EncounterDataError(`${at}.areas: '${name}' is the mission's own`);
    areas[name] = circle(`${at}.areas.${name}`, v);
  }
  const area = (where: string, v: unknown): AreaRef => {
    if (typeof v === 'string') {
      if (v !== 'start' && v !== 'objective' && !(v in areas)) throw new EncounterDataError(`${where}: no area '${v}'`);
      return v;
    }
    return circle(where, v);
  };

  if (!Array.isArray(top['groups']) || top['groups'].length === 0) throw new EncounterDataError(`${at}.groups: expected a non-empty list`);
  const ids = new Set<string>();
  const zones = new Set(mission.spawnZones.map((z) => z.id));
  const groups: EncounterGroup[] = top['groups'].map((g, i) => {
    const gw = `${at}.groups[${i}]`;
    const o = obj(gw, g, ['id', 'members', 'zone', 'posture', 'trigger'], ['waves', 'captive', 'path', 'fixedCount']);
    if (typeof o['id'] !== 'string' || o['id'] === '') throw new EncounterDataError(`${gw}: id must be a name`);
    if (ids.has(o['id'])) throw new EncounterDataError(`${at}.groups: duplicate id '${o['id']}'`);
    ids.add(o['id']);
    if (!Array.isArray(o['members']) || o['members'].length === 0) throw new EncounterDataError(`${gw}.members: expected a non-empty list`);
    const members = o['members'].map((m, j) => {
      const mo = obj(`${gw}.members[${j}]`, m, ['archetype', 'count']);
      // An archetype with data: one only named on the wire (T-3.23's shapes still to come) spawns nothing.
      if (typeof mo['archetype'] !== 'string' || !(mo['archetype'] in ENEMIES)) throw new EncounterDataError(`${gw}.members[${j}]: archetype must be one of ${Object.keys(ENEMIES).join(', ')}`);
      return { archetype: mo['archetype'] as string, count: whole(`${gw}.members[${j}].count`, mo['count'], 1, 16) };
    });
    if (typeof o['zone'] !== 'string' || !zones.has(o['zone'])) throw new EncounterDataError(`${gw}.zone: no spawn zone ${JSON.stringify(o['zone'])} in world '${world.id}'`);

    const p = o['posture'] as Obj | null;
    const kind = typeof p === 'object' && p !== null ? p['kind'] : undefined;
    let posture: Posture;
    if (kind === 'hold') {
      const po = obj(`${gw}.posture`, p, ['kind'], ['face']);
      posture = { kind, face: po['face'] === undefined ? 'start' : area(`${gw}.posture.face`, po['face']) };
    } else if (kind === 'patrol') {
      const po = obj(`${gw}.posture`, p, ['kind', 'route']);
      if (!Array.isArray(po['route']) || po['route'].length === 0) throw new EncounterDataError(`${gw}.posture.route: expected a non-empty list`);
      posture = {
        kind,
        route: po['route'].map((q, j) => {
          const qo = obj(`${gw}.posture.route[${j}]`, q, ['x', 'z']);
          return { x: num(`${gw}.posture.route[${j}].x`, qo['x'], -Infinity), z: num(`${gw}.posture.route[${j}].z`, qo['z'], -Infinity) };
        }),
      };
    } else if (kind === 'garrison') {
      const po = obj(`${gw}.posture`, p, ['kind', 'at']);
      posture = { kind, at: area(`${gw}.posture.at`, po['at']) };
    } else {
      throw new EncounterDataError(`${gw}.posture.kind must be one of ${POSTURE_KINDS.join(', ')}`);
    }

    const t = o['trigger'] as Obj | null;
    const tk = typeof t === 'object' && t !== null ? t['kind'] : undefined;
    let trigger: Trigger;
    if (tk === 'start') {
      obj(`${gw}.trigger`, t, ['kind']);
      trigger = { kind: 'start' };
    } else if (tk === 'time') {
      const to = obj(`${gw}.trigger`, t, ['kind', 'seconds']);
      trigger = { kind: 'time', seconds: num(`${gw}.trigger.seconds`, to['seconds'], 0) };
    } else if (tk === 'enter') {
      const to = obj(`${gw}.trigger`, t, ['kind', 'area']);
      trigger = { kind: 'enter', area: area(`${gw}.trigger.area`, to['area']) };
    } else if (tk === 'dead') {
      const to = obj(`${gw}.trigger`, t, ['kind', 'group']);
      if (typeof to['group'] !== 'string') throw new EncounterDataError(`${gw}.trigger.group must be a group id`);
      trigger = { kind: 'dead', group: to['group'] };
    } else if (tk === 'script') {
      obj(`${gw}.trigger`, t, ['kind']);
      trigger = { kind: 'script' };
    } else {
      throw new EncounterDataError(`${gw}.trigger.kind must be one of ${TRIGGER_KINDS.join(', ')}`);
    }

    let waves = { count: 1, everySeconds: 0, minSeconds: 0, maxSeconds: 0 };
    if (o['waves'] !== undefined) {
      const wo = obj(`${gw}.waves`, o['waves'], ['count', 'everySeconds', 'minSeconds', 'maxSeconds']);
      waves = {
        count: whole(`${gw}.waves.count`, wo['count'], 1, 32),
        everySeconds: num(`${gw}.waves.everySeconds`, wo['everySeconds'], 0.1),
        minSeconds: num(`${gw}.waves.minSeconds`, wo['minSeconds'], 0.1),
        maxSeconds: num(`${gw}.waves.maxSeconds`, wo['maxSeconds'], 0.1),
      };
      if (!(waves.minSeconds <= waves.everySeconds && waves.everySeconds <= waves.maxSeconds)) {
        throw new EncounterDataError(`${gw}.waves: needs minSeconds ≤ everySeconds ≤ maxSeconds, got ${waves.minSeconds}, ${waves.everySeconds}, ${waves.maxSeconds}`);
      }
    }
    const fixedCount = o['fixedCount'];
    if (fixedCount !== undefined && typeof fixedCount !== 'boolean') throw new EncounterDataError(`${gw}.fixedCount: expected a boolean`);
    const captive = o['captive'];
    if (captive !== undefined && (typeof captive !== 'boolean' || members.some((m) => !ENEMIES[m.archetype]!.friendly))) throw new EncounterDataError(`${gw}.captive: only friendly groups may be captive`);
    let path: { x: number; z: number }[] | undefined;
    if (o['path'] !== undefined) {
      if (!Array.isArray(o['path']) || o['path'].length === 0 || o['path'].length > MAX_DRIVE_POINTS || members.some((m) => !ENEMIES[m.archetype]!.vehicle)) throw new EncounterDataError(`${gw}.path: expected a vehicle group and a bounded path`);
      path = o['path'].map((p, j) => {
        const q = obj(`${gw}.path[${j}]`, p, ['x', 'z']);
        return { x: num(`${gw}.path[${j}].x`, q['x'], -Infinity), z: num(`${gw}.path[${j}].z`, q['z'], -Infinity) };
      });
      const start = mission.spawnZones.find((z) => z.id === o['zone'])!;
      for (const m of members) for (const point of [start, ...path]) {
        if (blockedAt(point.x, point.z, ENEMIES[m.archetype]!.vehicle!.hull.radius + .1, 0, .45, 2.4, world.boxes)) throw new EncounterDataError(`${gw}.path: vehicle hull does not fit`);
      }
    }
    return { id: o['id'], members, zone: o['zone'], posture, trigger, waves, ...(fixedCount === undefined ? {} : { fixedCount: fixedCount as boolean }), ...(captive === undefined ? {} : { captive: captive as boolean }), ...(path ? { path } : {}) };
  });
  // A `dead` trigger names a group that exists and is not itself.
  for (const g of groups) {
    if (g.trigger.kind !== 'dead') continue;
    if (!ids.has(g.trigger.group)) throw new EncounterDataError(`${at}: group '${g.id}' waits on no group '${g.trigger.group}'`);
    if (g.trigger.group === g.id) throw new EncounterDataError(`${at}: group '${g.id}' waits on itself`);
  }
  return { world: world.id, aliveCap, probes, areas, groups, stragglers };
}

/** An area reference made a circle, against the encounter's areas and its world's mission. */
export function resolveArea(ref: AreaRef, encounter: Encounter, world: World): GroundArea {
  if (typeof ref !== 'string') return ref;
  const mission = world.mission!;
  if (ref === 'start') return mission.start;
  if (ref === 'objective') return mission.objective;
  return encounter.areas[ref]!;
}

/** The encounters of a list of registry entries, by world id (U-073); `worldOf` finds their worlds. */
export function encountersFrom(entries: readonly CampaignEntry[], worldOf: (id: string) => World | undefined = getWorld): ReadonlyMap<string, Encounter> {
  return new Map(
    entries
      .filter((e) => e.encounter !== undefined)
      .map((entry) => {
        const e = parseEncounter(entry.encounter, worldOf);
        if (e.world !== entry.id) throw new Error(`registry entry '${entry.id}': its encounter file is for world '${e.world}'`);
        return [e.world, e] as const;
      }),
  );
}

/** Every committed encounter, by world id. Validated once, at import. */
const ENCOUNTERS: ReadonlyMap<string, Encounter> = encountersFrom(COMMITTED);

/** The committed encounter for a world, or undefined when it has none. */
export function encounterFor(worldId: string): Encounter | undefined {
  return ENCOUNTERS.get(worldId);
}
