/**
 * Which sounds a gun makes (T-2.46), as data: a near and a far report per
 * gun, the distance the two cross-fade over, and the handling sounds with
 * the points of a reload they play at. Every sound named must be a recipe,
 * and every gun a weapon row — checked at import.
 */
import RAW from '../data/audio/weaponSounds.json' with { type: 'json' };
import { WEAPONS } from '../sim/weapons.ts';
import { SOUNDS, type SoundsConfig } from './sounds.ts';

export interface WeaponSoundsConfig {
  crossfade: { nearM: number; farM: number };
  /** `cycle`: a bolt-action gun's own sound, played `delaySeconds` after each shot (U-043). */
  guns: Readonly<Record<string, { near: string; far: string; cycle?: { sound: string; delaySeconds: number } }>>;
  handling: { reloadOut: string; reloadIn: string; reloadBolt: string; dryFire: string; equip: string };
  stages: { in: number; bolt: number };
}

export class WeaponSoundsDataError extends Error {}

type Obj = Record<string, unknown>;

function obj(where: string, v: unknown, keys: readonly string[], optional: readonly string[] = []): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new WeaponSoundsDataError(`${where}: expected an object`);
  const o = v as Obj;
  for (const k of Object.keys(o)) if (!keys.includes(k) && !optional.includes(k) && k !== '$comment') throw new WeaponSoundsDataError(`${where}: unknown key '${k}'`);
  for (const k of keys) if (!(k in o)) throw new WeaponSoundsDataError(`${where}: missing '${k}'`);
  return o;
}

function fraction(where: string, v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v >= 1) throw new WeaponSoundsDataError(`${where} must be in (0, 1), got ${JSON.stringify(v)}`);
  return v;
}

export function parseWeaponSounds(raw: unknown, sounds: SoundsConfig = SOUNDS): WeaponSoundsConfig {
  const o = obj('weaponSounds', raw, ['crossfade', 'guns', 'handling', 'stages']);
  const sound = (where: string, v: unknown): string => {
    if (typeof v !== 'string' || !sounds.sounds.has(v)) throw new WeaponSoundsDataError(`${where}: no sound '${String(v)}' in sounds.json`);
    return v;
  };
  const c = obj('weaponSounds.crossfade', o['crossfade'], ['nearM', 'farM']);
  const nearM = c['nearM'];
  const farM = c['farM'];
  if (typeof nearM !== 'number' || typeof farM !== 'number' || !(nearM >= 0) || !(farM > nearM)) throw new WeaponSoundsDataError('weaponSounds.crossfade: need 0 <= nearM < farM');
  const g = o['guns'];
  if (typeof g !== 'object' || g === null || Array.isArray(g)) throw new WeaponSoundsDataError('weaponSounds.guns: expected an object');
  const guns: Record<string, { near: string; far: string; cycle?: { sound: string; delaySeconds: number } }> = {};
  for (const [id, row] of Object.entries(g as Obj)) {
    if (id === '$comment') continue;
    if (!(id in WEAPONS)) throw new WeaponSoundsDataError(`weaponSounds.guns: '${id}' is not a weapons.json row`);
    const r = obj(`weaponSounds.guns.${id}`, row, ['near', 'far'], ['cycle']);
    guns[id] = { near: sound(`weaponSounds.guns.${id}.near`, r['near']), far: sound(`weaponSounds.guns.${id}.far`, r['far']) };
    if (r['cycle'] !== undefined) {
      const c = obj(`weaponSounds.guns.${id}.cycle`, r['cycle'], ['sound', 'delaySeconds']);
      const delay = c['delaySeconds'];
      if (typeof delay !== 'number' || !Number.isFinite(delay) || delay <= 0 || delay > 5) throw new WeaponSoundsDataError(`weaponSounds.guns.${id}.cycle.delaySeconds must be in (0, 5], got ${JSON.stringify(delay)}`);
      guns[id].cycle = { sound: sound(`weaponSounds.guns.${id}.cycle.sound`, c['sound']), delaySeconds: delay };
    }
  }
  for (const id of Object.keys(WEAPONS)) if (!guns[id]) throw new WeaponSoundsDataError(`weaponSounds.guns: no sounds for '${id}'`);
  const h = obj('weaponSounds.handling', o['handling'], ['reloadOut', 'reloadIn', 'reloadBolt', 'dryFire', 'equip']);
  const s = obj('weaponSounds.stages', o['stages'], ['in', 'bolt']);
  const stages = { in: fraction('weaponSounds.stages.in', s['in']), bolt: fraction('weaponSounds.stages.bolt', s['bolt']) };
  if (stages.bolt <= stages.in) throw new WeaponSoundsDataError('weaponSounds.stages: bolt must come after in');
  return {
    crossfade: { nearM, farM },
    guns,
    handling: {
      reloadOut: sound('weaponSounds.handling.reloadOut', h['reloadOut']),
      reloadIn: sound('weaponSounds.handling.reloadIn', h['reloadIn']),
      reloadBolt: sound('weaponSounds.handling.reloadBolt', h['reloadBolt']),
      dryFire: sound('weaponSounds.handling.dryFire', h['dryFire']),
      equip: sound('weaponSounds.handling.equip', h['equip']),
    },
    stages,
  };
}

export const WEAPON_SOUNDS: WeaponSoundsConfig = parseWeaponSounds(RAW);
