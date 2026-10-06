/**
 * The world a checkpoint saves (U-052, U-059) and its durable form (U-060): what each soldier carries, the
 * pickups on the ground, the enemies alive, the spawner's progress, the devices placed and the mission clock.
 *
 * It travels in the campaign file as plain JSON, so `parseCheckpointWorld` is the gate on the way back in:
 * bounded lists, finite numbers, known shapes. Anything else is refused as a whole (null) and the room falls
 * back to the smaller checkpoint the file always had, rather than failing to load.
 */
import { parseNavigationRegion, type ProjectileState } from '@sandline/shared';
import type { EnemyPosture } from '../ai/actions/posture.ts';
import type { SpawnerCheckpoint } from '../ai/director/spawner.ts';

/** Bump when the shape changes; `parseCheckpointWorld` refuses other versions. */
export const CHECKPOINT_WORLD_VERSION = 1;

/** U-052: one soldier's carried loadout at a checkpoint, restored by a retry. */
export interface SlotCheckpoint {
  /** U-059: health when it was saved (a dead soldier's is its maximum: it returns whole). */
  health: number;
  weapon: string;
  primary: string | null;
  secondary: string | null;
  noPistol: boolean;
  pickedUp: boolean;
  /** Rounds in each gun carried, the one in hand included. */
  ammo: [string, number][];
  pouch: number[];
  kits: number;
  equipment: number;
}

/** U-059: a living enemy at a checkpoint. */
export interface EnemyCheckpoint {
  spawnId?: string;
  captive?: boolean;
  escortOrder?: { kind: 'follow' | 'stay' | 'go'; point: { x: number; y: number; z: number } | null };
  netId: number;
  archetype: string;
  faction: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  /** The encounter group that sent it, or null. */
  group: string | null;
  posture: EnemyPosture | null;
  ammo: number;
  pouch: number[];
  /** U-069: a tank's drive (its path, place on it and heading), turret and the time to its next shell. */
  vehicle?: VehicleCheckpoint;
}

/** U-069: what a checkpoint keeps of a tank beyond what every enemy has. */
export interface VehicleCheckpoint {
  path: { x: number; y?: number; z: number }[];
  next: number;
  heading: number;
  phase: 'driving' | 'arrived' | 'blocked';
  origin: { x: number; y?: number; z: number } | null;
  withdrawing: boolean;
  turretYaw: number;
  /** Seconds until the cannon may fire again. */
  cannonIn: number;
}

/** U-059: a placed device (C4, claymore, sensor, smoke cloud) at a checkpoint. */
export interface PlacedCheckpoint {
  kind: number;
  ownerSlot: number;
  state: ProjectileState;
  facing?: { x: number; z: number };
}

/** U-052: a pickup on the ground at a checkpoint. */
export interface GroundCheckpoint {
  weapon: number;
  ammo: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  authored: boolean;
}

/** Everything a checkpoint saves besides the objective, the clock's base and the script's state. */
export interface CheckpointWorld {
  version: number;
  /** The mission clock, seconds. */
  seconds: number;
  slots: SlotCheckpoint[];
  ground: GroundCheckpoint[];
  enemies: EnemyCheckpoint[];
  spawner: SpawnerCheckpoint | null;
  placed: PlacedCheckpoint[];
}

/** List bounds: generous against the session's own caps (64 enemies, 24 drops, 64 projectiles), tight against abuse. */
const MAX_SLOTS = 6;
const MAX_ENEMIES = 64;
const MAX_GROUND = 128;
const MAX_PLACED = 128;
const MAX_GROUPS = 64;
const MAX_QUEUE = 512;
const MAX_TIMES = 256;
const MAX_SPAWNED = 512;
const MAX_POUCH = 16;
const MAX_ID = 64;

type Obj = Record<string, unknown>;

class Refused extends Error {}

const fail = (where: string): never => {
  throw new Refused(where);
};
const obj = (where: string, v: unknown): Obj => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : fail(where));
const list = (where: string, v: unknown, max: number): unknown[] => (Array.isArray(v) && v.length <= max ? v : fail(where));
const num = (where: string, v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : fail(where));
const int = (where: string, v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
  const n = num(where, v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fail(where);
};
const bool = (where: string, v: unknown): boolean => (typeof v === 'boolean' ? v : fail(where));
const str = (where: string, v: unknown): string => (typeof v === 'string' && v.length > 0 && v.length <= MAX_ID ? v : fail(where));
const strOrNull = (where: string, v: unknown): string | null => (v === null ? null : str(where, v));
const pouch = (where: string, v: unknown): number[] => list(where, v, MAX_POUCH).map((n, i) => int(`${where}[${i}]`, n, 0, 255));
const pt = (where: string, v: unknown): { x: number; z: number } => {
  const o = obj(where, v);
  return { x: num(`${where}.x`, o['x']), z: num(`${where}.z`, o['z']) };
};

function memberId(where: string, v: unknown): string {
  const id = str(where, v);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return fail(where);
  return id;
}

function posture(where: string, v: unknown): EnemyPosture | null {
  if (v === null) return null;
  const o = obj(where, v);
  const kind = o['kind'];
  if (kind !== 'hold' && kind !== 'patrol' && kind !== 'garrison') return fail(`${where}.kind`);
  const post = obj(`${where}.post`, o['post']);
  const area = o['area'] === null ? null : obj(`${where}.area`, o['area']);
  let region: EnemyPosture['region'];
  if (o['region'] !== undefined) {
    try { region = parseNavigationRegion(`${where}.region`, o['region']); } catch { return fail(`${where}.region`); }
  }
  let patrol: EnemyPosture['patrol'];
  if (o['patrol'] !== undefined) {
    if (kind !== 'patrol') return fail(`${where}.patrol`);
    const p = obj(`${where}.patrol`, o['patrol']);
    const direction = num(`${where}.patrol.direction`, p['direction']);
    if (direction !== 1 && direction !== -1) return fail(`${where}.patrol.direction`);
    const pauseTotalTicks = int(`${where}.patrol.pauseTotalTicks`, p['pauseTotalTicks'], 0, 1800);
    patrol = { direction, pauseTotalTicks, pauseTicks: int(`${where}.patrol.pauseTicks`, p['pauseTicks'], 0, pauseTotalTicks), active: false };
    const route = list(`${where}.route`, o['route'], 64);
    if (route.length === 0 || int(`${where}.leg`, o['leg']) > route.length) return fail(`${where}.patrol.leg`);
  }
  return {
    kind,
    post: { x: num(`${where}.post.x`, post['x']), y: num(`${where}.post.y`, post['y']), z: num(`${where}.post.z`, post['z']) },
    face: pt(`${where}.face`, o['face']),
    route: list(`${where}.route`, o['route'], 64).map((p, i) => drivePoint(`${where}.route[${i}]`, p)),
    area: area === null ? null : { x: num(`${where}.area.x`, area['x']), z: num(`${where}.area.z`, area['z']), radius: num(`${where}.area.radius`, area['radius']) },
    leg: int(`${where}.leg`, o['leg'], 0, 1024),
    ...(region ? { region } : {}), ...(patrol ? { patrol } : {}),
  };
}

const drivePoint = (where: string, v: unknown): { x: number; y?: number; z: number } => {
  const o = obj(where, v);
  return { ...pt(where, v), ...(o['y'] === undefined ? {} : { y: num(`${where}.y`, o['y']) }) };
};

function vehicle(where: string, v: unknown): VehicleCheckpoint {
  const o = obj(where, v);
  const phase = o['phase'];
  if (phase !== 'driving' && phase !== 'arrived' && phase !== 'blocked') return fail(`${where}.phase`);
  const path = list(`${where}.path`, o['path'], 64).map((p, i) => drivePoint(`${where}.path[${i}]`, p));
  return {
    path,
    next: int(`${where}.next`, o['next'], 0, path.length),
    heading: num(`${where}.heading`, o['heading']),
    phase,
    origin: o['origin'] === null ? null : drivePoint(`${where}.origin`, o['origin']),
    withdrawing: bool(`${where}.withdrawing`, o['withdrawing']),
    turretYaw: int(`${where}.turretYaw`, o['turretYaw'], 0, 1023),
    cannonIn: num(`${where}.cannonIn`, o['cannonIn']),
  };
}

function spawner(where: string, v: unknown): SpawnerCheckpoint | null {
  if (v === null) return null;
  const o = obj(where, v);
  const numOrNull = (w: string, n: unknown): number | null => (n === null ? null : num(w, n));
  return {
    runs: list(`${where}.runs`, o['runs'], MAX_GROUPS).map((r, i) => {
      const w = `${where}.runs[${i}]`;
      const x = obj(w, r);
      return {
        id: str(`${w}.id`, x['id']),
        firedAt: numOrNull(`${w}.firedAt`, x['firedAt']),
        wavesSent: int(`${w}.wavesSent`, x['wavesSent'], 0, 1024),
        lastWaveAt: num(`${w}.lastWaveAt`, x['lastWaveAt']),
        waveTimes: list(`${w}.waveTimes`, x['waveTimes'], MAX_TIMES).map((t, k) => num(`${w}.waveTimes[${k}]`, t)),
        spawned: list(`${w}.spawned`, x['spawned'], MAX_SPAWNED).map((n, k) => int(`${w}.spawned[${k}]`, n)),
        stopped: bool(`${w}.stopped`, x['stopped']),
        stragglingSince: numOrNull(`${w}.stragglingSince`, x['stragglingSince']),
      };
    }),
    queue: list(`${where}.queue`, o['queue'], MAX_QUEUE).map((q, i) => {
      const w = `${where}.queue[${i}]`;
      const x = obj(w, q);
      return { group: str(`${w}.group`, x['group']), wave: int(`${w}.wave`, x['wave'], 0, 1024), archetype: str(`${w}.archetype`, x['archetype']), ...(x['socketId'] === undefined ? {} : { socketId: memberId(`${w}.socketId`, x['socketId']) }) };
    }),
  };
}

function slotCheckpoint(w: string, s: unknown): SlotCheckpoint {
  const x = obj(w, s);
  return {
    health: num(`${w}.health`, x['health']),
    weapon: str(`${w}.weapon`, x['weapon']),
    primary: strOrNull(`${w}.primary`, x['primary']),
    secondary: strOrNull(`${w}.secondary`, x['secondary']),
    noPistol: bool(`${w}.noPistol`, x['noPistol']),
    pickedUp: bool(`${w}.pickedUp`, x['pickedUp']),
    ammo: list(`${w}.ammo`, x['ammo'], 16).map((a, k) => {
      const pair = list(`${w}.ammo[${k}]`, a, 2);
      return [str(`${w}.ammo[${k}][0]`, pair[0]), int(`${w}.ammo[${k}][1]`, pair[1], 0, 65535)] as [string, number];
    }),
    pouch: pouch(`${w}.pouch`, x['pouch']),
    kits: int(`${w}.kits`, x['kits'], 0, 255),
    equipment: int(`${w}.equipment`, x['equipment'], -1, 255),
  };
}

/** U-077: a soldier's saved loadout from its JSON, or null if it is not what a session would have written. */
export function parseSoldierLoadout(raw: unknown): SlotCheckpoint | null {
  try {
    return slotCheckpoint('loadout', raw);
  } catch {
    return null;
  }
}

/** The checkpoint world from its saved JSON, or null if any part of it is not what a session would have written. */
export function parseCheckpointWorld(raw: unknown): CheckpointWorld | null {
  try {
    const o = obj('world', raw);
    if (o['version'] !== CHECKPOINT_WORLD_VERSION) return fail('version');
    const parsed: CheckpointWorld = {
      version: CHECKPOINT_WORLD_VERSION,
      seconds: num('seconds', o['seconds']),
      slots: list('slots', o['slots'], MAX_SLOTS).map((s, i) => slotCheckpoint(`slots[${i}]`, s)),
      ground: list('ground', o['ground'], MAX_GROUND).map((g, i) => {
        const w = `ground[${i}]`;
        const x = obj(w, g);
        return {
          weapon: int(`${w}.weapon`, x['weapon'], 0, 255),
          ammo: int(`${w}.ammo`, x['ammo'], 0, 65535),
          x: num(`${w}.x`, x['x']),
          y: num(`${w}.y`, x['y']),
          z: num(`${w}.z`, x['z']),
          yaw: num(`${w}.yaw`, x['yaw']),
          authored: bool(`${w}.authored`, x['authored']),
        };
      }),
      enemies: list('enemies', o['enemies'], MAX_ENEMIES).map((e, i) => {
        const w = `enemies[${i}]`;
        const x = obj(w, e);
        return {
          netId: int(`${w}.netId`, x['netId']),
          archetype: str(`${w}.archetype`, x['archetype']),
          ...(x['spawnId'] === undefined ? {} : { spawnId: memberId(`${w}.spawnId`, x['spawnId']) }),
          faction: int(`${w}.faction`, x['faction'], 0, 255),
          x: num(`${w}.x`, x['x']),
          y: num(`${w}.y`, x['y']),
          z: num(`${w}.z`, x['z']),
          yaw: num(`${w}.yaw`, x['yaw']),
          health: num(`${w}.health`, x['health']),
          group: strOrNull(`${w}.group`, x['group']),
          posture: posture(`${w}.posture`, x['posture']),
          ...(x['escortOrder'] === undefined ? {} : { escortOrder: escortOrder(`${w}.escortOrder`, x['escortOrder']) }),
          ...(x['captive'] === undefined ? {} : { captive: bool(`${w}.captive`, x['captive']) }),
          ammo: int(`${w}.ammo`, x['ammo'], 0, 65535),
          pouch: pouch(`${w}.pouch`, x['pouch']),
          ...(x['vehicle'] === undefined ? {} : { vehicle: vehicle(`${w}.vehicle`, x['vehicle']) }),
        };
      }),
      spawner: spawner('spawner', o['spawner']),
      placed: list('placed', o['placed'], MAX_PLACED).map((p, i) => {
        const w = `placed[${i}]`;
        const x = obj(w, p);
        const s = obj(`${w}.state`, x['state']);
        const state: ProjectileState = {
          x: num(`${w}.state.x`, s['x']),
          y: num(`${w}.state.y`, s['y']),
          z: num(`${w}.state.z`, s['z']),
          vx: num(`${w}.state.vx`, s['vx']),
          vy: num(`${w}.state.vy`, s['vy']),
          vz: num(`${w}.state.vz`, s['vz']),
          age: num(`${w}.state.age`, s['age']),
          bounces: int(`${w}.state.bounces`, s['bounces'], 0, 1024),
          resting: bool(`${w}.state.resting`, s['resting']),
        };
        return {
          kind: int(`${w}.kind`, x['kind'], 0, 255),
          ownerSlot: int(`${w}.ownerSlot`, x['ownerSlot'], 0, MAX_SLOTS - 1),
          state,
          ...(x['facing'] === undefined ? {} : { facing: pt(`${w}.facing`, x['facing']) }),
        };
      }),
    };
    const names = new Set<string>();
    for (const id of [...parsed.enemies.map((e) => e.spawnId), ...(parsed.spawner?.queue.map((q) => q.socketId) ?? [])]) {
      if (id === undefined) continue;
      if (names.has(id)) return fail('duplicate member identity');
      names.add(id);
    }
    return parsed;
  } catch (error) {
    if (error instanceof Refused) return null;
    throw error;
  }
}

function escortOrder(w: string, raw: unknown): NonNullable<EnemyCheckpoint['escortOrder']> {
  const o = obj(w, raw);
  const kind = o['kind'];
  if (kind !== 'follow' && kind !== 'stay' && kind !== 'go') throw new Refused(`${w}.kind`);
  const p = o['point'] === null ? null : obj(`${w}.point`, o['point']);
  const point = p ? { x: num(`${w}.x`, p['x']), y: num(`${w}.y`, p['y']), z: num(`${w}.z`, p['z']) } : null;
  if (kind === 'go' && !point) throw new Refused(`${w}.point`);
  return { kind, point };
}
