/**
 * Weapon emplacements (T-4.29): the mounted MG, as data and as the rules
 * both sides agree on.
 *
 * An emplacement is a static entity a level places (`World.emplacements`):
 * a gun on a mount, facing a way, with a traverse arc and elevation limits.
 * A soldier who stands behind it and presses interact mounts it; the gun
 * fires through the same path a hand-held weapon does, with its `weapon`
 * row's numbers (the LMG's), plus HEAT: rounds warm it, time cools it, and
 * an overheated gun will not fire until it has cooled below `fireBelow`.
 * The gunner is held crouched at the gunner's place, so a low wall in front
 * covers the body and leaves the head exposed — that is the level's to
 * arrange, and `docs`'s mission-01 does.
 *
 * What lives here is pure: the data (validated by hand, unknown keys refused
 * by name, as `weapons.json` is), the arc and elevation clamps in WIRE angle
 * units (1024 a turn, what the session and the page both hold a facing in),
 * the heat curve as functions of (definition, state, dt), and where the
 * gunner stands and the rounds leave for a placed gun. The session mounts,
 * pins and fires (`server/src/session/Session.ts`); the page draws and asks.
 */
import RAW_EMPLACEMENTS from '../data/emplacements.json' with { type: 'json' };
import { ANGLE_UNITS, WIRE_ANGLE_UNITS, WIRE_TO_TABLE_SHIFT } from '../math/angles.ts';
import { cos, sin } from '../math/trig.ts';
import { WEAPONS, type WeaponDef } from './weapons.ts';

export interface EmplacementHeat {
  /** Heat one round adds, of 1. */
  readonly perShot: number;
  /** Heat lost a second, always. */
  readonly coolPerSecond: number;
  /** An overheated gun fires again once its heat is below this. */
  readonly fireBelow: number;
}

export interface EmplacementAi {
  /** An enemy carrying the gun's weapon this near an empty gun takes it, metres. */
  readonly takeWithinM: number;
  /** Its target outside the arc this long, and it leaves the gun, seconds. */
  readonly leaveAfterSeconds: number;
}

export interface EmplacementDef {
  readonly id: string;
  readonly name: string;
  /** A `weapons.json` row: what the gun fires with. */
  readonly weapon: string;
  /** Half the traverse arc, degrees either side of the facing. */
  readonly traverseDeg: number;
  /** Elevation limits below and above level, degrees. */
  readonly elevationDownDeg: number;
  readonly elevationUpDeg: number;
  /** How near a soldier's feet must be to the gunner's place to mount, metres. */
  readonly mountRangeM: number;
  /** Where the gunner stands: this far behind the gun, along its facing. */
  readonly gunnerBackM: number;
  /** Where the rounds leave: this far above the gun's place. */
  readonly gunHeightM: number;
  readonly heat: EmplacementHeat;
  readonly ai: EmplacementAi;
}

/**
 * Wire order for emplacement kinds, as `PROJECTILE_IDS` is for projectiles:
 * the index is the `Emplacement` component's `kind`. Two bits hold four.
 */
export const EMPLACEMENT_IDS = ['mg-nest'] as const;
export const EMPLACEMENT_KIND_BITS = 2;
/** The heat field's width on the wire: whole percent. */
export const EMPLACEMENT_HEAT_BITS = 7;

export class EmplacementDataError extends Error {}

type Obj = Record<string, unknown>;

function obj(where: string, v: unknown, keys: readonly string[]): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new EmplacementDataError(`${where}: expected an object`);
  const o = v as Obj;
  for (const k of Object.keys(o)) if (!keys.includes(k) && k !== '$comment') throw new EmplacementDataError(`${where}: unknown key '${k}'`);
  for (const k of keys) if (!(k in o)) throw new EmplacementDataError(`${where}: missing '${k}'`);
  return o;
}

function num(where: string, v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new EmplacementDataError(`${where} must be a finite number, got ${JSON.stringify(v)}`);
  if (v < min || v > max) throw new EmplacementDataError(`${where} must be in [${min}, ${max}], got ${v}`);
  return v;
}

function parseDef(id: string, raw: unknown, weapons: Readonly<Record<string, WeaponDef>> = WEAPONS): EmplacementDef {
  const where = `emplacements.${id}`;
  const o = obj(where, raw, ['id', 'name', 'weapon', 'traverseDeg', 'elevationDownDeg', 'elevationUpDeg', 'mountRangeM', 'gunnerBackM', 'gunHeightM', 'heat', 'ai']);
  if (o['id'] !== id) throw new EmplacementDataError(`${where}.id must be '${id}', got ${JSON.stringify(o['id'])}`);
  if (typeof o['name'] !== 'string' || o['name'].length === 0) throw new EmplacementDataError(`${where}.name must be a non-empty string`);
  if (typeof o['weapon'] !== 'string' || !(o['weapon'] in weapons)) throw new EmplacementDataError(`${where}.weapon must name a weapons.json row, got ${JSON.stringify(o['weapon'])}`);
  const heat = obj(`${where}.heat`, o['heat'], ['perShot', 'coolPerSecond', 'fireBelow']);
  const ai = obj(`${where}.ai`, o['ai'], ['takeWithinM', 'leaveAfterSeconds']);
  return {
    id,
    name: o['name'],
    weapon: o['weapon'],
    traverseDeg: num(`${where}.traverseDeg`, o['traverseDeg'], 1, 179),
    elevationDownDeg: num(`${where}.elevationDownDeg`, o['elevationDownDeg'], 0, 89),
    elevationUpDeg: num(`${where}.elevationUpDeg`, o['elevationUpDeg'], 0, 89),
    mountRangeM: num(`${where}.mountRangeM`, o['mountRangeM'], 0.1, 5),
    gunnerBackM: num(`${where}.gunnerBackM`, o['gunnerBackM'], 0, 2),
    gunHeightM: num(`${where}.gunHeightM`, o['gunHeightM'], 0.2, 2),
    heat: {
      perShot: num(`${where}.heat.perShot`, heat['perShot'], 0.0001, 1),
      coolPerSecond: num(`${where}.heat.coolPerSecond`, heat['coolPerSecond'], 0.0001, 10),
      fireBelow: num(`${where}.heat.fireBelow`, heat['fireBelow'], 0, 0.999),
    },
    ai: {
      takeWithinM: num(`${where}.ai.takeWithinM`, ai['takeWithinM'], 0, 50),
      leaveAfterSeconds: num(`${where}.ai.leaveAfterSeconds`, ai['leaveAfterSeconds'], 0, 600),
    },
  };
}

/** Validate the emplacement table. Every wire id must have a row, and nothing else may. */
export function parseEmplacements(raw: unknown, weapons: Readonly<Record<string, WeaponDef>> = WEAPONS): ReadonlyMap<string, EmplacementDef> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new EmplacementDataError('emplacements: expected an object');
  const out = new Map<string, EmplacementDef>();
  for (const [id, row] of Object.entries(raw as Obj)) {
    if (id === '$comment') continue;
    if (!(EMPLACEMENT_IDS as readonly string[]).includes(id)) throw new EmplacementDataError(`emplacements: '${id}' is not a wire id (${EMPLACEMENT_IDS.join(', ')})`);
    out.set(id, parseDef(id, row, weapons));
  }
  for (const id of EMPLACEMENT_IDS) if (!out.has(id)) throw new EmplacementDataError(`emplacements: no row for '${id}'`);
  return out;
}

export const EMPLACEMENTS: ReadonlyMap<string, EmplacementDef> = parseEmplacements(RAW_EMPLACEMENTS);

export function getEmplacement(id: string): EmplacementDef {
  const def = EMPLACEMENTS.get(id);
  if (!def) throw new RangeError(`unknown emplacement '${id}'`);
  return def;
}

/** The wire index of a kind. */
export function emplacementIndex(id: string): number {
  return (EMPLACEMENT_IDS as readonly string[]).indexOf(id);
}

/** The definition at a wire index, or null for one this build has no row for. */
export function emplacementByIndex(index: number): EmplacementDef | null {
  const id = EMPLACEMENT_IDS[index];
  return id === undefined ? null : getEmplacement(id);
}

// -- Arc and elevation ---------------------------------------------------------

/** Degrees to wire angle units, rounded, in [0, 1024). */
export function degToWire(deg: number): number {
  const units = Math.round((deg / 360) * WIRE_ANGLE_UNITS);
  return ((units % WIRE_ANGLE_UNITS) + WIRE_ANGLE_UNITS) % WIRE_ANGLE_UNITS;
}

/** A wire angle difference as the short way round: −512..511. */
export function signedWire(delta: number): number {
  const half = WIRE_ANGLE_UNITS / 2;
  return ((((delta + half) % WIRE_ANGLE_UNITS) + WIRE_ANGLE_UNITS) % WIRE_ANGLE_UNITS) - half;
}

/** Whether a yaw lies within the traverse arc round a facing. */
export function withinArc(facing: number, yaw: number, traverseDeg: number): boolean {
  return Math.abs(signedWire(yaw - facing)) <= degToWire(traverseDeg);
}

/** A yaw held inside the traverse arc round a facing: unchanged inside, the nearer stop outside. Wire units, [0, 1024). */
export function clampYawToArc(facing: number, yaw: number, traverseDeg: number): number {
  const half = degToWire(traverseDeg);
  const off = signedWire(yaw - facing);
  const held = off > half ? half : off < -half ? -half : off;
  return (((facing + held) % WIRE_ANGLE_UNITS) + WIRE_ANGLE_UNITS) % WIRE_ANGLE_UNITS;
}

/** A pitch held between the elevation limits. Signed wire units in, signed wire units out (up positive). */
export function clampPitch(pitch: number, def: Pick<EmplacementDef, 'elevationDownDeg' | 'elevationUpDeg'>): number {
  const p = signedWire(pitch);
  const up = degToWire(def.elevationUpDeg);
  const down = degToWire(def.elevationDownDeg);
  return p > up ? up : p < -down ? -down : p;
}

// -- Heat ----------------------------------------------------------------------

export interface HeatState {
  /** 0..1. */
  heat: number;
  /** Set when the heat reaches 1; cleared once it has cooled below `fireBelow`. */
  overheated: boolean;
}

export function createHeat(): HeatState {
  return { heat: 0, overheated: false };
}

/** One round fired: warmer, and overheated at 1. */
export function heatShot(def: EmplacementDef, state: HeatState): void {
  state.heat += def.heat.perShot;
  if (state.heat >= 1 - 1e-9) {
    state.heat = 1;
    state.overheated = true;
  }
}

/** Time passing: cooler, and fit to fire again below `fireBelow`. Call once a tick with the tick's dt, never with a clock read. */
export function coolHeat(def: EmplacementDef, state: HeatState, dt: number): void {
  state.heat = Math.max(0, state.heat - def.heat.coolPerSecond * dt);
  if (state.overheated && state.heat < def.heat.fireBelow) state.overheated = false;
}

/** Whether the gun will fire as far as heat goes. */
export function canFireHot(state: HeatState): boolean {
  return !state.overheated;
}

/** The heat as the wire carries it: whole percent. */
export function heatToWire(state: HeatState): number {
  return Math.min(100, Math.max(0, Math.round(state.heat * 100)));
}

// -- Placement -----------------------------------------------------------------

/** An emplacement as a level places it: where, which kind, and the way it faces. */
export interface PlacedEmplacement {
  readonly id: string;
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The facing, degrees: 0 faces +Z, 90 faces +X (the compass's west). */
  readonly yawDeg: number;
}

const INSTANCE_ID = /^[a-z0-9][a-z0-9-]*$/;

/** Validate a world file's `emplacements` list; absent is none. */
export function parsePlacedEmplacements(where: string, raw: unknown): PlacedEmplacement[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new EmplacementDataError(`${where}: emplacements must be a list`);
  const seen = new Set<string>();
  return raw.map((entry, i) => {
    const at = `${where} emplacements[${i}]`;
    const o = obj(at, entry, ['id', 'kind', 'x', 'y', 'z', 'yawDeg']);
    if (typeof o['id'] !== 'string' || !INSTANCE_ID.test(o['id'])) throw new EmplacementDataError(`${at}: id must match ${INSTANCE_ID}`);
    if (seen.has(o['id'])) throw new EmplacementDataError(`${at}: id '${o['id']}' is used twice`);
    seen.add(o['id']);
    if (typeof o['kind'] !== 'string' || !EMPLACEMENTS.has(o['kind'])) throw new EmplacementDataError(`${at} '${o['id']}': kind must be one of ${EMPLACEMENT_IDS.join(', ')}`);
    return {
      id: o['id'],
      kind: o['kind'],
      x: num(`${at}.x`, o['x'], -1e4, 1e4),
      y: num(`${at}.y`, o['y'], -1e3, 1e3),
      z: num(`${at}.z`, o['z'], -1e4, 1e4),
      yawDeg: num(`${at}.yawDeg`, o['yawDeg'], -360, 360),
    };
  });
}

/** The facing as a wire angle. */
export function emplacementFacing(placed: Pick<PlacedEmplacement, 'yawDeg'>): number {
  return degToWire(placed.yawDeg);
}

/** Where the gunner's feet are: behind the gun along its facing. */
export function gunnerPlace(placed: PlacedEmplacement, def: EmplacementDef): { x: number; y: number; z: number } {
  const table = (emplacementFacing(placed) << WIRE_TO_TABLE_SHIFT) % ANGLE_UNITS;
  return { x: placed.x - sin(table) * def.gunnerBackM, y: placed.y, z: placed.z - cos(table) * def.gunnerBackM };
}

/** Where the rounds leave: the gun's place, at its height. */
export function gunMuzzle(placed: PlacedEmplacement, def: EmplacementDef): { x: number; y: number; z: number } {
  return { x: placed.x, y: placed.y + def.gunHeightM, z: placed.z };
}
