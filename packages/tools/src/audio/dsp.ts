/**
 * The DSP library the effects are rendered with (T-2.44, ADR-017).
 *
 * Offline and plain: every function takes and returns Float64Arrays of
 * samples at one rate, nothing reads a clock, and the only randomness is the
 * shared seeded PRNG, so a render is the same bytes every time it is run.
 * It lives in `tools`, never in the page — the page plays what this made.
 *
 * Pieces: oscillators (with a frequency sweep), seeded white noise, an
 * attack/hold/decay envelope, RBJ-cookbook biquads (with a cutoff sweep),
 * a soft-clip drive, a feedback delay, and a reverb that is a GENERATED
 * impulse — decaying noise, darker as it goes — convolved by FFT.
 */
import { Sfc32 } from '@sandline/shared';
import type { DelayDef, EnvelopeDef, FilterDef, OscWave, ReverbDef } from '@sandline/shared';

const TAU = Math.PI * 2;
/** 60 dB is a factor of 1000: ln(1000). */
const LN_1000 = Math.log(1000);

/** An oscillator: `hz` sweeping exponentially to `toHz` over `sweepSeconds`, then held. */
export function oscillator(wave: OscWave, hz: number, toHz: number | null, sweepSeconds: number, length: number, rate: number): Float64Array {
  const out = new Float64Array(length);
  let phase = 0;
  const sweepSamples = Math.max(1, Math.round(sweepSeconds * rate));
  const ratio = toHz === null ? 1 : toHz / hz;
  for (let i = 0; i < length; i += 1) {
    const f = toHz === null || sweepSeconds <= 0 ? hz : hz * ratio ** Math.min(1, i / sweepSamples);
    const p = phase - Math.floor(phase);
    switch (wave) {
      case 'sine':
        out[i] = Math.sin(TAU * p);
        break;
      case 'triangle':
        out[i] = p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
        break;
      case 'square':
        out[i] = p < 0.5 ? 1 : -1;
        break;
      case 'saw':
        out[i] = 2 * p - 1;
        break;
    }
    phase += f / rate;
  }
  return out;
}

/** White noise in [−1, 1) from the shared PRNG: the same seed is the same noise, on any machine. */
export function noise(length: number, seed: number): Float64Array {
  const rng = new Sfc32(seed);
  const out = new Float64Array(length);
  for (let i = 0; i < length; i += 1) out[i] = rng.next() * 2 - 1;
  return out;
}

/** One full-scale sample, then silence. */
export function impulse(length: number): Float64Array {
  const out = new Float64Array(length);
  if (length > 0) out[0] = 1;
  return out;
}

/** The envelope's gain curve: a linear attack, a hold, then a decay by 60 dB (`exp`) or to zero (`linear`). */
export function envelope(env: EnvelopeDef, length: number, rate: number, timeScale = 1): Float64Array {
  const out = new Float64Array(length);
  const attack = env.attack * timeScale * rate;
  const hold = env.hold * timeScale * rate;
  const decay = Math.max(1, env.decay * timeScale * rate);
  for (let i = 0; i < length; i += 1) {
    if (i < attack) out[i] = attack <= 0 ? 1 : i / attack;
    else if (i < attack + hold) out[i] = 1;
    else {
      const t = (i - attack - hold) / decay;
      out[i] = env.curve === 'linear' ? Math.max(0, 1 - t) : Math.exp(-LN_1000 * t);
    }
  }
  return out;
}

/** Multiply in place. */
export function applyGain(signal: Float64Array, gain: Float64Array | number): Float64Array {
  if (typeof gain === 'number') for (let i = 0; i < signal.length; i += 1) signal[i]! *= gain;
  else for (let i = 0; i < signal.length; i += 1) signal[i]! *= gain[i] ?? 0;
  return signal;
}

interface Coefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** RBJ Audio EQ Cookbook coefficients, normalised by a0. */
export function biquadCoefficients(kind: FilterDef['kind'], hz: number, q: number, gainDb: number, rate: number): Coefficients {
  const f = Math.min(hz, rate * 0.49);
  const w0 = (TAU * f) / rate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  let b0: number;
  let b1: number;
  let b2: number;
  let a0: number;
  let a1: number;
  let a2: number;
  switch (kind) {
    case 'lowpass':
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case 'bandpass':
      // Constant 0 dB peak gain.
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case 'peak': {
      const A = 10 ** (gainDb / 40);
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
      break;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** How often a sweeping filter's coefficients are recomputed, in samples. */
const SWEEP_BLOCK = 32;

/** A biquad over the signal, in place; its cutoff sweeps exponentially to `toHz` when set. */
export function biquad(signal: Float64Array, filter: FilterDef, rate: number, hzScale = 1): Float64Array {
  const from = filter.hz * hzScale;
  const to = filter.toHz === null ? null : filter.toHz * hzScale;
  const sweepSamples = Math.max(1, Math.round(filter.sweepSeconds * rate));
  let c = biquadCoefficients(filter.kind, from, filter.q, filter.gainDb, rate);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < signal.length; i += 1) {
    if (to !== null && i % SWEEP_BLOCK === 0 && i <= sweepSamples + SWEEP_BLOCK) {
      c = biquadCoefficients(filter.kind, from * (to / from) ** Math.min(1, i / sweepSamples), filter.q, filter.gainDb, rate);
    }
    const x = signal[i]!;
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    signal[i] = y;
  }
  return signal;
}

/** A soft clip: tanh of the signal driven `drive` times, rescaled so full scale stays full scale. In place. */
export function softClip(signal: Float64Array, drive: number): Float64Array {
  if (drive <= 0) return signal;
  const norm = Math.tanh(drive);
  for (let i = 0; i < signal.length; i += 1) signal[i] = Math.tanh(signal[i]! * drive) / norm;
  return signal;
}

/** A feedback delay mixed with the dry signal. Returns a new array. */
export function delay(signal: Float64Array, def: DelayDef, rate: number): Float64Array {
  const d = Math.max(1, Math.round(def.seconds * rate));
  const wet = new Float64Array(signal.length);
  for (let i = d; i < signal.length; i += 1) wet[i] = signal[i - d]! + def.feedback * wet[i - d]!;
  const out = new Float64Array(signal.length);
  for (let i = 0; i < signal.length; i += 1) out[i] = signal[i]! * (1 - def.mix) + wet[i]! * def.mix;
  return out;
}

/**
 * A generated reverb impulse: seeded noise under a 60 dB decay over
 * `seconds`, through a one-pole low-pass that closes as the tail goes on
 * (`damp`), so late reflections are darker than early ones. Normalised to
 * unit energy so a mix of 0.3 is the same amount of room for any length.
 */
export function reverbImpulse(def: ReverbDef, rate: number, seed: number): Float64Array {
  const length = Math.max(1, Math.round(def.seconds * rate));
  const ir = noise(length, seed);
  let lp = 0;
  let energy = 0;
  for (let i = 0; i < length; i += 1) {
    const t = i / length;
    const decay = Math.exp(-LN_1000 * t);
    // The low-pass coefficient: open at the start, `damp` closed by the end.
    const k = 1 - Math.min(0.99, def.damp * t);
    lp += k * (ir[i]! - lp);
    ir[i] = lp * decay;
    energy += ir[i]! * ir[i]!;
  }
  const scale = energy > 0 ? 1 / Math.sqrt(energy) : 0;
  for (let i = 0; i < length; i += 1) ir[i]! *= scale;
  return ir;
}

/** In-place iterative radix-2 FFT (inverse with `inverse`, unscaled). Lengths must be powers of two. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 1 : -1) * TAU) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j += 1) {
        const ar = re[i + j]!;
        const ai = im[i + j]!;
        const br = re[i + j + len / 2]! * cr - im[i + j + len / 2]! * ci;
        const bi = re[i + j + len / 2]! * ci + im[i + j + len / 2]! * cr;
        re[i + j] = ar + br;
        im[i + j] = ai + bi;
        re[i + j + len / 2] = ar - br;
        im[i + j + len / 2] = ai - bi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Linear convolution by FFT, truncated to the signal's own length (the tail past the sound's end is cut). */
export function convolve(signal: Float64Array, ir: Float64Array): Float64Array {
  let n = 1;
  while (n < signal.length + ir.length - 1) n <<= 1;
  const ar = new Float64Array(n);
  const ai = new Float64Array(n);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);
  ar.set(signal);
  br.set(ir);
  fft(ar, ai);
  fft(br, bi);
  for (let i = 0; i < n; i += 1) {
    const r = ar[i]! * br[i]! - ai[i]! * bi[i]!;
    ai[i] = ar[i]! * bi[i]! + ai[i]! * br[i]!;
    ar[i] = r;
  }
  fft(ar, ai, true);
  const out = new Float64Array(signal.length);
  for (let i = 0; i < signal.length; i += 1) out[i] = ar[i]! / n;
  return out;
}

/** The reverb: the dry signal and its convolution with a generated impulse, mixed. */
export function reverb(signal: Float64Array, def: ReverbDef, rate: number, seed: number): Float64Array {
  const wet = convolve(signal, reverbImpulse(def, rate, seed));
  const out = new Float64Array(signal.length);
  for (let i = 0; i < signal.length; i += 1) out[i] = signal[i]! * (1 - def.mix) + wet[i]! * def.mix;
  return out;
}
