/**
 * Pitch and formant shifting, apart (T-2.48, ADR-017): TD-PSOLA.
 *
 * A voice is a buzz (the vocal folds, one pulse a period) through a filter
 * (the throat and mouth, whose resonances are the formants). Resampling
 * moves both, which is the slowed-tape sound. PSOLA cuts the voice into
 * two-period grains, one per pulse, and lays them down again at a new
 * spacing: the pulses — the pitch — move, while each grain, and with it the
 * filter's shape, stays as it was. Stretching each grain in time before it
 * is laid down moves the formants on their own. So a profile can be deeper
 * (pitch down) and bigger (formants down a little less) without sounding
 * slowed.
 *
 * Where the voice is unvoiced (an "s", a breath) there is no pitch to move:
 * grains every 5 ms are laid down at the same spacing, which gives back the
 * input (Hann at half overlap sums to one), stretched for the formants.
 *
 * The pitch marks are the pulses: the largest sample of the polarity the
 * voiced run starts with, a period after the last, searched a quarter of a
 * period either side. Time is kept: a synthesis mark takes the analysis
 * mark nearest it in time, so a line is as long after as before.
 */
import { AUDIO_SAMPLE_RATE } from '@sandline/shared';
import { PITCH_HOP_SECONDS, resample } from './analysis.ts';

export interface PitchMark {
  /** Sample index of the pulse (or of the grain centre, unvoiced). */
  pos: number;
  /** Samples to the next pulse. */
  period: number;
  voiced: boolean;
}

/** The fixed spacing of unvoiced grains, seconds. */
const UNVOICED_SECONDS = 0.005;

/** Pitch marks from a pitch track (`trackPitch`'s frames, 0 unvoiced). */
export function pitchMarks(x: Float64Array, track: Float64Array, rate = AUDIO_SAMPLE_RATE): PitchMark[] {
  const hop = PITCH_HOP_SECONDS * rate;
  const unvoiced = Math.round(UNVOICED_SECONDS * rate);
  const periodAt = (i: number): number | null => {
    const f0 = track[Math.min(track.length - 1, Math.max(0, Math.round(i / hop)))] ?? 0;
    return f0 > 0 ? rate / f0 : null;
  };
  const marks: PitchMark[] = [];
  let pos = 0;
  let last: PitchMark | null = null;
  let polarity = 1;
  while (pos < x.length) {
    const P = periodAt(pos);
    if (P === null) {
      last = { pos, period: unvoiced, voiced: false };
      marks.push(last);
      pos += unvoiced;
      continue;
    }
    let from: number;
    let to: number;
    if (last?.voiced) {
      from = Math.round(last.pos + P * 0.75);
      to = Math.round(last.pos + P * 1.25);
    } else {
      // A voiced run starts: its polarity is the side of its largest excursion.
      from = pos;
      to = Math.round(pos + P);
      let hi = 0;
      let lo = 0;
      for (let i = from; i < Math.min(x.length, to); i += 1) {
        hi = Math.max(hi, x[i]!);
        lo = Math.min(lo, x[i]!);
      }
      polarity = hi >= -lo ? 1 : -1;
    }
    if (from >= x.length) break;
    let best = from;
    for (let i = from; i < Math.min(x.length, to); i += 1) if (x[i]! * polarity > x[best]! * polarity) best = i;
    last = { pos: best, period: P, voiced: true };
    marks.push(last);
    pos = Math.round(best + P);
  }
  return marks;
}

/** A Hann window of `length` samples, zero at both ends. */
function hann(length: number): Float64Array {
  const w = new Float64Array(length);
  for (let i = 0; i < length; i += 1) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1));
  return w;
}

/**
 * `x` with its pitch moved by `pitchRatio` and its formants by
 * `formantRatio` (each a frequency ratio: 2^(semitones/12)), the same
 * length as it came in.
 */
export function shiftVoice(x: Float64Array, marks: readonly PitchMark[], pitchRatio: number, formantRatio: number): Float64Array {
  const out = new Float64Array(x.length);
  if (marks.length === 0) return out;
  let t = marks[0]!.pos;
  let k = 0;
  let wasVoiced = false;
  while (t < x.length) {
    while (k + 1 < marks.length && Math.abs(marks[k + 1]!.pos - t) <= Math.abs(marks[k]!.pos - t)) k += 1;
    // A voiced run starts on its first pulse, so an onset keeps its timing.
    if (!wasVoiced && marks[k]!.voiced) {
      while (k > 0 && marks[k - 1]!.voiced) k -= 1;
      if (marks[k]!.pos > t) t = marks[k]!.pos;
    }
    const m = marks[k]!;
    wasVoiced = m.voiced;
    const half = Math.max(2, Math.round(m.period));
    const w = hann(2 * half + 1);
    let grain: Float64Array = new Float64Array(2 * half + 1);
    for (let i = 0; i < grain.length; i += 1) grain[i] = (x[m.pos - half + i] ?? 0) * w[i]!;
    if (formantRatio !== 1) {
      grain = resample(grain, 1 / formantRatio);
      // An unvoiced stretch overlaps its neighbours by the stretch: keep its level.
      if (!m.voiced) for (let i = 0; i < grain.length; i += 1) grain[i]! *= formantRatio;
    }
    const at = Math.round(t) - (grain.length >> 1);
    for (let i = 0; i < grain.length; i += 1) {
      const j = at + i;
      if (j >= 0 && j < out.length) out[j]! += grain[i]!;
    }
    // The pulses' own spacing where the next is voiced too, so their jitter carries through.
    const next = marks[k + 1];
    const spacing = m.voiced && next?.voiced ? next.pos - m.pos : m.period;
    t += m.voiced ? spacing / pitchRatio : spacing;
  }
  return out;
}

/** Semitones as a frequency ratio. */
export function semitones(n: number): number {
  return 2 ** (n / 12);
}
