/**
 * Which sounds a gun makes, as data (T-2.46): every weapon row has a near
 * and a far report that exist as recipes, the handling sounds exist, and a
 * wrong file is refused by name.
 */
import { describe, expect, it } from 'vitest';
import { SOUNDS, WEAPONS, WEAPON_SOUNDS, parseWeaponSounds } from '../index.ts';
import RAW from '../data/audio/weaponSounds.json' with { type: 'json' };

describe('weapon sounds as data (T-2.46)', () => {
  it('gives every weapon row a near and a far report, and names only recipes that exist', () => {
    for (const id of Object.keys(WEAPONS)) {
      const gun = WEAPON_SOUNDS.guns[id]!;
      expect(SOUNDS.sounds.get(gun.near)?.class).toBe('weapon');
      expect(SOUNDS.sounds.get(gun.far)?.class).toBe('weapon');
      expect(SOUNDS.sounds.get(gun.near)!.variants).toBeGreaterThanOrEqual(2);
    }
    for (const sound of Object.values(WEAPON_SOUNDS.handling)) expect(SOUNDS.sounds.has(sound)).toBe(true);
  });

  it('refuses a missing gun, an unknown sound, a crossfade the wrong way round and stages out of order, each by name', () => {
    const raw = JSON.parse(JSON.stringify(RAW)) as { guns: Record<string, unknown>; handling: Record<string, string>; crossfade: Record<string, number>; stages: Record<string, number> };
    const { lmg: _lmg, ...fewer } = raw.guns;
    expect(() => parseWeaponSounds({ ...raw, guns: fewer })).toThrow("no sounds for 'lmg'");
    expect(() => parseWeaponSounds({ ...raw, guns: { ...raw.guns, laser: { near: 'click', far: 'click' } } })).toThrow("'laser' is not a weapons.json row");
    expect(() => parseWeaponSounds({ ...raw, handling: { ...raw.handling, equip: 'kazoo' } })).toThrow("no sound 'kazoo'");
    expect(() => parseWeaponSounds({ ...raw, crossfade: { nearM: 90, farM: 25 } })).toThrow('nearM < farM');
    expect(() => parseWeaponSounds({ ...raw, stages: { in: 0.9, bolt: 0.5 } })).toThrow('bolt must come after in');
    expect(() => parseWeaponSounds({ ...raw, loud: true })).toThrow("unknown key 'loud'");
  });
});
