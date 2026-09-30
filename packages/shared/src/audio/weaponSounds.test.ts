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

describe('the roster guns sound like themselves (U-043)', () => {
  it('each has reports of its own, none borrowed from another gun', () => {
    const roster = ['smg', 'carbine-scoped', 'sniper-semi', 'sniper-bolt-left'];
    const names = Object.entries(WEAPON_SOUNDS.guns).flatMap(([id, g]) => (id === 'knife' ? [] : [g.near, g.far]));
    expect(new Set(names).size).toBe(names.length);
    for (const id of roster) {
      const gun = WEAPON_SOUNDS.guns[id]!;
      expect(gun.near).toBe(`${id === 'sniper-bolt-left' ? 'sniper-bolt' : id}-near`);
      expect(gun.far).toBe(`${id === 'sniper-bolt-left' ? 'sniper-bolt' : id}-far`);
    }
  });

  it('only the bolt-action gun has a bolt-cycle sound, after the shot, and it is a recipe', () => {
    for (const [id, gun] of Object.entries(WEAPON_SOUNDS.guns)) {
      expect(gun.cycle !== undefined, id).toBe(WEAPONS[id]!.action === 'bolt');
    }
    const cycle = WEAPON_SOUNDS.guns['sniper-bolt-left']!.cycle!;
    expect(SOUNDS.sounds.get(cycle.sound)?.class).toBe('weapon');
    // Later than the report (it is the bolt after the shot) and before the next shot is due.
    expect(cycle.delaySeconds).toBeGreaterThan(0.2);
    expect(cycle.delaySeconds).toBeLessThan(60 / WEAPONS['sniper-bolt-left']!.rpm);
  });

  it('refuses a cycle with a bad delay or an unknown sound, each by name', () => {
    const raw = JSON.parse(JSON.stringify(RAW)) as { guns: Record<string, Record<string, unknown>> };
    const withCycle = (cycle: unknown) => ({ ...raw, guns: { ...raw.guns, 'sniper-bolt-left': { ...raw.guns['sniper-bolt-left'], cycle } } });
    expect(() => parseWeaponSounds(withCycle({ sound: 'bolt-cycle', delaySeconds: 0 }))).toThrow('cycle.delaySeconds');
    expect(() => parseWeaponSounds(withCycle({ sound: 'kazoo', delaySeconds: 0.5 }))).toThrow("no sound 'kazoo'");
    expect(() => parseWeaponSounds(withCycle({ sound: 'bolt-cycle' }))).toThrow("missing 'delaySeconds'");
  });
});
