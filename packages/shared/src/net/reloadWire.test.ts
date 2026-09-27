/**
 * U-028: a Reload rides the Equip tag on a code no loadout uses, and the
 * magazine count rides the snapshot's Weapon component. Held here: the code
 * stays clear of every loadout item, an Equip is still an Equip, and the
 * wire's seven bits carry every magazine in the data.
 */
import { describe, expect, it } from 'vitest';
import { PROJECTILE_IDS, WEAPON_IDS, getWeapon } from '../index.ts';
import { RELOAD_ITEM, decodeMessage, encodeMessage } from './protocol.ts';
import { AMMO_MAX } from './schema.ts';

describe('the Reload message (U-028)', () => {
  it('is its own message on the wire, and never mistaken for an Equip of a loadout item', () => {
    expect(RELOAD_ITEM).toBeGreaterThanOrEqual(WEAPON_IDS.length + PROJECTILE_IDS.length);
    expect(RELOAD_ITEM).toBeLessThan(8);
    expect(decodeMessage(encodeMessage({ kind: 'Reload' }))).toEqual({ kind: 'Reload' });
    for (let item = 0; item < WEAPON_IDS.length + PROJECTILE_IDS.length; item += 1) {
      expect(decodeMessage(encodeMessage({ kind: 'Equip', item }))).toEqual({ kind: 'Equip', item });
    }
  });

  it('the magazine count carries every gun\'s magazine', () => {
    for (const id of [...WEAPON_IDS, 'lmg']) expect(getWeapon(id).magSize, id).toBeLessThanOrEqual(AMMO_MAX);
  });
});
