/**
 * The voice pipeline (T-2.48, ADR-017): uploads in, game lines out.
 *
 * 1. **Speakers.** Each folder under `assets/voice/raw/` is one person. A
 *    folder without its `CONSENT.md` is refused, whole: only recordings of
 *    people who have agreed are processed. A file that is not a pass the
 *    script names is refused by name, so a typo is not silently skipped.
 * 2. **Takes.** Each pass (`<section>-<normal|shout|hurt>`) is split at its
 *    pauses (`splitTakes`) and must hold every line of that pass said
 *    `takesPerLine` times, in order; the takes are named from the script by
 *    their position. A pass with a false start can drop takes by index in
 *    the speaker's `edits.json` (`{ "contact-shout": { "drop": [4] } }`).
 * 3. **Lines.** For each slot's profile, each rendered pass and line, and
 *    each variant: the take (variants take the takes in turn), its pitch and
 *    formants shifted (`shiftVoice`; a variant adds a seeded nudge of pitch),
 *    the profile's EQ, a shout's saturation, then each treatment — `dry`,
 *    `radio` (band-pass, drive, hiss, the squelch in and out) or `distant`
 *    (dulled, in a room) — and its loudness brought to the target under the
 *    ceiling. Written at the configured rate as 16-bit WAV.
 *
 * Everything is seeded; run it twice and nothing changes.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUDIO_SAMPLE_RATE,
  type FilterDef,
  SOUNDS,
  Sfc32,
  type SoundsConfig,
  type VoiceProfile,
  type VoiceStyle,
  type VoiceTreatment,
  type VoicesConfig,
  passFile,
  passLines,
  unitFromSeed,
  voiceFile,
} from '@sandline/shared';
import { biquad, reverb, softClip } from '../audio/dsp.ts';
import { idSeed, renderSound, toPcm16, wavBytes } from '../audio/render.ts';
import { cutTake, integratedLoudness, normaliseLoudness, peakOf, resample, splitTakes, trackPitch } from './analysis.ts';
import { type PitchMark, pitchMarks, semitones, shiftVoice } from './psola.ts';
import { RAW_EXTENSIONS, VoiceInputError, readRecording } from './wavIn.ts';

const RATE = AUDIO_SAMPLE_RATE;

export interface Speaker {
  name: string;
  dir: string;
  /** Pass name → the file it was uploaded as. */
  recordings: Map<string, string>;
  /** Pass name → take indices to drop before naming. */
  drops: Map<string, number[]>;
}

/** Every pass the script names, by its file name. */
export function scriptPasses(config: VoicesConfig): Map<string, { section: string; style: VoiceStyle; lines: readonly string[] }> {
  const passes = new Map<string, { section: string; style: VoiceStyle; lines: readonly string[] }>();
  for (const section of config.sections) {
    for (const style of ['normal', 'shout', 'hurt'] as const) {
      const lines = passLines(section, style);
      if (lines.length) passes.set(passFile(section.id, style), { section: section.id, style, lines });
    }
  }
  return passes;
}

/**
 * The speakers under `rawDir`, sorted by folder name. Throws, naming every
 * problem at once, on a folder without consent, a file the script does not
 * name, a pass uploaded twice, or an `edits.json` that is wrong.
 */
export function findSpeakers(rawDir: string, config: VoicesConfig): Speaker[] {
  if (!existsSync(rawDir)) return [];
  const passes = scriptPasses(config);
  const problems: string[] = [];
  const speakers: Speaker[] = [];
  for (const name of readdirSync(rawDir).sort()) {
    const dir = join(rawDir, name);
    if (!statSync(dir).isDirectory()) continue;
    const consent = join(dir, 'CONSENT.md');
    if (!existsSync(consent) || readFileSync(consent, 'utf8').trim() === '') {
      problems.push(`${name}/: no CONSENT.md — only recordings of people who have agreed are processed`);
      continue;
    }
    const recordings = new Map<string, string>();
    const drops = new Map<string, number[]>();
    for (const file of readdirSync(dir).sort()) {
      if (file === 'CONSENT.md' || file === 'edits.json' || file.startsWith('.')) continue;
      const dot = file.lastIndexOf('.');
      const pass = dot > 0 ? file.slice(0, dot) : file;
      const ext = dot > 0 ? file.slice(dot).toLowerCase() : '';
      if (!(RAW_EXTENSIONS as readonly string[]).includes(ext) || !passes.has(pass)) {
        problems.push(`${name}/${file}: not a pass the script names (${[...passes.keys()].slice(0, 3).join(', ')}, …) with a recording's extension`);
        continue;
      }
      if (recordings.has(pass)) problems.push(`${name}/${file}: ${pass} uploaded twice`);
      recordings.set(pass, join(dir, file));
    }
    const editsPath = join(dir, 'edits.json');
    if (existsSync(editsPath)) {
      try {
        const edits = JSON.parse(readFileSync(editsPath, 'utf8')) as Record<string, unknown>;
        for (const [pass, edit] of Object.entries(edits)) {
          const drop = (edit as { drop?: unknown }).drop;
          if (!passes.has(pass) || !Array.isArray(drop) || !drop.every((i) => Number.isInteger(i) && i >= 0)) {
            problems.push(`${name}/edits.json: '${pass}' must be a pass the script names, with "drop": [take indices]`);
            continue;
          }
          drops.set(pass, drop as number[]);
        }
      } catch (e) {
        problems.push(`${name}/edits.json: ${(e as Error).message}`);
      }
    }
    speakers.push({ name, dir, recordings, drops });
  }
  if (problems.length) throw new VoiceInputError(problems.join('\n'));
  return speakers;
}

/** A take, and its pitch marks (found once, used by every profile). */
export interface NamedTake {
  samples: Float64Array;
  marks: PitchMark[];
}

/** A 70 Hz high-pass, twice: rumble and DC out before anything is measured. */
const RUMBLE: FilterDef = { kind: 'highpass', hz: 70, q: 0.7071, gainDb: 0, toHz: null, sweepSeconds: 0 };

/**
 * One pass's recording cut into its takes and named: line → takes, in the
 * order said. Throws when the count is not what the script asks for, with
 * where each take found starts.
 */
export function nameTakes(samples: Float64Array, lines: readonly string[], config: VoicesConfig, drop: readonly number[] = [], where = 'recording'): Map<string, NamedTake[]> {
  const clean = biquad(biquad(Float64Array.from(samples), RUMBLE, RATE), RUMBLE, RATE);
  const found = splitTakes(clean, config.split, RATE);
  const takes = found.filter((_, i) => !drop.includes(i));
  const expected = lines.length * config.takesPerLine;
  if (takes.length !== expected) {
    const starts = found.map((t, i) => `${i}@${(t.start / RATE).toFixed(1)}s`).join(' ');
    throw new VoiceInputError(`${where}: found ${takes.length} takes${drop.length ? ` after dropping ${drop.length}` : ''}, the script asks for ${expected} (${lines.length} lines × ${config.takesPerLine}). Takes found: ${starts}. Drop false starts in edits.json.`);
  }
  const out = new Map<string, NamedTake[]>();
  takes.forEach((take, i) => {
    const line = lines[Math.floor(i / config.takesPerLine)]!;
    const cut = cutTake(clean, take, RATE);
    const named = { samples: cut, marks: pitchMarks(cut, trackPitch(cut, config.pitchRangeHz, RATE), RATE) };
    out.set(line, [...(out.get(line) ?? []), named]);
  });
  return out;
}

const filter = (kind: FilterDef['kind'], hz: number): FilterDef => ({ kind, hz, q: 0.7071, gainDb: 0, toHz: null, sweepSeconds: 0 });

/** Scale in place so the peak is `to`. */
function peakTo(x: Float64Array, to: number): Float64Array {
  const p = peakOf(x);
  if (p > 0) for (let i = 0; i < x.length; i += 1) x[i]! *= to / p;
  return x;
}

/** The radio: band-passed, driven, hissing, between its squelch in and out. */
export function radioTreatment(x: Float64Array, config: VoicesConfig, seed: number, sounds: SoundsConfig = SOUNDS): Float64Array {
  const { radio } = config;
  let y: Float64Array = Float64Array.from(x);
  for (const f of [filter('highpass', radio.highpassHz), filter('highpass', radio.highpassHz), filter('lowpass', radio.lowpassHz), filter('lowpass', radio.lowpassHz)]) y = biquad(y, f, RATE);
  softClip(peakTo(y, 1), radio.drive);
  peakTo(y, 1);
  const squelchIn = sounds.sounds.get(radio.squelchIn)!;
  const squelchOut = sounds.sounds.get(radio.squelchOut)!;
  const head = renderSound(squelchIn, seed % squelchIn.variants, RATE);
  const tail = renderSound(squelchOut, seed % squelchOut.variants, RATE);
  const gap = Math.round(0.02 * RATE);
  const out = new Float64Array(head.length + gap + y.length + tail.length);
  out.set(head, 0);
  out.set(y, head.length + gap);
  // The carrier's hiss, under the voice from the squelch in to the squelch out.
  const hiss = new Float64Array(gap + y.length);
  const rng = new Sfc32(seed);
  const level = 10 ** (radio.noiseDb / 20);
  for (let i = 0; i < hiss.length; i += 1) hiss[i] = (rng.next() * 2 - 1) * level;
  biquad(biquad(hiss, filter('highpass', radio.highpassHz), RATE), filter('lowpass', radio.lowpassHz), RATE);
  for (let i = 0; i < hiss.length; i += 1) out[head.length + i]! += hiss[i]!;
  out.set(tail, head.length + gap + y.length);
  return out;
}

/** Far off: dulled, and in a room, its tail kept. */
export function distantTreatment(x: Float64Array, config: VoicesConfig, seed: number): Float64Array {
  const { distant } = config;
  let y: Float64Array = new Float64Array(x.length + Math.round(distant.reverb.seconds * RATE));
  y.set(x);
  y = biquad(biquad(y, filter('lowpass', distant.lowpassHz), RATE), filter('lowpass', distant.lowpassHz), RATE);
  return reverb(y, distant.reverb, RATE, seed);
}

/** Trailing quiet off the end (60 dB under the peak), 10 ms kept. */
function trimTail(x: Float64Array): Float64Array {
  const floor = peakOf(x) * 10 ** (-60 / 20);
  let last = x.length - 1;
  while (last > 0 && Math.abs(x[last]!) < floor) last -= 1;
  return x.slice(0, Math.min(x.length, last + 1 + Math.round(0.01 * RATE)));
}

/** A take in a profile's voice: pitch and formants, EQ, and a shout's saturation. */
export function voiceTake(take: NamedTake, profile: VoiceProfile, style: VoiceStyle, extraSemitones = 0): Float64Array {
  let y: Float64Array = shiftVoice(take.samples, take.marks, semitones(profile.pitch + extraSemitones), semitones(profile.formant));
  for (const f of profile.eq) y = biquad(y, f, RATE);
  if (style === 'shout' && profile.shoutDrive > 0) softClip(peakTo(y, 1), profile.shoutDrive);
  return y;
}

/** One finished line at 48 kHz: treated and at its loudness. */
export function finishLine(voiced: Float64Array, treatment: VoiceTreatment, config: VoicesConfig, seed: number, sounds: SoundsConfig = SOUNDS): Float64Array {
  const treated = treatment === 'radio' ? radioTreatment(voiced, config, seed, sounds) : treatment === 'distant' ? distantTreatment(voiced, config, seed) : voiced;
  // Trimmed first: the loudness is measured over what is kept.
  return normaliseLoudness(trimTail(treated), config.loudness.targetLufs, config.loudness.ceilingDb, RATE);
}

export interface VoiceLine {
  /** Where it is committed, under `client/public/audio/voice/`. */
  file: string;
  /** `<profile>/<line>.<style>.<treatment>`: the variants of one line share it. */
  key: string;
  wav: Uint8Array;
  lufs: number;
  peakDb: number;
  seconds: number;
}

export interface VoiceRun {
  lines: VoiceLine[];
  /** Per speaker, the takes found in each pass. */
  speakers: { name: string; passes: Record<string, number> }[];
  /** Lines a profile's speaker did not record. */
  missing: string[];
}

/** Every game line from every speaker under `rawDir`. */
export function renderVoices(rawDir: string, config: VoicesConfig, sounds: SoundsConfig = SOUNDS, log: (line: string) => void = () => undefined): VoiceRun {
  const speakers = findSpeakers(rawDir, config);
  const run: VoiceRun = { lines: [], speakers: [], missing: [] };
  if (speakers.length === 0) return run;
  const passes = scriptPasses(config);
  const problems: string[] = [];
  const takes = speakers.map((speaker) => {
    const byPass = new Map<string, Map<string, NamedTake[]>>();
    const counts: Record<string, number> = {};
    for (const [pass, path] of speaker.recordings) {
      const { lines } = passes.get(pass)!;
      try {
        const named = nameTakes(readRecording(path), lines, config, speaker.drops.get(pass), `${speaker.name}/${pass}`);
        byPass.set(pass, named);
        counts[pass] = [...named.values()].reduce((s, t) => s + t.length, 0);
        log(`${speaker.name}/${pass}: ${counts[pass]} takes`);
      } catch (e) {
        problems.push((e as Error).message);
      }
    }
    run.speakers.push({ name: speaker.name, passes: counts });
    return byPass;
  });
  if (problems.length) throw new VoiceInputError(problems.join('\n'));
  for (const [slot, profile] of config.profiles.entries()) {
    const who = (profile.speaker ?? slot) % speakers.length;
    for (const section of config.sections) {
      for (const style of section.render) {
        const pass = passFile(section.id, style);
        const named = takes[who]!.get(pass);
        for (const line of passLines(section, style)) {
          const lineTakes = named?.get(line);
          if (!lineTakes) {
            run.missing.push(`${profile.id}/${line}.${style} (${speakers[who]!.name} has no ${pass})`);
            continue;
          }
          for (let v = 0; v < config.variants; v += 1) {
            const seed = idSeed(`${profile.id}/${line}.${style}.${v}`);
            const nudge = v === 0 ? 0 : (unitFromSeed(seed) * 2 - 1) * config.variantSemitones;
            const voiced = voiceTake(lineTakes[v % lineTakes.length]!, profile, style, nudge);
            for (const treatment of config.treatments) {
              const line48 = finishLine(voiced, treatment, config, seed, sounds);
              const out = resample(line48, config.sampleRate / RATE);
              const wav = wavBytes(toPcm16(out), config.sampleRate);
              const peak = peakOf(out);
              run.lines.push({
                file: voiceFile(profile.id, line, style, treatment, v),
                key: `${profile.id}/${line}.${style}.${treatment}`,
                wav,
                lufs: integratedLoudness(line48, RATE),
                peakDb: peak > 0 ? 20 * Math.log10(peak) : Number.NEGATIVE_INFINITY,
                seconds: out.length / config.sampleRate,
              });
            }
          }
        }
      }
    }
  }
  return run;
}
