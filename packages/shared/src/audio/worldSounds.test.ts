/**
 * World and body sounds as data (T-2.47): every name is a recipe of the
 * right class, and a wrong file is refused by name.
 */
import { describe, expect, it } from 'vitest';
import { SOUNDS, WORLD_SOUNDS, parseWorldSounds } from '../index.ts';
import RAW from '../data/audio/worldSounds.json' with { type: 'json' };

describe('world sounds as data (T-2.47)', () => {
  it('names only recipes that exist, footsteps and bodies in the body class', () => {
    for (const id of Object.values(WORLD_SOUNDS.footsteps)) expect(SOUNDS.sounds.get(id)?.class).toBe('body');
    for (const id of Object.values(WORLD_SOUNDS.bodies)) expect(SOUNDS.sounds.get(id)?.class).toBe('body');
    for (const id of [...Object.values(WORLD_SOUNDS.impacts), WORLD_SOUNDS.nearMiss.crack, WORLD_SOUNDS.explosion.near, WORLD_SOUNDS.explosion.far]) {
      expect(SOUNDS.sounds.get(id)?.class).toBe('world');
    }
  });

  it('refuses an unknown sound, a missing group and a bad distance, each by name', () => {
    const raw = JSON.parse(JSON.stringify(RAW)) as Record<string, Record<string, unknown>>;
    expect(() => parseWorldSounds({ ...raw, impacts: { ...raw['impacts'], wall: 'splat' } })).toThrow("no sound 'splat'");
    const { bodies: _b, ...missing } = raw;
    expect(() => parseWorldSounds(missing)).toThrow("missing 'bodies'");
    expect(() => parseWorldSounds({ ...raw, nearMiss: { ...raw['nearMiss'], distanceM: -1 } })).toThrow('nearMiss.distanceM');
    expect(() => parseWorldSounds({ ...raw, footsteps: { ...raw['footsteps'], swim: 'step-walk' } })).toThrow("unknown key 'swim'");
  });
});
