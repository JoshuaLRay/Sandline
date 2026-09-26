/**
 * The voice pipeline's data (T-2.48, ADR-017): the script people record
 * from, how a recording is split into takes, the loudness every line lands
 * at, the six slots' voice profiles, and the radio and distance treatments.
 * `tools/src/voice/` does the processing (`pnpm gen:voice`); this is the
 * shape and its validation, in `shared` so the page can name the files a
 * line was committed as without the DSP. Validated by hand, unknown keys
 * refused by name, every squelch a recipe that exists.
 */
import RAW from '../data/audio/voices.json' with { type: 'json' };
import { MAX_SLOTS } from '../net/Connection.ts';
import { type FilterDef, type ReverbDef, SOUNDS, type SoundsConfig, parseFilter } from './sounds.ts';

export const VOICE_STYLES = ['normal', 'shout', 'hurt'] as const;
export type VoiceStyle = (typeof VOICE_STYLES)[number];

export const VOICE_TREATMENTS = ['dry', 'radio', 'distant'] as const;
export type VoiceTreatment = (typeof VOICE_TREATMENTS)[number];

export interface VoiceSection {
  id: string;
  /** Said in the normal and shouted passes, in order. */
  lines: readonly string[];
  /** Said in the hurt pass, in order; empty when the section has none. */
  hurt: readonly string[];
  /** Which passes become game lines. */
  render: readonly VoiceStyle[];
}

export interface VoiceProfile {
  id: string;
  /** The fundamental's shift, semitones. */
  pitch: number;
  /** The formants' shift, semitones — separate from the pitch, so deeper is not slower. */
  formant: number;
  eq: readonly FilterDef[];
  /** The soft-clip drive a shout is saturated with. */
  shoutDrive: number;
  /** A recorded speaker by index into the sorted folder names; null for the slot modulo the speakers there are. */
  speaker: number | null;
}

export interface VoicesConfig {
  sampleRate: number;
  takesPerLine: number;
  sections: readonly VoiceSection[];
  split: { frameMs: number; thresholdDb: number; minSilenceMs: number; minTakeMs: number; padBeforeMs: number; padAfterMs: number };
  pitchRangeHz: readonly [number, number];
  loudness: { targetLufs: number; toleranceLu: number; ceilingDb: number };
  profiles: readonly VoiceProfile[];
  radio: { highpassHz: number; lowpassHz: number; drive: number; noiseDb: number; squelchIn: string; squelchOut: string };
  distant: { lowpassHz: number; reverb: ReverbDef };
  treatments: readonly VoiceTreatment[];
  variants: number;
  variantSemitones: number;
}

export class VoicesDataError extends Error {}

type Obj = Record<string, unknown>;

const ID = /^[a-z][a-z0-9-]{0,39}$/;

function obj(where: string, v: unknown, keys: readonly string[], optional: readonly string[] = []): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new VoicesDataError(`${where}: expected an object`);
  const o = v as Obj;
  for (const k of Object.keys(o)) if (!keys.includes(k) && !optional.includes(k) && k !== '$comment') throw new VoicesDataError(`${where}: unknown key '${k}'`);
  for (const k of keys) if (!(k in o)) throw new VoicesDataError(`${where}: missing '${k}'`);
  return o;
}

function num(where: string, v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new VoicesDataError(`${where} must be in [${min}, ${max}], got ${JSON.stringify(v)}`);
  return v;
}

function int(where: string, v: unknown, min: number, max: number): number {
  const n = num(where, v, min, max);
  if (!Number.isInteger(n)) throw new VoicesDataError(`${where} must be a whole number, got ${n}`);
  return n;
}

function ids(where: string, v: unknown, allowEmpty: boolean): string[] {
  if (!Array.isArray(v) || (!allowEmpty && v.length === 0)) throw new VoicesDataError(`${where} must be a ${allowEmpty ? '' : 'non-empty '}list of ids`);
  return v.map((s, i) => {
    if (typeof s !== 'string' || !ID.test(s)) throw new VoicesDataError(`${where}[${i}] must match ${ID}, got ${JSON.stringify(s)}`);
    return s;
  });
}

function oneOfList<T extends string>(where: string, v: unknown, options: readonly T[]): T[] {
  if (!Array.isArray(v) || v.length === 0) throw new VoicesDataError(`${where} must be a non-empty list`);
  const out = v.map((s, i) => {
    if (typeof s !== 'string' || !(options as readonly string[]).includes(s)) throw new VoicesDataError(`${where}[${i}] must be one of ${options.join(', ')}, got ${JSON.stringify(s)}`);
    return s as T;
  });
  if (new Set(out).size !== out.length) throw new VoicesDataError(`${where} lists one twice`);
  return out;
}

function parseFilters(where: string, v: unknown): FilterDef[] {
  if (!Array.isArray(v)) throw new VoicesDataError(`${where} must be a list of filters`);
  return v.map((f, i) => {
    try {
      return parseFilter(`${where}[${i}]`, f);
    } catch (e) {
      throw new VoicesDataError((e as Error).message);
    }
  });
}

/** Validate the voice file; every squelch must be a recipe in `sounds`. */
export function parseVoices(raw: unknown, sounds: SoundsConfig = SOUNDS): VoicesConfig {
  const o = obj('voices', raw, ['sampleRate', 'script', 'split', 'pitchRangeHz', 'loudness', 'profiles', 'radio', 'distant', 'treatments', 'variants', 'variantSemitones']);
  const script = obj('voices.script', o['script'], ['takesPerLine', 'sections']);
  const rawSections = script['sections'];
  if (typeof rawSections !== 'object' || rawSections === null || Array.isArray(rawSections)) throw new VoicesDataError('voices.script.sections must be an object of sections by id');
  const seen = new Set<string>();
  const sections: VoiceSection[] = [];
  for (const [id, def] of Object.entries(rawSections as Obj)) {
    if (id === '$comment') continue;
    const where = `voices.script.sections.${id}`;
    if (!ID.test(id)) throw new VoicesDataError(`${where}: id must match ${ID}`);
    const s = obj(where, def, ['lines', 'render'], ['hurt']);
    const lines = ids(`${where}.lines`, s['lines'], false);
    const hurt = s['hurt'] === undefined ? [] : ids(`${where}.hurt`, s['hurt'], true);
    for (const line of [...lines, ...hurt]) {
      if (seen.has(line)) throw new VoicesDataError(`${where}: line '${line}' is in the script twice`);
      seen.add(line);
    }
    const render = oneOfList(`${where}.render`, s['render'], VOICE_STYLES);
    if (render.includes('hurt') && hurt.length === 0) throw new VoicesDataError(`${where}.render: 'hurt' needs hurt lines`);
    sections.push({ id, lines, hurt, render });
  }
  if (sections.length === 0) throw new VoicesDataError('voices.script.sections must name at least one section');

  const sp = obj('voices.split', o['split'], ['frameMs', 'thresholdDb', 'minSilenceMs', 'minTakeMs', 'padBeforeMs', 'padAfterMs']);
  const pr = o['pitchRangeHz'];
  if (!Array.isArray(pr) || pr.length !== 2) throw new VoicesDataError('voices.pitchRangeHz must be [min, max]');
  const pitchRangeHz: [number, number] = [num('voices.pitchRangeHz[0]', pr[0], 30, 1000), num('voices.pitchRangeHz[1]', pr[1], 30, 1000)];
  if (pitchRangeHz[0] >= pitchRangeHz[1]) throw new VoicesDataError('voices.pitchRangeHz: min must be below max');
  const ld = obj('voices.loudness', o['loudness'], ['targetLufs', 'toleranceLu', 'ceilingDb']);

  const rawProfiles = o['profiles'];
  if (!Array.isArray(rawProfiles) || rawProfiles.length === 0) throw new VoicesDataError('voices.profiles must list the slots’ voices');
  const profiles = rawProfiles.map((p, i): VoiceProfile => {
    const where = `voices.profiles[${i}]`;
    const q = obj(where, p, ['id', 'pitch', 'formant', 'eq', 'shoutDrive'], ['speaker']);
    if (typeof q['id'] !== 'string' || !ID.test(q['id'])) throw new VoicesDataError(`${where}.id must match ${ID}`);
    return {
      id: q['id'],
      pitch: num(`${where}.pitch`, q['pitch'], -12, 12),
      formant: num(`${where}.formant`, q['formant'], -6, 6),
      eq: parseFilters(`${where}.eq`, q['eq']),
      shoutDrive: num(`${where}.shoutDrive`, q['shoutDrive'], 0, 20),
      speaker: q['speaker'] === undefined || q['speaker'] === null ? null : int(`${where}.speaker`, q['speaker'], 0, 64),
    };
  });
  if (new Set(profiles.map((p) => p.id)).size !== profiles.length) throw new VoicesDataError('voices.profiles: two profiles share an id');
  if (profiles.length !== MAX_SLOTS) throw new VoicesDataError(`voices.profiles must list ${MAX_SLOTS} voices, one a slot, got ${profiles.length}`);

  const rd = obj('voices.radio', o['radio'], ['highpassHz', 'lowpassHz', 'drive', 'noiseDb', 'squelchIn', 'squelchOut']);
  const squelch = (key: string): string => {
    const v = rd[key];
    if (typeof v !== 'string' || !sounds.sounds.has(v)) throw new VoicesDataError(`voices.radio.${key}: no sound '${String(v)}' in sounds.json`);
    return v;
  };
  const ds = obj('voices.distant', o['distant'], ['lowpassHz', 'reverb']);
  const rv = obj('voices.distant.reverb', ds['reverb'], ['seconds', 'mix', 'damp']);

  return {
    sampleRate: num('voices.sampleRate', o['sampleRate'], 8000, 48_000),
    takesPerLine: int('voices.script.takesPerLine', script['takesPerLine'], 1, 10),
    sections,
    split: {
      frameMs: num('voices.split.frameMs', sp['frameMs'], 1, 100),
      thresholdDb: num('voices.split.thresholdDb', sp['thresholdDb'], -90, -3),
      minSilenceMs: num('voices.split.minSilenceMs', sp['minSilenceMs'], 50, 5000),
      minTakeMs: num('voices.split.minTakeMs', sp['minTakeMs'], 10, 5000),
      padBeforeMs: num('voices.split.padBeforeMs', sp['padBeforeMs'], 0, 1000),
      padAfterMs: num('voices.split.padAfterMs', sp['padAfterMs'], 0, 1000),
    },
    pitchRangeHz,
    loudness: {
      targetLufs: num('voices.loudness.targetLufs', ld['targetLufs'], -40, -6),
      toleranceLu: num('voices.loudness.toleranceLu', ld['toleranceLu'], 0.05, 3),
      ceilingDb: num('voices.loudness.ceilingDb', ld['ceilingDb'], -12, 0),
    },
    profiles,
    radio: {
      highpassHz: num('voices.radio.highpassHz', rd['highpassHz'], 20, 2000),
      lowpassHz: num('voices.radio.lowpassHz', rd['lowpassHz'], 1000, 10_000),
      drive: num('voices.radio.drive', rd['drive'], 0, 20),
      noiseDb: num('voices.radio.noiseDb', rd['noiseDb'], -90, -10),
      squelchIn: squelch('squelchIn'),
      squelchOut: squelch('squelchOut'),
    },
    distant: {
      lowpassHz: num('voices.distant.lowpassHz', ds['lowpassHz'], 200, 10_000),
      reverb: { seconds: num('voices.distant.reverb.seconds', rv['seconds'], 0.05, 10), mix: num('voices.distant.reverb.mix', rv['mix'], 0, 1), damp: num('voices.distant.reverb.damp', rv['damp'], 0, 1) },
    },
    treatments: oneOfList('voices.treatments', o['treatments'], VOICE_TREATMENTS),
    variants: int('voices.variants', o['variants'], 1, 8),
    variantSemitones: num('voices.variantSemitones', o['variantSemitones'], 0, 3),
  };
}

export const VOICES: VoicesConfig = parseVoices(RAW);

/** The lines a section's pass is recorded with, in the order they are said. */
export function passLines(section: VoiceSection, style: VoiceStyle): readonly string[] {
  return style === 'hurt' ? section.hurt : section.lines;
}

/** The file a recording pass is uploaded as, without its extension. */
export function passFile(section: string, style: VoiceStyle): string {
  return `${section}-${style}`;
}

/** Where a processed line is committed, under `client/public/audio/voice/`. */
export function voiceFile(profile: string, line: string, style: VoiceStyle, treatment: VoiceTreatment, variant: number): string {
  return `${profile}/${line}.${style}.${treatment}.${variant}.wav`;
}
