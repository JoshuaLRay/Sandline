/**
 * The mix as data (T-2.45): the committed file parses; the falloff curve
 * interpolates and holds; priority rewards your own sound and costs
 * distance; sound takes distance over its speed to arrive; and a wrong file
 * is refused by name.
 */
import { describe, expect, it } from 'vitest';
import { MIX, dbToGain, falloffGain, parseMix, soundDelaySeconds, voicePriority } from '../index.ts';

describe('the mix (T-2.45)', () => {
  it('interpolates the falloff between its points and holds past either end; an unplaced class is always 1', () => {
    const curve = [[0, 1], [10, 1], [30, 0.5], [50, 0]] as const;
    expect(falloffGain(curve, 5)).toBe(1);
    expect(falloffGain(curve, 20)).toBeCloseTo(0.75, 9);
    expect(falloffGain(curve, 40)).toBeCloseTo(0.25, 9);
    expect(falloffGain(curve, 500)).toBe(0);
    expect(falloffGain(null, 500)).toBe(1);
    expect(falloffGain(MIX.classes.weapon.falloff, 0)).toBe(1);
  });

  it('ranks your own sound over another at the same distance, and a near one over a far one', () => {
    expect(voicePriority(MIX, 'weapon', true, 20)).toBeGreaterThan(voicePriority(MIX, 'weapon', false, 20));
    expect(voicePriority(MIX, 'weapon', false, 5)).toBeGreaterThan(voicePriority(MIX, 'weapon', false, 200));
    expect(voicePriority(MIX, 'weapon', false, 10)).toBeCloseTo(MIX.classes.weapon.priority - MIX.priority.perMetre * 10, 9);
  });

  it('delays a sound by distance over the speed of sound', () => {
    expect(soundDelaySeconds(MIX, MIX.speedOfSound)).toBeCloseTo(1, 9);
    expect(soundDelaySeconds(MIX, 0)).toBe(0);
    expect(dbToGain(-20)).toBeCloseTo(0.1, 9);
  });

  it('refuses what is wrong, each by name', () => {
    const good = JSON.parse(JSON.stringify({ ...MIX, classes: MIX.classes })) as Record<string, unknown>;
    expect(parseMix(good).voiceLimit).toBe(MIX.voiceLimit);
    expect(() => parseMix({ ...good, loudness: 1 })).toThrow("unknown key 'loudness'");
    expect(() => parseMix({ ...good, voiceLimit: 2.5 })).toThrow('whole number');
    const classes = good['classes'] as Record<string, unknown>;
    expect(() => parseMix({ ...good, classes: { ...classes, weapon: { priority: 1, falloff: [[0, 1], [0, 0.5]] } } })).toThrow('distances must ascend');
    expect(() => parseMix({ ...good, classes: { ...classes, weapon: { priority: 1, falloff: [[0, 2], [10, 0]] } } })).toThrow('[0, 1]');
    const { ui: _ui, ...missing } = classes;
    expect(() => parseMix({ ...good, classes: missing })).toThrow("missing 'ui'");
  });
});
