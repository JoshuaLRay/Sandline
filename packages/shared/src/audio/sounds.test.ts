/**
 * Sound recipes as data (T-2.44): the committed file parses, and a recipe
 * that is wrong is refused by name — an unknown key, a filter kind or wave
 * that does not exist, a bound the wrong way round, a layer starting past
 * the end, a gain on a filter that takes none.
 */
import { describe, expect, it } from 'vitest';
import { AUDIO_SAMPLE_RATE, SOUNDS, parseSounds, soundFile } from '../index.ts';

const layer = { source: { kind: 'noise' }, envelope: { attack: 0.001, decay: 0.05 } };
const sound = (extra: Record<string, unknown> = {}, layerExtra: Record<string, unknown> = {}) => ({
  sounds: {
    pop: {
      class: 'ui',
      seconds: 0.1,
      bounds: { peakDb: [-3, -1], rmsDb: [-40, -10], seconds: [0, 0.1] },
      layers: [{ ...layer, ...layerExtra }],
      ...extra,
    },
  },
});

describe('sound recipes (T-2.44)', () => {
  it('parses the committed recipes at 48 kHz, with defaults filled', () => {
    expect(SOUNDS.sampleRate).toBe(AUDIO_SAMPLE_RATE);
    const click = SOUNDS.sounds.get('click');
    expect(click).toBeDefined();
    expect(click!.variants).toBeGreaterThanOrEqual(1);
    const pop = parseSounds(sound()).sounds.get('pop')!;
    expect(pop).toMatchObject({ variants: 1, normalizePeakDb: -1 });
    expect(pop.layers[0]).toMatchObject({ gain: 1, start: 0, drive: 0, delay: null, reverb: null, filters: [], jitter: { hz: 0, gain: 0, seconds: 0 } });
    expect(pop.layers[0]!.envelope).toEqual({ attack: 0.001, hold: 0, decay: 0.05, curve: 'exp' });
    expect(soundFile('pop', 2)).toBe('pop.2.wav');
  });

  it('refuses what is wrong, each by name', () => {
    expect(() => parseSounds(sound({ pitch: 2 }))).toThrow("unknown key 'pitch'");
    expect(() => parseSounds(sound({}, { source: { kind: 'osc', wave: 'wobble', hz: 100 } }))).toThrow('wave must be one of sine, triangle, square, saw');
    expect(() => parseSounds(sound({}, { filters: [{ kind: 'notch', hz: 100 }] }))).toThrow('kind must be one of lowpass, highpass, bandpass, peak');
    expect(() => parseSounds(sound({}, { filters: [{ kind: 'lowpass', hz: 100, gainDb: 3 }] }))).toThrow("a lowpass takes none");
    expect(() => parseSounds(sound({ bounds: { peakDb: [-1, -3], rmsDb: [-40, -10], seconds: [0, 0.1] } }))).toThrow('min -1 is above max -3');
    expect(() => parseSounds(sound({}, { start: 0.2 }))).toThrow("start is at or past the sound's end");
    expect(() => parseSounds(sound({ variants: 1.5 }))).toThrow('variants must be a whole number');
    expect(() => parseSounds(sound({ layers: [] }))).toThrow('layers must list 1–16 layers');
    expect(() => parseSounds({ sounds: { 'Bad Id': sound().sounds.pop } })).toThrow('id must match');
    expect(() => parseSounds({ sounds: {}, rate: 44100 })).toThrow("unknown key 'rate'");
  });
});
