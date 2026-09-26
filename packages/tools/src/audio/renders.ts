/**
 * What `gen:audio` commits beside the renders (T-2.44): a manifest,
 * `client/public/audio/renders.json`, with the hash of every input that
 * decided them — the recipes and the DSP's own source — and each file's
 * bytes, digest and measured numbers. A test recomputes the inputs hash from
 * the live recipes and source, so editing either fails the suite until the
 * renders are made again, as `gen:nav` does for the navmesh.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SOUNDS, type SoundsConfig } from '@sandline/shared';

/** The DSP and render sources whose text is part of the inputs hash. */
export const DSP_SOURCES = ['dsp.ts', 'render.ts'] as const;

export const AUDIO_DIR = new URL('../../../client/public/audio/', import.meta.url);
export const RENDERS_FILE = new URL('renders.json', AUDIO_DIR);

export interface RenderedFile {
  file: string;
  bytes: number;
  sha256: string;
  peakDb: number;
  rmsDb: number;
  seconds: number;
}

export interface RendersManifest {
  $comment: string;
  inputsHash: string;
  sampleRate: number;
  sounds: Record<string, RenderedFile[]>;
}

/** The recipes in a fixed order with their parsed values: formatting in the JSON does not count, content does. */
function recipesText(config: SoundsConfig): string {
  const ids = [...config.sounds.keys()].sort();
  return JSON.stringify({ sampleRate: config.sampleRate, sounds: ids.map((id) => config.sounds.get(id)) });
}

/** The hash of every input that decides the renders. */
export function audioInputsHash(config: SoundsConfig = SOUNDS, sources: readonly string[] = DSP_SOURCES.map((f) => readFileSync(new URL(f, import.meta.url), 'utf8'))): string {
  const h = createHash('sha256');
  h.update(recipesText(config));
  for (const text of sources) h.update('\u0000').update(text);
  return h.digest('hex');
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A number as the manifest keeps it: two decimals, so a re-render that changes nothing changes no text. */
export function round2(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : -999;
}
