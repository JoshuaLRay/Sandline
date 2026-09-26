/**
 * T-4.26: the settings survive whatever one browser hands back — a missing
 * store, an old shape, bad numbers — and a store that refuses is not an error.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, QUALITY, SETTINGS_KEY, loadSettings, parseSettings, saveSettings } from './settings.ts';

function memoryStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map };
}

describe('the settings (T-4.26)', () => {
  it('parses tolerantly: unknown fields dropped, bad ones defaulted, numbers clamped', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
    const parsed = parseSettings({ sensitivity: 9, invertY: true, fovDeg: 12, volumes: { master: -1, voice: 'loud' }, quality: 'ultra', extra: 1 });
    expect(parsed).toEqual({ sensitivity: 2, invertY: true, fovDeg: 50, volumes: { master: 0, effects: 1, voice: 1 }, quality: 'medium', hints: true });
    expect(parseSettings({ quality: 'high', fovDeg: 90 })).toMatchObject({ quality: 'high', fovDeg: 90 });
    // T-5.03: hints on unless switched off; a stored non-boolean is the default.
    expect(parseSettings({ hints: false }).hints).toBe(false);
    expect(parseSettings({ hints: 'no' }).hints).toBe(true);
  });

  it('round-trips through a store, and reads the defaults from an empty, corrupt or missing one', () => {
    const store = memoryStore();
    const settings = { ...DEFAULT_SETTINGS, sensitivity: 0.8, invertY: true, quality: 'low' as const, volumes: { master: 0.5, effects: 0.25, voice: 1 } };
    expect(saveSettings(store, settings)).toBe(true);
    expect(loadSettings(store)).toEqual(settings);
    expect(loadSettings(memoryStore())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memoryStore({ [SETTINGS_KEY]: '{not json' }))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    const refusing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadSettings(refusing)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(refusing, settings)).toBe(false);
  });

  it('names ADR-013\'s budget as medium, with low under it and high over it', () => {
    expect(QUALITY.medium.pixelRatioMax).toBeLessThan(QUALITY.high.pixelRatioMax);
    expect(QUALITY.low.pixelRatioMax).toBeLessThan(QUALITY.medium.pixelRatioMax);
    expect(QUALITY.low.shadowMapSize).toBeLessThan(QUALITY.medium.shadowMapSize);
    expect(QUALITY.medium.shadowMapSize).toBeLessThan(QUALITY.high.shadowMapSize);
  });
});
