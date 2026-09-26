/**
 * Generated stand-ins for a recorded voice (T-2.48), so the pipeline is
 * tested without anyone's recording: a synthetic voiced tone — a pulse
 * train, softened like the glottis's, through resonators at chosen formants
 * — and recordings made of them, read with pauses the way the script asks.
 */
import { AUDIO_SAMPLE_RATE, Sfc32 } from '@sandline/shared';

export interface VoicedToneOptions {
  f0: number;
  seconds: number;
  /** Formant centres, Hz. */
  formants?: readonly number[];
  /** Formant bandwidths, Hz, one per formant. */
  bandwidths?: readonly number[];
  /** The fundamental glides to this by the end, when set. */
  toF0?: number;
  /** Peak level, 0..1. */
  level?: number;
  rate?: number;
}

export const NEUTRAL_FORMANTS = [700, 1220, 2600] as const;

/** A synthetic vowel: pulses at `f0`, a glottal tilt, the formant resonators, a short fade each end. */
export function voicedTone(options: VoicedToneOptions): Float64Array {
  const rate = options.rate ?? AUDIO_SAMPLE_RATE;
  const n = Math.round(options.seconds * rate);
  const src = new Float64Array(n);
  let phase = 0;
  for (let i = 0; i < n; i += 1) {
    const f = options.toF0 === undefined ? options.f0 : options.f0 * (options.toF0 / options.f0) ** (i / n);
    phase += f / rate;
    if (phase >= 1) {
      phase -= 1;
      src[i] = 1;
    }
  }
  // The glottal pulse is soft, not a click: two one-pole low-passes, about −12 dB an octave above 200 Hz.
  let y = src;
  for (let pass = 0; pass < 2; pass += 1) {
    const a = Math.exp((-2 * Math.PI * 200) / rate);
    const out = new Float64Array(n);
    let prev = 0;
    for (let i = 0; i < n; i += 1) prev = out[i] = (1 - a) * y[i]! + a * prev;
    y = out;
  }
  const formants = options.formants ?? NEUTRAL_FORMANTS;
  const bandwidths = options.bandwidths ?? [80, 90, 120];
  for (const [k, hz] of formants.entries()) {
    const r = Math.exp((-Math.PI * (bandwidths[k] ?? 100)) / rate);
    const c = 2 * r * Math.cos((2 * Math.PI * hz) / rate);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i += 1) out[i] = y[i]! + c * (out[i - 1] ?? 0) - r * r * (out[i - 2] ?? 0);
    y = out;
  }
  let peak = 0;
  for (const v of y) peak = Math.max(peak, Math.abs(v));
  const fade = Math.round(0.02 * rate);
  const level = options.level ?? 0.5;
  for (let i = 0; i < n; i += 1) {
    const edge = Math.min(1, i / fade, (n - 1 - i) / fade);
    y[i] = (y[i]! / peak) * level * edge;
  }
  return y;
}

/**
 * A recording read the way the script asks: each segment, then `gapSeconds`
 * of quiet, over a noise floor at `floorDb`. Returns the samples and where
 * each segment starts and ends.
 */
export function recording(segments: readonly Float64Array[], gapSeconds = 1, floorDb = -65, seed = 1, rate = AUDIO_SAMPLE_RATE): { samples: Float64Array; spans: { start: number; end: number }[] } {
  const gap = Math.round(gapSeconds * rate);
  const total = gap + segments.reduce((s, seg) => s + seg.length + gap, 0);
  const samples = new Float64Array(total);
  const rng = new Sfc32(seed);
  const floor = 10 ** (floorDb / 20);
  for (let i = 0; i < total; i += 1) samples[i] = (rng.next() * 2 - 1) * floor;
  const spans: { start: number; end: number }[] = [];
  let at = gap;
  for (const seg of segments) {
    for (let i = 0; i < seg.length; i += 1) samples[at + i]! += seg[i]!;
    spans.push({ start: at, end: at + seg.length });
    at += seg.length + gap;
  }
  return { samples, spans };
}
