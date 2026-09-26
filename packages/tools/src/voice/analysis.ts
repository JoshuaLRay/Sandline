/**
 * What the voice pipeline measures and resamples with (T-2.48, ADR-017).
 *
 * - `resample`: band-limited (Blackman-windowed sinc) at any ratio — the
 *   input's rate to 48 kHz, a grain stretched for a formant shift, the
 *   output down to the committed rate.
 * - `integratedLoudness`: ITU-R BS.1770 — K-weighting, 400 ms blocks at
 *   75 % overlap, the absolute and relative gates — in LUFS.
 *   `normaliseLoudness` brings a line to a target under a peak ceiling.
 * - `splitTakes`: a recording read with pauses, cut into its takes.
 * - `trackPitch`: the fundamental every 5 ms (YIN), or 0 where unvoiced.
 * - `formants`: the spectral envelope's peaks (LPC), for the tests' check
 *   that a profile moves the formants where it says.
 *
 * Offline and plain, like `audio/dsp.ts`: nothing reads a clock or a device.
 */
import { AUDIO_SAMPLE_RATE, type VoicesConfig } from '@sandline/shared';

/** Zero crossings of the sinc each side of a resampled sample. */
const HALF_ZEROS = 12;

/**
 * `x` resampled by `ratio` (output rate over input rate). Below 1 the sinc
 * is widened to low-pass at the new Nyquist, so nothing aliases.
 */
export function resample(x: Float64Array, ratio: number, length = Math.round(x.length * ratio)): Float64Array {
  const out = new Float64Array(Math.max(0, length));
  if (ratio === 1 && length === x.length) {
    out.set(x);
    return out;
  }
  const fc = Math.min(1, ratio);
  const half = Math.ceil(HALF_ZEROS / fc);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / ratio;
    const base = Math.floor(t);
    let sum = 0;
    for (let j = base - half + 1; j <= base + half; j += 1) {
      if (j < 0 || j >= x.length) continue;
      const u = t - j;
      const a = fc * u;
      const sinc = a === 0 ? 1 : Math.sin(Math.PI * a) / (Math.PI * a);
      const w = 0.42 + 0.5 * Math.cos((Math.PI * u) / half) + 0.08 * Math.cos((2 * Math.PI * u) / half);
      sum += x[j]! * fc * sinc * w;
    }
    out[i] = sum;
  }
  return out;
}

/** A biquad by its coefficients, as BS.1770 gives them. */
function iir(x: Float64Array, b: readonly number[], a: readonly number[]): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i += 1) {
    const v = x[i]!;
    const out = b[0]! * v + b[1]! * x1 + b[2]! * x2 - a[1]! * y1 - a[2]! * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = out;
    y[i] = out;
  }
  return y;
}

/** BS.1770's K-weighting at 48 kHz: its high shelf, then its high-pass. */
function kWeight(x: Float64Array): Float64Array {
  const shelf = iir(x, [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]);
  return iir(shelf, [1, -2, 1], [1, -1.99004745483398, 0.99007225036621]);
}

/**
 * Integrated loudness, LUFS (ITU-R BS.1770-4), of a mono signal at 48 kHz;
 * −Infinity when nothing passes the gates. A signal shorter than one block
 * is measured as one block of its own length.
 */
export function integratedLoudness(x: Float64Array, rate = AUDIO_SAMPLE_RATE): number {
  if (rate !== AUDIO_SAMPLE_RATE) throw new Error(`integratedLoudness measures at ${AUDIO_SAMPLE_RATE} Hz, got ${rate}`);
  const k = kWeight(x);
  const block = Math.round(0.4 * rate);
  const step = Math.round(0.1 * rate);
  const powers: number[] = [];
  const meanSquare = (from: number, to: number) => {
    let s = 0;
    for (let i = from; i < to; i += 1) s += k[i]! * k[i]!;
    return s / Math.max(1, to - from);
  };
  if (k.length <= block) powers.push(meanSquare(0, k.length));
  else for (let at = 0; at + block <= k.length; at += step) powers.push(meanSquare(at, at + block));
  const lufs = (z: number) => -0.691 + 10 * Math.log10(z);
  const mean = (zs: number[]) => zs.reduce((s, z) => s + z, 0) / zs.length;
  const absolute = powers.filter((z) => z > 0 && lufs(z) > -70);
  if (absolute.length === 0) return Number.NEGATIVE_INFINITY;
  const relative = lufs(mean(absolute)) - 10;
  const gated = absolute.filter((z) => lufs(z) > relative);
  return lufs(mean(gated));
}

export function peakOf(x: Float64Array): number {
  let p = 0;
  for (const v of x) p = Math.max(p, Math.abs(v));
  return p;
}

/**
 * A soft limiter, in place: untouched below half the ceiling, a tanh knee
 * above it that never reaches the ceiling.
 */
function limit(x: Float64Array, ceiling: number): void {
  const knee = ceiling / 2;
  const room = ceiling - knee;
  for (let i = 0; i < x.length; i += 1) {
    const a = Math.abs(x[i]!);
    if (a > knee) x[i] = Math.sign(x[i]!) * (knee + room * Math.tanh((a - knee) / room));
  }
}

/**
 * `x` brought to `targetLufs` with its peak under `ceilingDb`: gain to the
 * target, the limiter when the peak goes over, measured again, until it
 * lands. Returns a new array; silence comes back as it went in.
 */
export function normaliseLoudness(x: Float64Array, targetLufs: number, ceilingDb: number, rate = AUDIO_SAMPLE_RATE): Float64Array {
  const y = Float64Array.from(x);
  const ceiling = 10 ** (ceilingDb / 20);
  for (let pass = 0; pass < 12; pass += 1) {
    const now = integratedLoudness(y, rate);
    if (!Number.isFinite(now)) return y;
    if (Math.abs(now - targetLufs) < 0.02 && peakOf(y) <= ceiling) break;
    const gain = 10 ** ((targetLufs - now) / 20);
    for (let i = 0; i < y.length; i += 1) y[i]! *= gain;
    if (peakOf(y) > ceiling) limit(y, ceiling);
  }
  return y;
}

export interface Take {
  /** First sample, inclusive. */
  start: number;
  /** Last sample, exclusive. */
  end: number;
}

/**
 * Where the takes are in a recording read with pauses: frames louder than
 * `thresholdDb` below the loudest, runs closer than `minSilenceMs` joined
 * (a pause inside a line is not a new take), runs shorter than `minTakeMs`
 * dropped (a click, a breath), each padded and never into its neighbour.
 */
export function splitTakes(x: Float64Array, split: VoicesConfig['split'], rate = AUDIO_SAMPLE_RATE): Take[] {
  const frame = Math.max(1, Math.round((split.frameMs * rate) / 1000));
  const frames = Math.ceil(x.length / frame);
  const level = new Float64Array(frames);
  let loudest = Number.NEGATIVE_INFINITY;
  for (let f = 0; f < frames; f += 1) {
    let s = 0;
    const to = Math.min(x.length, (f + 1) * frame);
    for (let i = f * frame; i < to; i += 1) s += x[i]! * x[i]!;
    level[f] = 10 * Math.log10(s / (to - f * frame) + 1e-20);
    loudest = Math.max(loudest, level[f]!);
  }
  const threshold = loudest + split.thresholdDb;
  const runs: Take[] = [];
  for (let f = 0; f < frames; f += 1) {
    if (level[f]! < threshold) continue;
    const last = runs[runs.length - 1];
    const gapFrames = last ? f - last.end : Infinity;
    if (last && gapFrames * split.frameMs < split.minSilenceMs) last.end = f + 1;
    else runs.push({ start: f, end: f + 1 });
  }
  const kept = runs.filter((r) => (r.end - r.start) * split.frameMs >= split.minTakeMs);
  const before = Math.round((split.padBeforeMs * rate) / 1000);
  const after = Math.round((split.padAfterMs * rate) / 1000);
  return kept.map((r, i) => {
    const start = r.start * frame;
    const end = Math.min(x.length, r.end * frame);
    const prevEnd = i > 0 ? Math.min(x.length, kept[i - 1]!.end * frame) : 0;
    const nextStart = i + 1 < kept.length ? kept[i + 1]!.start * frame : x.length;
    return {
      start: Math.max(0, start - before, Math.ceil((prevEnd + start) / 2)),
      end: Math.min(x.length, end + after, Math.floor((end + nextStart) / 2)),
    };
  });
}

/** A take cut out, with short fades so its edges do not click. */
export function cutTake(x: Float64Array, take: Take, rate = AUDIO_SAMPLE_RATE): Float64Array {
  const y = x.slice(take.start, take.end);
  const fadeIn = Math.min(y.length >> 1, Math.round(0.005 * rate));
  const fadeOut = Math.min(y.length >> 1, Math.round(0.02 * rate));
  for (let i = 0; i < fadeIn; i += 1) y[i]! *= i / fadeIn;
  for (let i = 0; i < fadeOut; i += 1) y[y.length - 1 - i]! *= i / fadeOut;
  return y;
}

/** The pitch track's hop, seconds. */
export const PITCH_HOP_SECONDS = 0.005;
/** The rate the pitch tracker works at: plenty for a fundamental, a sixteenth of the work. */
const PITCH_RATE = 12_000;

/**
 * The fundamental every `PITCH_HOP_SECONDS`, by YIN (de Cheveigné and
 * Kawahara 2002) on a 12 kHz copy; 0 where a frame is quiet (40 dB under
 * the loudest) or aperiodic. A median over five voiced frames takes out
 * single-frame octave jumps.
 */
export function trackPitch(x: Float64Array, rangeHz: readonly [number, number], rate = AUDIO_SAMPLE_RATE): Float64Array {
  const y = resample(x, PITCH_RATE / rate);
  const hop = Math.round(PITCH_HOP_SECONDS * PITCH_RATE);
  const maxLag = Math.ceil(PITCH_RATE / rangeHz[0]);
  const minLag = Math.max(2, Math.floor(PITCH_RATE / rangeHz[1]));
  const W = maxLag;
  const frames = Math.ceil(x.length / (PITCH_HOP_SECONDS * rate));
  const energy = new Float64Array(frames);
  let loudest = 0;
  for (let f = 0; f < frames; f += 1) {
    const s0 = f * hop - (W >> 1);
    let e = 0;
    for (let j = 0; j < W; j += 1) {
      const v = y[s0 + j] ?? 0;
      e += v * v;
    }
    energy[f] = e / W;
    loudest = Math.max(loudest, energy[f]!);
  }
  const raw = new Float64Array(frames);
  const d = new Float64Array(maxLag + 2);
  for (let f = 0; f < frames; f += 1) {
    if (energy[f]! < loudest * 1e-4 || energy[f]! === 0) continue;
    const s0 = f * hop - (W >> 1);
    for (let tau = 1; tau <= maxLag + 1; tau += 1) {
      let s = 0;
      for (let j = 0; j < W; j += 1) {
        const diff = (y[s0 + j] ?? 0) - (y[s0 + j + tau] ?? 0);
        s += diff * diff;
      }
      d[tau] = s;
    }
    // The cumulative mean normalised difference.
    let running = 0;
    const cmnd = new Float64Array(maxLag + 2);
    cmnd[0] = 1;
    for (let tau = 1; tau <= maxLag + 1; tau += 1) {
      running += d[tau]!;
      cmnd[tau] = running > 0 ? (d[tau]! * tau) / running : 1;
    }
    let best = -1;
    for (let tau = minLag; tau <= maxLag; tau += 1) {
      if (cmnd[tau]! < 0.15) {
        while (tau + 1 <= maxLag && cmnd[tau + 1]! < cmnd[tau]!) tau += 1;
        best = tau;
        break;
      }
    }
    if (best < 0) {
      for (let tau = minLag; tau <= maxLag; tau += 1) if (best < 0 || cmnd[tau]! < cmnd[best]!) best = tau;
      if (cmnd[best]! > 0.3) continue;
    }
    const a = cmnd[best - 1]!;
    const b = cmnd[best]!;
    const c = cmnd[best + 1]!;
    const den = a - 2 * b + c;
    const shift = den > 0 ? (0.5 * (a - c)) / den : 0;
    raw[f] = PITCH_RATE / (best + Math.max(-0.5, Math.min(0.5, shift)));
  }
  const out = new Float64Array(frames);
  for (let f = 0; f < frames; f += 1) {
    if (raw[f] === 0) continue;
    const near: number[] = [];
    for (let g = Math.max(0, f - 2); g <= Math.min(frames - 1, f + 2); g += 1) if (raw[g]! > 0) near.push(raw[g]!);
    near.sort((p, q) => p - q);
    out[f] = near[near.length >> 1]!;
  }
  return out;
}

/** The median of a pitch track's voiced frames; 0 if none are. */
export function medianPitch(track: Float64Array): number {
  const voiced = [...track].filter((f) => f > 0).sort((a, b) => a - b);
  return voiced.length ? voiced[voiced.length >> 1]! : 0;
}

/** Levinson–Durbin: LPC coefficients a[0..order] (a[0] = 1) from autocorrelation r. */
function levinson(r: Float64Array, order: number): Float64Array {
  const a = new Float64Array(order + 1);
  a[0] = 1;
  let err = r[0]!;
  for (let i = 1; i <= order; i += 1) {
    let acc = r[i]!;
    for (let j = 1; j < i; j += 1) acc += a[j]! * r[i - j]!;
    const k = -acc / err;
    const prev = Float64Array.from(a);
    for (let j = 1; j < i; j += 1) a[j] = prev[j]! + k * prev[i - j]!;
    a[i] = k;
    err *= 1 - k * k;
  }
  return a;
}

/**
 * The first `count` formants of a voiced signal, Hz: the peaks of an LPC
 * envelope (order 10 on an 8 kHz, pre-emphasised copy, the textbook setup
 * for an adult voice), averaged over every frame within 30 dB of the
 * loudest. For measuring, not for processing.
 */
export function formants(x: Float64Array, count = 3, rate = AUDIO_SAMPLE_RATE): number[] {
  const RATE = 8000;
  const ORDER = 10;
  const y = resample(x, RATE / rate);
  for (let i = y.length - 1; i > 0; i -= 1) y[i] = y[i]! - 0.97 * y[i - 1]!;
  const frame = Math.round(0.03 * RATE);
  const hop = Math.round(0.01 * RATE);
  const window = new Float64Array(frame);
  for (let i = 0; i < frame; i += 1) window[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (frame - 1));
  const rs: Float64Array[] = [];
  for (let at = 0; at + frame <= y.length; at += hop) {
    const r = new Float64Array(ORDER + 1);
    for (let lag = 0; lag <= ORDER; lag += 1) {
      let s = 0;
      for (let i = lag; i < frame; i += 1) s += y[at + i]! * window[i]! * y[at + i - lag]! * window[i - lag]!;
      r[lag] = s;
    }
    rs.push(r);
  }
  const loudest = Math.max(...rs.map((r) => r[0]!));
  const sum = new Float64Array(ORDER + 1);
  for (const r of rs) if (r[0]! > loudest * 1e-3) for (let i = 0; i <= ORDER; i += 1) sum[i]! += r[i]!;
  const a = levinson(sum, ORDER);
  const STEP = 2;
  const env: number[] = [];
  for (let hz = 0; hz <= RATE / 2; hz += STEP) {
    const w = (2 * Math.PI * hz) / RATE;
    let re = 0;
    let im = 0;
    for (let k = 0; k <= ORDER; k += 1) {
      re += a[k]! * Math.cos(w * k);
      im -= a[k]! * Math.sin(w * k);
    }
    env.push(-10 * Math.log10(re * re + im * im));
  }
  const peaks: number[] = [];
  for (let i = 1; i + 1 < env.length && peaks.length < count; i += 1) {
    if (i * STEP < 90 || env[i]! <= env[i - 1]! || env[i]! < env[i + 1]!) continue;
    const den = env[i - 1]! - 2 * env[i]! + env[i + 1]!;
    const shift = den < 0 ? (0.5 * (env[i - 1]! - env[i + 1]!)) / den : 0;
    peaks.push((i + shift) * STEP);
  }
  return peaks;
}
