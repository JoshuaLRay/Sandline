/**
 * Rendering a recipe (T-2.44): every layer of a `SoundDef` made from its
 * source, shaped by its envelope, filters, drive, delay and reverb, placed
 * at its start and mixed; the mix peak-normalised to the recipe's level;
 * each variant a seeded take differing by the recipe's jitter. Then the
 * measurements the tests hold a render to, and a 16-bit mono WAV of it.
 *
 * WAV, not a compressed format, is the committed format: it plays in every
 * browser the game targets (Chrome, Firefox and Safari all decode 16-bit
 * PCM WAV), it needs no encoder dependency, and it is byte-identical across
 * machines, which a codec's output is not promised to be. One-shots are
 * small (96 KB a second at 48 kHz mono); if the whole set grows past a few
 * megabytes, a lossy format is the next change, not a rewrite.
 */
import { AUDIO_SAMPLE_RATE, type LayerDef, type SoundDef, seedFrom, unitFromSeed } from '@sandline/shared';
import { applyGain, biquad, delay, envelope, impulse, noise, oscillator, reverb, softClip } from './dsp.ts';

/** A stable number for a sound id, for its seeds. FNV-1a over UTF-16 units. */
export function idSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** A variant's factor for one jitter amount: 1 ± amount, from its own seed. */
function jitterFactor(amount: number, seed: number): number {
  return amount <= 0 ? 1 : 1 + (unitFromSeed(seed) * 2 - 1) * amount;
}

/** One layer, `length` samples long, starting at 0 (the mix places it). */
export function renderLayer(layer: LayerDef, length: number, rate: number, seed: number): Float64Array {
  const hzScale = jitterFactor(layer.jitter.hz, seedFrom(seed, 1));
  const gainScale = jitterFactor(layer.jitter.gain, seedFrom(seed, 2));
  const timeScale = jitterFactor(layer.jitter.seconds, seedFrom(seed, 3));
  const src = layer.source;
  let signal =
    src.kind === 'noise'
      ? noise(length, seedFrom(seed, 4))
      : src.kind === 'impulse'
        ? impulse(length)
        : oscillator(src.wave, src.hz * hzScale, src.toHz === null ? null : src.toHz * hzScale, src.sweepSeconds * timeScale, length, rate);
  applyGain(signal, envelope(layer.envelope, length, rate, timeScale));
  for (const filter of layer.filters) biquad(signal, filter, rate, hzScale);
  softClip(signal, layer.drive);
  if (layer.delay) signal = delay(signal, { ...layer.delay, seconds: layer.delay.seconds * timeScale }, rate);
  if (layer.reverb) signal = reverb(signal, layer.reverb, rate, seedFrom(seed, 5));
  return applyGain(signal, layer.gain * gainScale);
}

/** A variant of a sound: its layers mixed and peak-normalised. `variant` is 0-based. */
export function renderSound(def: SoundDef, variant: number, rate = AUDIO_SAMPLE_RATE): Float64Array {
  const length = Math.max(1, Math.round(def.seconds * rate));
  const mix = new Float64Array(length);
  def.layers.forEach((layer, i) => {
    const start = Math.round(layer.start * rate);
    const part = renderLayer(layer, length - start, rate, seedFrom(idSeed(def.id), variant, i));
    for (let s = 0; s < part.length; s += 1) mix[start + s]! += part[s]!;
  });
  let peak = 0;
  for (const s of mix) peak = Math.max(peak, Math.abs(s));
  if (peak > 0) applyGain(mix, 10 ** (def.normalizePeakDb / 20) / peak);
  return mix;
}

export interface Measurement {
  /** dBFS of the largest sample; −Infinity for silence. */
  peakDb: number;
  /** dBFS of the RMS over the whole render. */
  rmsDb: number;
  /** Seconds to the last sample above −60 dBFS. */
  seconds: number;
  /** Samples at or beyond full scale once quantised. */
  clipped: number;
}

const db = (x: number): number => (x > 0 ? 20 * Math.log10(x) : Number.NEGATIVE_INFINITY);

/** What a test can measure without an ear, on the samples as they will be written. */
export function measure(samples: Float64Array | Int16Array, rate = AUDIO_SAMPLE_RATE): Measurement {
  const scale = samples instanceof Int16Array ? 1 / 32768 : 1;
  let peak = 0;
  let sum = 0;
  let last = -1;
  let clipped = 0;
  const floor = 10 ** (-60 / 20);
  for (let i = 0; i < samples.length; i += 1) {
    const raw = samples[i]!;
    const v = raw * scale;
    const a = Math.abs(v);
    peak = Math.max(peak, a);
    sum += v * v;
    if (a > floor) last = i;
    if (samples instanceof Int16Array ? raw >= 32767 || raw <= -32768 : a >= 1) clipped += 1;
  }
  return { peakDb: db(peak), rmsDb: db(Math.sqrt(sum / Math.max(1, samples.length))), seconds: (last + 1) / rate, clipped };
}

/** Round to 16-bit, never wrapping: a sample past full scale is held at it (and counted as clipped by `measure`). */
export function toPcm16(samples: Float64Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) out[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i]! * 32768)));
  return out;
}

/** A mono 16-bit PCM WAV file. */
export function wavBytes(pcm: Int16Array, rate = AUDIO_SAMPLE_RATE): Uint8Array {
  const data = pcm.length * 2;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const str = (at: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) v.setUint8(at + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + data, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, data, true);
  for (let i = 0; i < pcm.length; i += 1) v.setInt16(44 + i * 2, pcm[i]!, true);
  return new Uint8Array(buf);
}

/** Read back what `wavBytes` wrote: the rate and the samples. Throws on anything else. */
export function readWav(bytes: Uint8Array): { rate: number; pcm: Int16Array } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || tag(12) !== 'fmt ' || tag(36) !== 'data') throw new Error('not a canonical WAV');
  if (v.getUint16(20, true) !== 1 || v.getUint16(22, true) !== 1 || v.getUint16(34, true) !== 16) throw new Error('not mono 16-bit PCM');
  const n = v.getUint32(40, true) / 2;
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i += 1) pcm[i] = v.getInt16(44 + i * 2, true);
  return { rate: v.getUint32(24, true), pcm };
}
