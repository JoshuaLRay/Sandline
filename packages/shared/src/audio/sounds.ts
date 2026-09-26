/**
 * Sound recipes (T-2.44, ADR-017): every effect the game plays is a recipe
 * in `data/audio/sounds.json` — layers of a source (seeded noise, an
 * oscillator, an impulse) shaped by an envelope, filters, drive, a delay
 * and a reverb — rendered offline by `tools/src/audio/` into committed
 * files. This is the recipe's shape and its validation, in `shared` so the
 * page can read the manifest of what exists without the DSP; the DSP itself
 * is the tools', and never runs in the page.
 *
 * Every recipe declares BOUNDS on what its render must measure — peak,
 * loudness and length — so a test can say a render is out of shape without
 * an ear. Validated by hand, unknown keys refused by name.
 */
import RAW_SOUNDS from '../data/audio/sounds.json' with { type: 'json' };

/** The rate every recipe is rendered and mixed at. */
export const AUDIO_SAMPLE_RATE = 48_000;

export const SOUND_CLASSES = ['ui', 'weapon', 'world', 'body', 'voice'] as const;
export type SoundClass = (typeof SOUND_CLASSES)[number];

export const OSC_WAVES = ['sine', 'triangle', 'square', 'saw'] as const;
export type OscWave = (typeof OSC_WAVES)[number];

export type SourceDef =
  /** White noise from the shared PRNG, seeded per sound and variant. */
  | { kind: 'noise' }
  /** A waveform at `hz`, sweeping to `toHz` over `sweepSeconds` when set. */
  | { kind: 'osc'; wave: OscWave; hz: number; toHz: number | null; sweepSeconds: number }
  /** One full-scale sample: what a filter or a reverb rings from. */
  | { kind: 'impulse' };

export interface EnvelopeDef {
  attack: number;
  hold: number;
  decay: number;
  /** `exp` falls by 60 dB over `decay`; `linear` reaches zero at its end. */
  curve: 'linear' | 'exp';
}

export const FILTER_KINDS = ['lowpass', 'highpass', 'bandpass', 'peak'] as const;
export type FilterKind = (typeof FILTER_KINDS)[number];

export interface FilterDef {
  kind: FilterKind;
  hz: number;
  q: number;
  /** A peaking filter's boost or cut; 0 for the others. */
  gainDb: number;
  /** The cutoff sweeps to `toHz` over `sweepSeconds` when set. */
  toHz: number | null;
  sweepSeconds: number;
}

export interface DelayDef {
  seconds: number;
  /** 0..0.95 of each echo fed back. */
  feedback: number;
  /** 0..1 of the echoes in the output. */
  mix: number;
}

export interface ReverbDef {
  /** How long the tail takes to fall by 60 dB. */
  seconds: number;
  mix: number;
  /** 0..1: how much high end each reflection loses. */
  damp: number;
}

/** How much each variant may differ from the recipe, as fractions. */
export interface JitterDef {
  hz: number;
  gain: number;
  seconds: number;
}

export interface LayerDef {
  source: SourceDef;
  envelope: EnvelopeDef;
  filters: readonly FilterDef[];
  /** 0 for clean; otherwise the drive into a soft clip, in multiples of full scale. */
  drive: number;
  delay: DelayDef | null;
  reverb: ReverbDef | null;
  gain: number;
  /** Seconds into the sound the layer starts. */
  start: number;
  jitter: JitterDef;
}

export interface SoundBounds {
  /** dBFS. */
  peakDb: readonly [number, number];
  /** RMS over the whole render, dBFS: the loudness a test can measure. */
  rmsDb: readonly [number, number];
  /** Seconds to the last sample above −60 dBFS. */
  seconds: readonly [number, number];
}

export interface SoundDef {
  id: string;
  class: SoundClass;
  /** The render's length. */
  seconds: number;
  /** How many seeded variants are rendered. */
  variants: number;
  /** The render is normalised so its peak is this, dBFS. */
  normalizePeakDb: number;
  bounds: SoundBounds;
  layers: readonly LayerDef[];
}

export interface SoundsConfig {
  readonly sampleRate: number;
  readonly sounds: ReadonlyMap<string, SoundDef>;
}

export class SoundsDataError extends Error {}

type Obj = Record<string, unknown>;

function obj(where: string, v: unknown, keys: readonly string[], optional: readonly string[] = []): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SoundsDataError(`${where}: expected an object`);
  const o = v as Obj;
  for (const k of Object.keys(o)) if (!keys.includes(k) && !optional.includes(k) && k !== '$comment') throw new SoundsDataError(`${where}: unknown key '${k}'`);
  for (const k of keys) if (!(k in o)) throw new SoundsDataError(`${where}: missing '${k}'`);
  return o;
}

function num(where: string, v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new SoundsDataError(`${where} must be a finite number, got ${JSON.stringify(v)}`);
  if (v < min || v > max) throw new SoundsDataError(`${where} must be in [${min}, ${max}], got ${v}`);
  return v;
}

function oneOf<T extends string>(where: string, v: unknown, options: readonly T[]): T {
  if (typeof v !== 'string' || !(options as readonly string[]).includes(v)) throw new SoundsDataError(`${where} must be one of ${options.join(', ')}, got ${JSON.stringify(v)}`);
  return v as T;
}

function range(where: string, v: unknown, min: number, max: number): [number, number] {
  if (!Array.isArray(v) || v.length !== 2) throw new SoundsDataError(`${where} must be [min, max]`);
  const lo = num(`${where}[0]`, v[0], min, max);
  const hi = num(`${where}[1]`, v[1], min, max);
  if (lo > hi) throw new SoundsDataError(`${where}: min ${lo} is above max ${hi}`);
  return [lo, hi];
}

function parseSource(where: string, raw: unknown): SourceDef {
  const head = obj(where, raw, ['kind'], ['wave', 'hz', 'toHz', 'sweepSeconds']);
  const kind = oneOf(`${where}.kind`, head['kind'], ['noise', 'osc', 'impulse'] as const);
  if (kind === 'osc') {
    const o = obj(where, raw, ['kind', 'wave', 'hz'], ['toHz', 'sweepSeconds']);
    const toHz = o['toHz'] === undefined || o['toHz'] === null ? null : num(`${where}.toHz`, o['toHz'], 1, 20_000);
    return {
      kind,
      wave: oneOf(`${where}.wave`, o['wave'], OSC_WAVES),
      hz: num(`${where}.hz`, o['hz'], 1, 20_000),
      toHz,
      sweepSeconds: o['sweepSeconds'] === undefined ? 0 : num(`${where}.sweepSeconds`, o['sweepSeconds'], 0, 30),
    };
  }
  obj(where, raw, ['kind']);
  return { kind };
}

function parseEnvelope(where: string, raw: unknown): EnvelopeDef {
  const o = obj(where, raw, ['attack', 'decay'], ['hold', 'curve']);
  return {
    attack: num(`${where}.attack`, o['attack'], 0, 30),
    hold: o['hold'] === undefined ? 0 : num(`${where}.hold`, o['hold'], 0, 30),
    decay: num(`${where}.decay`, o['decay'], 0.0001, 30),
    curve: o['curve'] === undefined ? 'exp' : oneOf(`${where}.curve`, o['curve'], ['linear', 'exp'] as const),
  };
}

export function parseFilter(where: string, raw: unknown): FilterDef {
  const o = obj(where, raw, ['kind', 'hz'], ['q', 'gainDb', 'toHz', 'sweepSeconds']);
  const kind = oneOf(`${where}.kind`, o['kind'], FILTER_KINDS);
  const gainDb = o['gainDb'] === undefined ? 0 : num(`${where}.gainDb`, o['gainDb'], -40, 40);
  if (kind !== 'peak' && gainDb !== 0) throw new SoundsDataError(`${where}.gainDb is a peaking filter's; a ${kind} takes none`);
  return {
    kind,
    hz: num(`${where}.hz`, o['hz'], 10, 20_000),
    q: o['q'] === undefined ? 0.7071 : num(`${where}.q`, o['q'], 0.1, 50),
    gainDb,
    toHz: o['toHz'] === undefined || o['toHz'] === null ? null : num(`${where}.toHz`, o['toHz'], 10, 20_000),
    sweepSeconds: o['sweepSeconds'] === undefined ? 0 : num(`${where}.sweepSeconds`, o['sweepSeconds'], 0, 30),
  };
}

function parseLayer(where: string, raw: unknown): LayerDef {
  const o = obj(where, raw, ['source', 'envelope'], ['filters', 'drive', 'delay', 'reverb', 'gain', 'start', 'jitter']);
  const filters = o['filters'] === undefined ? [] : o['filters'];
  if (!Array.isArray(filters)) throw new SoundsDataError(`${where}.filters must be a list`);
  let delay: DelayDef | null = null;
  if (o['delay'] !== undefined && o['delay'] !== null) {
    const d = obj(`${where}.delay`, o['delay'], ['seconds'], ['feedback', 'mix']);
    delay = {
      seconds: num(`${where}.delay.seconds`, d['seconds'], 0.0005, 5),
      feedback: d['feedback'] === undefined ? 0 : num(`${where}.delay.feedback`, d['feedback'], 0, 0.95),
      mix: d['mix'] === undefined ? 0.5 : num(`${where}.delay.mix`, d['mix'], 0, 1),
    };
  }
  let reverb: ReverbDef | null = null;
  if (o['reverb'] !== undefined && o['reverb'] !== null) {
    const r = obj(`${where}.reverb`, o['reverb'], ['seconds'], ['mix', 'damp']);
    reverb = {
      seconds: num(`${where}.reverb.seconds`, r['seconds'], 0.05, 20),
      mix: r['mix'] === undefined ? 0.3 : num(`${where}.reverb.mix`, r['mix'], 0, 1),
      damp: r['damp'] === undefined ? 0.4 : num(`${where}.reverb.damp`, r['damp'], 0, 1),
    };
  }
  const jitterRaw = o['jitter'] === undefined ? {} : obj(`${where}.jitter`, o['jitter'], [], ['hz', 'gain', 'seconds']);
  return {
    source: parseSource(`${where}.source`, o['source']),
    envelope: parseEnvelope(`${where}.envelope`, o['envelope']),
    filters: filters.map((f, i) => parseFilter(`${where}.filters[${i}]`, f)),
    drive: o['drive'] === undefined ? 0 : num(`${where}.drive`, o['drive'], 0, 100),
    delay,
    reverb,
    gain: o['gain'] === undefined ? 1 : num(`${where}.gain`, o['gain'], 0, 10),
    start: o['start'] === undefined ? 0 : num(`${where}.start`, o['start'], 0, 30),
    jitter: {
      hz: jitterRaw['hz'] === undefined ? 0 : num(`${where}.jitter.hz`, jitterRaw['hz'], 0, 1),
      gain: jitterRaw['gain'] === undefined ? 0 : num(`${where}.jitter.gain`, jitterRaw['gain'], 0, 1),
      seconds: jitterRaw['seconds'] === undefined ? 0 : num(`${where}.jitter.seconds`, jitterRaw['seconds'], 0, 1),
    },
  };
}

const SOUND_ID = /^[a-z][a-z0-9-]{0,39}$/;

function parseSound(id: string, raw: unknown): SoundDef {
  const where = `sounds.${id}`;
  if (!SOUND_ID.test(id)) throw new SoundsDataError(`${where}: id must match ${SOUND_ID}`);
  const o = obj(where, raw, ['class', 'seconds', 'layers', 'bounds'], ['variants', 'normalizePeakDb']);
  const layers = o['layers'];
  if (!Array.isArray(layers) || layers.length === 0 || layers.length > 16) throw new SoundsDataError(`${where}.layers must list 1–16 layers`);
  const b = obj(`${where}.bounds`, o['bounds'], ['peakDb', 'rmsDb', 'seconds']);
  const seconds = num(`${where}.seconds`, o['seconds'], 0.005, 30);
  const def: SoundDef = {
    id,
    class: oneOf(`${where}.class`, o['class'], SOUND_CLASSES),
    seconds,
    variants: o['variants'] === undefined ? 1 : num(`${where}.variants`, o['variants'], 1, 16),
    normalizePeakDb: o['normalizePeakDb'] === undefined ? -1 : num(`${where}.normalizePeakDb`, o['normalizePeakDb'], -60, 0),
    bounds: {
      peakDb: range(`${where}.bounds.peakDb`, b['peakDb'], -120, 0),
      rmsDb: range(`${where}.bounds.rmsDb`, b['rmsDb'], -120, 0),
      seconds: range(`${where}.bounds.seconds`, b['seconds'], 0, 30),
    },
    layers: layers.map((l, i) => parseLayer(`${where}.layers[${i}]`, l)),
  };
  if (!Number.isInteger(def.variants)) throw new SoundsDataError(`${where}.variants must be a whole number`);
  for (const [i, layer] of def.layers.entries()) {
    if (layer.start >= seconds) throw new SoundsDataError(`${where}.layers[${i}].start is at or past the sound's end`);
  }
  return def;
}

/** Validate the recipe file. */
export function parseSounds(raw: unknown): SoundsConfig {
  const o = obj('sounds', raw, ['sounds'], ['sampleRate']);
  const sampleRate = o['sampleRate'] === undefined ? AUDIO_SAMPLE_RATE : num('sounds.sampleRate', o['sampleRate'], 8000, 96_000);
  if (typeof o['sounds'] !== 'object' || o['sounds'] === null || Array.isArray(o['sounds'])) throw new SoundsDataError('sounds.sounds must be an object of recipes by id');
  const sounds = new Map<string, SoundDef>();
  for (const [id, def] of Object.entries(o['sounds'] as Obj)) {
    if (id === '$comment') continue;
    sounds.set(id, parseSound(id, def));
  }
  return { sampleRate, sounds };
}

export const SOUNDS: SoundsConfig = parseSounds(RAW_SOUNDS);

/** The file a rendered variant is committed as, under `client/public/audio/`. */
export function soundFile(id: string, variant: number): string {
  return `${id}.${variant}.wav`;
}
