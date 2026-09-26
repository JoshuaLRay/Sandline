/**
 * What the sound board shows (T-2.45), as pure functions: one row per
 * committed sound — its class, and each variant's file with the numbers
 * `gen:audio` measured — and a waveform's columns from a WAV's samples.
 * `SoundBoard.ts` puts these on the page; the tests check them without one.
 */
import type { SoundsConfig } from '@sandline/shared';

/** What `client/public/audio/renders.json` holds, as far as the board reads it. */
export interface RendersManifest {
  inputsHash: string;
  sampleRate: number;
  sounds: Record<string, { file: string; bytes: number; peakDb: number; rmsDb: number; seconds: number }[]>;
}

export interface BoardVariant {
  variant: number;
  file: string;
  /** "peak −3.0 dB · rms −25.4 dB · 0.019 s · 7.7 KB", or "not rendered". */
  numbers: string;
  rendered: boolean;
}

export interface BoardRow {
  id: string;
  cls: string;
  variants: BoardVariant[];
}

/** Every sound in the recipes, in id order, each variant with its measured numbers or a note that it has no render. */
export function soundBoardRows(sounds: SoundsConfig, manifest: RendersManifest | null): BoardRow[] {
  return [...sounds.sounds.values()]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((def) => ({
      id: def.id,
      cls: def.class,
      variants: Array.from({ length: def.variants }, (_, v) => {
        const m = manifest?.sounds[def.id]?.[v];
        return m
          ? { variant: v, file: m.file, rendered: true, numbers: `peak ${m.peakDb.toFixed(1)} dB · rms ${m.rmsDb.toFixed(1)} dB · ${m.seconds.toFixed(3)} s · ${(m.bytes / 1024).toFixed(1)} KB` }
          : { variant: v, file: `${def.id}.${v}.wav`, rendered: false, numbers: 'not rendered — run pnpm gen:audio' };
      }),
    }));
}

/** The samples of a canonical mono 16-bit WAV (what `gen:audio` writes), scaled to −1..1; empty for anything else. */
export function wavSamples(bytes: ArrayBuffer): Float32Array {
  const v = new DataView(bytes);
  if (bytes.byteLength < 44 || v.getUint32(0, false) !== 0x52494646 || v.getUint16(22, true) !== 1 || v.getUint16(34, true) !== 16) return new Float32Array(0);
  const n = Math.floor(v.getUint32(40, true) / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n && 44 + i * 2 + 1 < bytes.byteLength; i += 1) out[i] = v.getInt16(44 + i * 2, true) / 32768;
  return out;
}

/** A waveform in `columns` columns: each column's lowest and highest sample. */
export function waveformColumns(samples: Float32Array, columns: number): { min: number; max: number }[] {
  const out: { min: number; max: number }[] = [];
  if (samples.length === 0 || columns <= 0) return out;
  for (let c = 0; c < columns; c += 1) {
    const from = Math.floor((c * samples.length) / columns);
    const to = Math.max(from + 1, Math.floor(((c + 1) * samples.length) / columns));
    let min = 1;
    let max = -1;
    for (let i = from; i < to && i < samples.length; i += 1) {
      const s = samples[i]!;
      if (s < min) min = s;
      if (s > max) max = s;
    }
    out.push({ min, max });
  }
  return out;
}
