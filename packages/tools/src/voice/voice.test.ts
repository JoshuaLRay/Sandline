/**
 * The voice pipeline (T-2.48), on generated signals — nobody's recording is
 * needed to test it:
 *
 * - a profile's pitch shift moves a synthetic vowel's fundamental by its
 *   data-set amount, with the formants within a semitone of their own shift
 *   (and resampling, which moves both, fails that check);
 * - the take splitter finds every take in a file of tones and silences;
 * - loudness lands within its target, under the ceiling;
 * - consent and the script's names are enforced; the whole run is seeded;
 * - a raw upload committed without re-processing fails the check, as a
 *   recipe does for effects.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AUDIO_SAMPLE_RATE, VOICES, parseVoices } from '@sandline/shared';
import RAW_VOICES from '../../../shared/src/data/audio/voices.json' with { type: 'json' };
import { oscillator } from '../audio/dsp.ts';
import { toPcm16, wavBytes } from '../audio/render.ts';
import { formants, integratedLoudness, medianPitch, normaliseLoudness, peakOf, resample, splitTakes, trackPitch } from './analysis.ts';
import { findSpeakers, nameTakes, renderVoices } from './process.ts';
import { pitchMarks, semitones, shiftVoice } from './psola.ts';
import { RAW_DIR, VOICE_DIR, VOICE_RENDERS_FILE, type VoiceRendersManifest, sha256, voiceInputsHash } from './renders.ts';
import { recording, voicedTone } from './testSignals.ts';
import { decodeWav } from './wavIn.ts';

const RATE = AUDIO_SAMPLE_RATE;
const temps: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'sandline-voice-'));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** A WAV as a phone might save it: 24-bit, stereo, at 44.1 kHz. */
function wav24Stereo(samples: Float64Array, rate: number): Uint8Array {
  const data = samples.length * 6;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const str = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + data, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 6, true);
  v.setUint16(32, 6, true);
  v.setUint16(34, 24, true);
  str(36, 'data');
  v.setUint32(40, data, true);
  samples.forEach((s, i) => {
    const q = Math.max(-8388608, Math.min(8388607, Math.round(s * 8388608)));
    for (let c = 0; c < 2; c += 1) {
      const at = 44 + i * 6 + c * 3;
      v.setUint8(at, q & 0xff);
      v.setUint8(at + 1, (q >> 8) & 0xff);
      v.setUint8(at + 2, (q >> 16) & 0xff);
    }
  });
  return new Uint8Array(buf);
}

describe('resampling and loudness (T-2.48)', () => {
  it('keeps a tone below the new Nyquist and removes one above it', () => {
    const low = oscillator('sine', 1000, null, 0, RATE / 2, RATE);
    const high = oscillator('sine', 15_000, null, 0, RATE / 2, RATE);
    const down = resample(low, 0.5);
    expect(down.length).toBe(RATE / 4);
    expect(peakOf(down.slice(1000, 11000))).toBeGreaterThan(0.98);
    expect(peakOf(resample(high, 0.5).slice(1000, 11000))).toBeLessThan(0.01);
    expect(medianPitch(trackPitch(resample(down, 2), [60, 1200]))).toBeCloseTo(1000, -1);
  });

  it('measures BS.1770 loudness: a 1 kHz sine at −20 dBFS peak is −23 LUFS', () => {
    const sine = oscillator('sine', 997, null, 0, RATE * 2, RATE);
    for (let i = 0; i < sine.length; i += 1) sine[i]! *= 0.1;
    expect(integratedLoudness(sine)).toBeCloseTo(-23.01, 1);
    expect(integratedLoudness(new Float64Array(RATE))).toBe(Number.NEGATIVE_INFINITY);
  });

  it('brings a quiet line, a loud one, a short one and one with a plosive to the target under the ceiling', () => {
    const { targetLufs, toleranceLu, ceilingDb } = VOICES.loudness;
    // A plosive: a full-scale burst ahead of a quiet vowel, 20 dB over it.
    const plosive = voicedTone({ f0: 120, seconds: 0.8, level: 0.1 });
    for (let i = 0; i < 96; i += 1) plosive[i + 480] = i % 2 ? 1 : -1;
    const cases = [voicedTone({ f0: 110, seconds: 1, level: 0.02 }), voicedTone({ f0: 200, seconds: 0.8, level: 0.99 }), voicedTone({ f0: 150, seconds: 0.25 }), plosive];
    for (const x of cases) {
      const y = normaliseLoudness(x, targetLufs, ceilingDb);
      console.log(`loudness ${integratedLoudness(x).toFixed(2)} → ${integratedLoudness(y).toFixed(2)} LUFS, peak ${(20 * Math.log10(peakOf(y))).toFixed(2)} dB`);
      expect(Math.abs(integratedLoudness(y) - targetLufs)).toBeLessThanOrEqual(toleranceLu);
      expect(20 * Math.log10(peakOf(y))).toBeLessThanOrEqual(ceilingDb + 1e-9);
    }
  });
});

describe('the take splitter (T-2.48)', () => {
  it('finds every take in a file of tones and silences — quiet, loud, short, and one with a pause inside — and drops a click', () => {
    const syllable = (f0: number, seconds: number, level: number) => voicedTone({ f0, seconds, level });
    const withPause = (() => {
      const a = syllable(130, 0.35, 0.4);
      const b = syllable(120, 0.4, 0.4);
      const gap = Math.round(0.25 * RATE);
      const out = new Float64Array(a.length + gap + b.length);
      out.set(a);
      out.set(b, a.length + gap);
      return out;
    })();
    const click = new Float64Array(Math.round(0.03 * RATE));
    click[10] = 0.5;
    const takes = [syllable(110, 0.6, 0.5), syllable(180, 0.3, 0.03), syllable(95, 0.9, 0.9), withPause, syllable(140, 0.15, 0.3), syllable(220, 0.5, 0.1), syllable(125, 0.7, 0.4)];
    const { samples, spans } = recording([takes[0]!, takes[1]!, click, ...takes.slice(2)], 1);
    const tones = spans.filter((_, i) => i !== 2);
    const found = splitTakes(samples, VOICES.split);
    expect(found).toHaveLength(takes.length);
    const pad = (VOICES.split.padAfterMs / 1000) * RATE;
    found.forEach((take, i) => {
      // Each take holds its whole tone (less the tone's own fades), and not much more.
      expect(take.start).toBeLessThanOrEqual(tones[i]!.start + 0.03 * RATE);
      expect(take.end).toBeGreaterThanOrEqual(tones[i]!.end - 0.03 * RATE);
      expect(take.end - take.start).toBeLessThan(tones[i]!.end - tones[i]!.start + pad + 0.1 * RATE);
    });
  });

  it('names takes from the script by position, and refuses a count that does not match unless edits drop the extra', () => {
    const lines = ['copy', 'roger'];
    const cfg = { ...VOICES, takesPerLine: 3 };
    const say = (f0: number) => voicedTone({ f0, seconds: 0.4 });
    const six = [say(100), say(102), say(104), say(150), say(152), say(154)];
    const named = nameTakes(recording(six).samples, lines, cfg);
    expect([...named.keys()]).toEqual(lines);
    expect(named.get('copy')!.map((t) => Math.round(medianPitch(trackPitch(t.samples, cfg.pitchRangeHz))))).toEqual([100, 102, 104]);
    expect(named.get('roger')!.map((t) => Math.round(medianPitch(trackPitch(t.samples, cfg.pitchRangeHz))))).toEqual([150, 152, 154]);
    const falseStart = [six[0]!, say(300), ...six.slice(1)];
    expect(() => nameTakes(recording(falseStart).samples, lines, cfg, [], 'pat/orders-normal')).toThrow(/pat\/orders-normal: found 7 takes, the script asks for 6 \(2 lines × 3\)/);
    expect(nameTakes(recording(falseStart).samples, lines, cfg, [1]).get('copy')!).toHaveLength(3);
  });
});

describe('pitch and formants, apart (T-2.48)', () => {
  const vowel = voicedTone({ f0: 120, seconds: 1 });
  const marks = pitchMarks(vowel, trackPitch(vowel, VOICES.pitchRangeHz));
  const inF0 = medianPitch(trackPitch(vowel, VOICES.pitchRangeHz));
  const inFormants = formants(vowel);
  const middle = (x: Float64Array) => x.slice(Math.round(0.15 * RATE), Math.round(0.85 * RATE));
  /** A semitone, as a fraction: the formants' tolerance. */
  const SEMITONE = semitones(1) - 1;

  it('measures the vowel it was made with', () => {
    expect(inF0).toBeCloseTo(120, 0);
    [700, 1220, 2600].forEach((hz, i) => expect(Math.abs(inFormants[i]! / hz - 1)).toBeLessThan(SEMITONE));
  });

  it.each([
    ['deeper and bigger', -4, -2],
    ['deeper only', -4, 0],
    ['higher', 3, 1],
    ['much deeper', -7, -3],
  ])('%s (pitch %d, formants %d semitones): the fundamental moves by its amount, the formants by theirs', (_name, pitch, formant) => {
    const out = middle(shiftVoice(vowel, marks, semitones(pitch), semitones(formant)));
    const f0 = medianPitch(trackPitch(out, VOICES.pitchRangeHz));
    const fs = formants(out);
    const wantF0 = inF0 * semitones(pitch);
    const wantFs = inFormants.map((hz) => hz * semitones(formant));
    console.log(`pitch ${pitch} formant ${formant}: f0 ${f0.toFixed(2)} (want ${wantF0.toFixed(2)}), formants ${fs.map(Math.round).join(' ')} (want ${wantFs.map(Math.round).join(' ')})`);
    expect(Math.abs(f0 / wantF0 - 1)).toBeLessThan(0.01);
    fs.slice(0, 3).forEach((hz, i) => expect(Math.abs(hz / wantFs[i]! - 1)).toBeLessThan(SEMITONE));
  });

  it('is not resampling: the slowed-tape way moves the formants with the pitch, and fails the same check', () => {
    const tape = middle(resample(vowel, 1 / semitones(-4)));
    expect(Math.abs(medianPitch(trackPitch(tape, VOICES.pitchRangeHz)) / (inF0 * semitones(-4)) - 1)).toBeLessThan(0.01);
    expect(Math.abs(formants(tape)[0]! / inFormants[0]! - 1)).toBeGreaterThan(SEMITONE);
  });

  it('keeps the length, and with no shift gives back the vowel', () => {
    const same = shiftVoice(vowel, marks, 1, 1);
    expect(same.length).toBe(vowel.length);
    let err = 0;
    let sig = 0;
    for (let i = RATE * 0.1; i < RATE * 0.9; i += 1) {
      err += (same[i]! - vowel[i]!) ** 2;
      sig += vowel[i]! ** 2;
    }
    expect(10 * Math.log10(err / sig)).toBeLessThan(-6);
  });
});

describe('reading uploads (T-2.48)', () => {
  it('reads a 24-bit stereo WAV at 44.1 kHz as mono', () => {
    const tone = oscillator('sine', 440, null, 0, 4410, 44_100);
    for (let i = 0; i < tone.length; i += 1) tone[i]! *= 0.5;
    const { rate, samples } = decodeWav(wav24Stereo(tone, 44_100));
    expect(rate).toBe(44_100);
    expect(samples.length).toBe(4410);
    for (let i = 0; i < samples.length; i += 97) expect(samples[i]).toBeCloseTo(tone[i]!, 5);
    expect(() => decodeWav(new Uint8Array(64), 'x.wav')).toThrow('x.wav: not a WAV file');
  });
});

/** A small script and two of the six profiles, so a whole run takes a moment. */
const SMALL = {
  ...parseVoices({
    ...RAW_VOICES,
    script: { takesPerLine: 2, sections: { orders: { lines: ['copy', 'roger'], render: ['normal'] }, hit: { lines: ['im-hit'], hurt: ['pain-grunt'], render: ['shout', 'hurt'] } } },
    treatments: ['dry', 'radio', 'distant'],
  }),
  profiles: VOICES.profiles.slice(0, 2),
};

function speakerDir(root: string, name: string, consent = true): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  if (consent) writeFileSync(join(dir, 'CONSENT.md'), `I agree to my voice being used in Sandline — ${name}, 2026-09-26\n`);
  const say = (f0: number, seconds = 0.45) => voicedTone({ f0, seconds, toF0: f0 * 0.85 });
  writeFileSync(join(dir, 'orders-normal.wav'), wavBytes(toPcm16(recording([say(110), say(112), say(130), say(128)]).samples)));
  writeFileSync(join(dir, 'hit-shout.wav'), wav24Stereo(resample(recording([say(160), say(165)]).samples, 44_100 / RATE), 44_100));
  return dir;
}

describe('a whole run (T-2.48)', () => {
  it('refuses a speaker without consent, and a file the script does not name', () => {
    const root = temp();
    speakerDir(root, 'noconsent', false);
    expect(() => findSpeakers(root, SMALL)).toThrow('noconsent/: no CONSENT.md');
    const other = temp();
    const dir = speakerDir(other, 'pat');
    writeFileSync(join(dir, 'order-normal.wav'), new Uint8Array(0));
    expect(() => findSpeakers(other, SMALL)).toThrow('pat/order-normal.wav: not a pass the script names');
  });

  it('makes every line for every profile and treatment, at the loudness target, the same bytes every time', () => {
    const root = temp();
    speakerDir(root, 'pat');
    const run = renderVoices(root, SMALL);
    expect(run.speakers).toEqual([{ name: 'pat', passes: { 'hit-shout': 2, 'orders-normal': 4 } }]);
    // copy, roger (normal) and im-hit (shout), for two profiles, two variants, three treatments; pain-grunt was not recorded.
    expect(run.lines).toHaveLength(3 * 2 * 2 * 3);
    expect(run.missing).toEqual(['s0/pain-grunt.hurt (pat has no hit-hurt)', 's1/pain-grunt.hurt (pat has no hit-hurt)']);
    const { targetLufs, toleranceLu, ceilingDb } = SMALL.loudness;
    for (const line of run.lines) {
      expect(Math.abs(line.lufs - targetLufs)).toBeLessThanOrEqual(toleranceLu);
      expect(line.peakDb).toBeLessThanOrEqual(ceilingDb + 0.01);
    }
    const byFile = new Map(run.lines.map((l) => [l.file, l]));
    const dry = byFile.get('s0/copy.normal.dry.0.wav')!;
    const radio = byFile.get('s0/copy.normal.radio.0.wav')!;
    const distant = byFile.get('s0/copy.normal.distant.0.wav')!;
    expect(radio.seconds).toBeGreaterThan(dry.seconds + 0.15);
    expect(distant.seconds).toBeGreaterThan(dry.seconds + 0.3);
    // The two profiles are two voices: s0 is two semitones under s1.
    const pitchOf = (file: string) => {
      const bytes = byFile.get(file)!.wav;
      const pcm = new Int16Array(bytes.buffer.slice(bytes.byteOffset + 44, bytes.byteOffset + bytes.byteLength));
      return medianPitch(trackPitch(resample(Float64Array.from(pcm, (s) => s / 32768), RATE / SMALL.sampleRate), SMALL.pitchRangeHz));
    };
    expect(12 * Math.log2(pitchOf('s0/copy.normal.dry.0.wav') / pitchOf('s1/copy.normal.dry.0.wav'))).toBeCloseTo(-2, 0);
    const again = renderVoices(root, SMALL);
    expect(again.lines.map((l) => sha256(l.wav))).toEqual(run.lines.map((l) => sha256(l.wav)));
  }, 60_000);
});

describe('what is committed (T-2.48)', () => {
  const manifest = JSON.parse(readFileSync(VOICE_RENDERS_FILE, 'utf8')) as VoiceRendersManifest;

  it('was processed from what is uploaded now — run `pnpm gen:voice` if this fails', () => {
    expect(manifest.inputsHash).toBe(voiceInputsHash());
    expect(() => findSpeakers(RAW_DIR, VOICES)).not.toThrow();
  });

  it('every line the manifest lists is committed as written, and nothing else is', () => {
    const listed = new Set<string>(['renders.json']);
    for (const variants of Object.values(manifest.lines)) {
      for (const f of variants) {
        listed.add(f.file);
        expect(sha256(readFileSync(join(VOICE_DIR, f.file)))).toBe(f.sha256);
      }
    }
    const walk = (dir: string, prefix = ''): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]));
    expect(walk(VOICE_DIR).filter((f) => !listed.has(f))).toEqual([]);
  });

  it('an upload committed without re-processing changes the hash, so the check above fails; the README does not', () => {
    const root = temp();
    if (existsSync(RAW_DIR)) cpSync(RAW_DIR, root, { recursive: true });
    const before = voiceInputsHash(root);
    writeFileSync(join(root, 'README.md'), 'edited');
    expect(voiceInputsHash(root)).toBe(before);
    speakerDir(root, 'pat');
    expect(voiceInputsHash(root)).not.toBe(before);
  });
});
