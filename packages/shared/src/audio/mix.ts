/**
 * How sounds are placed in the world (T-2.45, ADR-017), as data: a falloff
 * curve per sound class, what a box between the ear and the source does,
 * the voice limit and who keeps a voice under it, and the speed of sound.
 * The page's engine reads it; the numbers here and the pure functions over
 * them (`falloffGain`, `voicePriority`, `soundDelaySeconds`) are what its
 * tests hold it to.
 */
import RAW_MIX from '../data/audio/mix.json' with { type: 'json' };
import { SOUND_CLASSES, type SoundClass } from './sounds.ts';

export interface MixClass {
  priority: number;
  /** [metres, gain] points, ascending; null plays unplaced. */
  falloff: readonly (readonly [number, number])[] | null;
}

export interface MixConfig {
  speedOfSound: number;
  voiceLimit: number;
  priority: { ownBonus: number; perMetre: number };
  occlusion: { lowpassHz: number; gainDb: number };
  classes: Readonly<Record<SoundClass, MixClass>>;
}

export class MixDataError extends Error {}

type Obj = Record<string, unknown>;

function obj(where: string, v: unknown, keys: readonly string[]): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new MixDataError(`${where}: expected an object`);
  const o = v as Obj;
  for (const k of Object.keys(o)) if (!keys.includes(k) && k !== '$comment') throw new MixDataError(`${where}: unknown key '${k}'`);
  for (const k of keys) if (!(k in o)) throw new MixDataError(`${where}: missing '${k}'`);
  return o;
}

function num(where: string, v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new MixDataError(`${where} must be a number in [${min}, ${max}], got ${JSON.stringify(v)}`);
  return v;
}

function parseFalloff(where: string, v: unknown): MixClass['falloff'] {
  if (v === null) return null;
  if (!Array.isArray(v) || v.length < 2) throw new MixDataError(`${where} must be null or at least two [metres, gain] points`);
  let last = -1;
  return v.map((p, i) => {
    if (!Array.isArray(p) || p.length !== 2) throw new MixDataError(`${where}[${i}] must be [metres, gain]`);
    const d = num(`${where}[${i}][0]`, p[0], 0, 10_000);
    if (d <= last) throw new MixDataError(`${where}[${i}]: distances must ascend`);
    last = d;
    return [d, num(`${where}[${i}][1]`, p[1], 0, 1)] as const;
  });
}

export function parseMix(raw: unknown): MixConfig {
  const o = obj('mix', raw, ['speedOfSound', 'voiceLimit', 'priority', 'occlusion', 'classes']);
  const p = obj('mix.priority', o['priority'], ['ownBonus', 'perMetre']);
  const oc = obj('mix.occlusion', o['occlusion'], ['lowpassHz', 'gainDb']);
  const c = obj('mix.classes', o['classes'], SOUND_CLASSES);
  const classes = {} as Record<SoundClass, MixClass>;
  for (const id of SOUND_CLASSES) {
    const row = obj(`mix.classes.${id}`, c[id], ['priority', 'falloff']);
    classes[id] = { priority: num(`mix.classes.${id}.priority`, row['priority'], 0, 1000), falloff: parseFalloff(`mix.classes.${id}.falloff`, row['falloff']) };
  }
  const voiceLimit = num('mix.voiceLimit', o['voiceLimit'], 1, 256);
  if (!Number.isInteger(voiceLimit)) throw new MixDataError('mix.voiceLimit must be a whole number');
  return {
    speedOfSound: num('mix.speedOfSound', o['speedOfSound'], 1, 10_000),
    voiceLimit,
    priority: { ownBonus: num('mix.priority.ownBonus', p['ownBonus'], 0, 1000), perMetre: num('mix.priority.perMetre', p['perMetre'], 0, 100) },
    occlusion: { lowpassHz: num('mix.occlusion.lowpassHz', oc['lowpassHz'], 20, 20_000), gainDb: num('mix.occlusion.gainDb', oc['gainDb'], -60, 0) },
    classes,
  };
}

export const MIX: MixConfig = parseMix(RAW_MIX);

/** A class's gain at a distance: linear between the curve's points, held past either end; 1 for an unplaced class. */
export function falloffGain(curve: MixClass['falloff'], distanceM: number): number {
  if (curve === null) return 1;
  const d = Math.max(0, distanceM);
  const first = curve[0]!;
  if (d <= first[0]) return first[1];
  for (let i = 1; i < curve.length; i += 1) {
    const b = curve[i]!;
    if (d <= b[0]) {
      const a = curve[i - 1]!;
      return a[1] + ((d - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
    }
  }
  return curve[curve.length - 1]![1];
}

/** Who keeps a voice: the class's priority, plus `ownBonus` for your own sound, less `perMetre` a metre away. */
export function voicePriority(mix: MixConfig, cls: SoundClass, own: boolean, distanceM: number): number {
  return mix.classes[cls].priority + (own ? mix.priority.ownBonus : 0) - mix.priority.perMetre * Math.max(0, distanceM);
}

/** How long a sound takes to arrive. */
export function soundDelaySeconds(mix: MixConfig, distanceM: number): number {
  return Math.max(0, distanceM) / mix.speedOfSound;
}

/** A dB change as a gain factor. */
export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}
