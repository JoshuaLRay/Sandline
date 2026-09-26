/**
 * The synthesiser and the render pipeline (T-2.44). The DSP's pieces do what
 * they say — a low-pass cuts highs, an envelope reaches −60 dB at its decay,
 * FFT convolution equals the direct sum, 16-bit holds rather than wraps, a
 * WAV reads back as written. A render is byte-identical when repeated. Every
 * committed render is what the live recipes and DSP make, within its
 * recipe's bounds, and unclipped; editing a recipe or the DSP's source moves
 * the inputs hash, so the suite fails until `pnpm gen:audio` is run. Nothing
 * here needs an audio device.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SOUNDS, parseSounds, soundFile } from '@sandline/shared';
import { biquad, convolve, envelope, noise, oscillator } from './dsp.ts';
import { measure, readWav, renderSound, toPcm16, wavBytes } from './render.ts';
import { AUDIO_DIR, DSP_SOURCES, RENDERS_FILE, type RendersManifest, audioInputsHash, sha256 } from './renders.ts';

const RATE = 48_000;
const rms = (x: Float64Array, from = 0) => {
  let s = 0;
  for (let i = from; i < x.length; i += 1) s += x[i]! * x[i]!;
  return Math.sqrt(s / (x.length - from));
};

describe('the DSP (T-2.44)', () => {
  it('a low-pass passes a low tone and cuts a high one; a high-pass the reverse', () => {
    const lp = { kind: 'lowpass' as const, hz: 500, q: 0.7071, gainDb: 0, toHz: null, sweepSeconds: 0 };
    const hp = { ...lp, kind: 'highpass' as const };
    const low = () => oscillator('sine', 100, null, 0, RATE / 2, RATE);
    const high = () => oscillator('sine', 8000, null, 0, RATE / 2, RATE);
    const skip = RATE / 20;
    expect(rms(biquad(low(), lp, RATE), skip) / rms(low(), skip)).toBeGreaterThan(0.95);
    expect(rms(biquad(high(), lp, RATE), skip) / rms(high(), skip)).toBeLessThan(0.01);
    expect(rms(biquad(high(), hp, RATE), skip) / rms(high(), skip)).toBeGreaterThan(0.95);
    expect(rms(biquad(low(), hp, RATE), skip) / rms(low(), skip)).toBeLessThan(0.05);
  });

  it('an exp envelope is at full after its attack and down 60 dB at the end of its decay', () => {
    const e = envelope({ attack: 0.01, hold: 0.01, decay: 0.1, curve: 'exp' }, RATE / 2, RATE);
    expect(e[0]).toBe(0);
    expect(e[RATE * 0.015]).toBe(1);
    expect(20 * Math.log10(e[Math.round(RATE * 0.12)]!)).toBeCloseTo(-60, 0);
    const lin = envelope({ attack: 0, hold: 0, decay: 0.1, curve: 'linear' }, RATE / 2, RATE);
    expect(lin[RATE * 0.1]).toBe(0);
  });

  it('FFT convolution equals the direct sum', () => {
    const a = noise(300, 7);
    const b = noise(50, 9);
    const fast = convolve(a, b);
    for (let i = 0; i < a.length; i += 1) {
      let direct = 0;
      for (let j = 0; j <= i && j < b.length; j += 1) direct += a[i - j]! * b[j]!;
      expect(fast[i]).toBeCloseTo(direct, 9);
    }
  });

  it('16-bit holds at full scale rather than wrapping, and a WAV reads back as written', () => {
    const pcm = toPcm16(Float64Array.from([0, 0.5, -0.5, 1.2, -1.2]));
    expect([...pcm]).toEqual([0, 16384, -16384, 32767, -32768]);
    expect(measure(pcm).clipped).toBe(2);
    const back = readWav(wavBytes(pcm, RATE));
    expect(back.rate).toBe(RATE);
    expect([...back.pcm]).toEqual([...pcm]);
  });
});

describe('the renders (T-2.44)', () => {
  const manifest = JSON.parse(readFileSync(RENDERS_FILE, 'utf8')) as RendersManifest;

  it('a render is byte-identical when repeated, and variants differ', () => {
    for (const def of SOUNDS.sounds.values()) {
      const once = wavBytes(toPcm16(renderSound(def, 0)));
      const again = wavBytes(toPcm16(renderSound(def, 0)));
      expect(sha256(again)).toBe(sha256(once));
      if (def.variants > 1) expect(sha256(wavBytes(toPcm16(renderSound(def, 1))))).not.toBe(sha256(once));
    }
  });

  it('the committed renders are what the live recipes and DSP make — run pnpm gen:audio if not', () => {
    expect(manifest.inputsHash, 'renders are stale — run pnpm gen:audio').toBe(audioInputsHash());
    expect(Object.keys(manifest.sounds).sort()).toEqual([...SOUNDS.sounds.keys()].sort());
    for (const [id, def] of SOUNDS.sounds) {
      const files = manifest.sounds[id]!;
      expect(files).toHaveLength(def.variants);
      files.forEach((entry, v) => {
        expect(entry.file).toBe(soundFile(id, v));
        const bytes = new Uint8Array(readFileSync(new URL(entry.file, AUDIO_DIR)));
        expect(sha256(bytes), `${entry.file} is not what gen:audio wrote`).toBe(entry.sha256);
        expect(sha256(wavBytes(toPcm16(renderSound(def, v))))).toBe(entry.sha256);
      });
    }
  });

  it('goes stale when a recipe or the DSP source changes', () => {
    const now = audioInputsHash();
    const raw = JSON.parse(readFileSync(new URL('../../../shared/src/data/audio/sounds.json', import.meta.url), 'utf8')) as { sounds: { click: { seconds: number } } };
    raw.sounds.click.seconds += 0.01;
    expect(audioInputsHash(parseSounds(raw))).not.toBe(now);
    const sources = DSP_SOURCES.map((f) => readFileSync(new URL(f, import.meta.url), 'utf8'));
    expect(audioInputsHash(SOUNDS, sources)).toBe(now);
    expect(audioInputsHash(SOUNDS, [...sources.slice(0, -1), `${sources.at(-1)}\n// changed`])).not.toBe(now);
  });

  it('every committed render is within its recipe’s bounds and nothing clips', () => {
    for (const [id, def] of SOUNDS.sounds) {
      for (const entry of manifest.sounds[id]!) {
        const { pcm } = readWav(new Uint8Array(readFileSync(new URL(entry.file, AUDIO_DIR))));
        const m = measure(pcm, SOUNDS.sampleRate);
        const b = def.bounds;
        expect(m.clipped, `${entry.file} clips`).toBe(0);
        expect(m.peakDb).toBeGreaterThanOrEqual(b.peakDb[0]);
        expect(m.peakDb).toBeLessThanOrEqual(b.peakDb[1]);
        expect(m.rmsDb).toBeGreaterThanOrEqual(b.rmsDb[0]);
        expect(m.rmsDb).toBeLessThanOrEqual(b.rmsDb[1]);
        expect(m.seconds).toBeGreaterThanOrEqual(b.seconds[0]);
        expect(m.seconds).toBeLessThanOrEqual(b.seconds[1]);
      }
    }
  });
});
