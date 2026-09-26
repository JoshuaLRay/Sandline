/**
 * What `gen:voice` commits beside the lines (T-2.48): the manifest
 * `client/public/audio/voice/renders.json`, with the hash of every input
 * that decided them — the voice data, the squelch recipes, the DSP and
 * pipeline source, and every raw upload's bytes — and each line's file,
 * digest and measured loudness. A test recomputes the hash from what is in
 * the repository, so a recording uploaded (or changed, or removed) without
 * `pnpm gen:voice` being run fails the suite, as a recipe does for effects.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOUNDS, type SoundsConfig, VOICES, type VoicesConfig } from '@sandline/shared';

export const RAW_DIR = fileURLToPath(new URL('../../../../assets/voice/raw/', import.meta.url));
export const VOICE_DIR = fileURLToPath(new URL('../../../client/public/audio/voice/', import.meta.url));
export const VOICE_RENDERS_FILE = join(VOICE_DIR, 'renders.json');

/** The source whose text is part of the inputs hash, relative to `tools/src/`. */
export const VOICE_SOURCES = ['audio/dsp.ts', 'audio/render.ts', 'voice/analysis.ts', 'voice/psola.ts', 'voice/process.ts', 'voice/wavIn.ts'] as const;

export interface VoiceRenderedFile {
  file: string;
  bytes: number;
  sha256: string;
  lufs: number;
  peakDb: number;
  seconds: number;
}

export interface VoiceRendersManifest {
  $comment: string;
  inputsHash: string;
  sampleRate: number;
  speakers: { name: string; passes: Record<string, number> }[];
  /** `<profile>/<line>.<style>.<treatment>` → its variants. */
  lines: Record<string, VoiceRenderedFile[]>;
  missing: string[];
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Every file under `dir`, as paths relative to it, sorted. */
function walk(dir: string, root = dir): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path, root) : [relative(root, path).split('\\').join('/')];
    });
}

/**
 * The hash of every input that decides the lines. The raw folder's README
 * is documentation, not input; everything else under it counts, consent
 * notes and edits included.
 */
export function voiceInputsHash(rawDir = RAW_DIR, config: VoicesConfig = VOICES, sounds: SoundsConfig = SOUNDS, sources: readonly string[] = VOICE_SOURCES.map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))): string {
  const h = createHash('sha256');
  h.update(JSON.stringify(config));
  h.update('\u0000').update(JSON.stringify([config.radio.squelchIn, config.radio.squelchOut].map((id) => sounds.sounds.get(id))));
  for (const text of sources) h.update('\u0000').update(text);
  for (const file of walk(rawDir)) {
    if (file === 'README.md') continue;
    h.update('\u0000').update(file).update('\u0000').update(sha256(readFileSync(join(rawDir, file))));
  }
  return h.digest('hex');
}

/** A number as the manifest keeps it: two decimals. */
export function round2(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : -999;
}
