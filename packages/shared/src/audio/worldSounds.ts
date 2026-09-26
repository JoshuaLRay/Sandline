/**
 * Which world and body sounds play when (T-2.47), as data: rounds going
 * past, impacts by surface, the grenade and the rocket, explosions near and
 * far, footsteps by stance, the vault and the landing, and bodies. Every
 * name must be a recipe — checked at import.
 */
import RAW from '../data/audio/worldSounds.json' with { type: 'json' };
import { SOUNDS, type SoundsConfig } from './sounds.ts';

export interface WorldSoundsConfig {
  nearMiss: { distanceM: number; crack: string; whiz: string };
  impacts: { wall: string; crate: string; post: string; ground: string };
  grenade: { throw: string; bounce: string };
  rocket: { launch: string; flight: string };
  explosion: { near: string; far: string; farM: number };
  footsteps: { walk: string; sprint: string; 'crouch-walk': string; prone: string };
  movement: { vault: string; land: string };
  landing: { minAirSeconds: number };
  bodies: { hit: string; downed: string; fall: string };
}

export class WorldSoundsDataError extends Error {}

type Obj = Record<string, unknown>;

export function parseWorldSounds(raw: unknown, sounds: SoundsConfig = SOUNDS): WorldSoundsConfig {
  const obj = (where: string, v: unknown, keys: readonly string[]): Obj => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new WorldSoundsDataError(`${where}: expected an object`);
    const o = v as Obj;
    for (const k of Object.keys(o)) if (!keys.includes(k) && k !== '$comment') throw new WorldSoundsDataError(`${where}: unknown key '${k}'`);
    for (const k of keys) if (!(k in o)) throw new WorldSoundsDataError(`${where}: missing '${k}'`);
    return o;
  };
  const sound = (where: string, v: unknown): string => {
    if (typeof v !== 'string' || !sounds.sounds.has(v)) throw new WorldSoundsDataError(`${where}: no sound '${String(v)}' in sounds.json`);
    return v;
  };
  const num = (where: string, v: unknown, min: number, max: number): number => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new WorldSoundsDataError(`${where} must be in [${min}, ${max}], got ${JSON.stringify(v)}`);
    return v;
  };
  /** A group of named sounds, each checked. */
  const group = <K extends string>(name: string, v: unknown, keys: readonly K[]): Record<K, string> => {
    const o = obj(`worldSounds.${name}`, v, keys);
    const out = {} as Record<K, string>;
    for (const k of keys) out[k] = sound(`worldSounds.${name}.${k}`, o[k]);
    return out;
  };
  const o = obj('worldSounds', raw, ['nearMiss', 'impacts', 'grenade', 'rocket', 'explosion', 'footsteps', 'movement', 'landing', 'bodies']);
  const nm = obj('worldSounds.nearMiss', o['nearMiss'], ['distanceM', 'crack', 'whiz']);
  const ex = obj('worldSounds.explosion', o['explosion'], ['near', 'far', 'farM']);
  const land = obj('worldSounds.landing', o['landing'], ['minAirSeconds']);
  return {
    nearMiss: { distanceM: num('worldSounds.nearMiss.distanceM', nm['distanceM'], 0.1, 50), crack: sound('worldSounds.nearMiss.crack', nm['crack']), whiz: sound('worldSounds.nearMiss.whiz', nm['whiz']) },
    impacts: group('impacts', o['impacts'], ['wall', 'crate', 'post', 'ground'] as const),
    grenade: group('grenade', o['grenade'], ['throw', 'bounce'] as const),
    rocket: group('rocket', o['rocket'], ['launch', 'flight'] as const),
    explosion: { near: sound('worldSounds.explosion.near', ex['near']), far: sound('worldSounds.explosion.far', ex['far']), farM: num('worldSounds.explosion.farM', ex['farM'], 1, 10_000) },
    footsteps: group('footsteps', o['footsteps'], ['walk', 'sprint', 'crouch-walk', 'prone'] as const),
    movement: group('movement', o['movement'], ['vault', 'land'] as const),
    landing: { minAirSeconds: num('worldSounds.landing.minAirSeconds', land['minAirSeconds'], 0, 10) },
    bodies: group('bodies', o['bodies'], ['hit', 'downed', 'fall'] as const),
  };
}

export const WORLD_SOUNDS: WorldSoundsConfig = parseWorldSounds(RAW);
