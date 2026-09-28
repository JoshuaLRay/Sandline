import { describe, expect, it } from 'vitest';
import { WEAPON_IDS } from '@sandline/shared';
import { weaponIndexForKey, type WeaponKeyContext } from './weaponKey.ts';

const ready = (overrides: Partial<WeaponKeyContext> = {}): WeaponKeyContext => ({
  orderWheelOpen: false,
  menuOpen: false,
  textFieldFocused: false,
  alive: true,
  mounted: false,
  loadoutGuns: null,
  ...overrides,
});

describe('weapon slot keys (U-005)', () => {
  it('selects primary and pistol by role for each current class loadout', () => {
    expect(weaponIndexForKey('Digit1', ready({ loadoutGuns: ['carbine', 'sidearm'] }))).toBe(WEAPON_IDS.indexOf('carbine'));
    expect(weaponIndexForKey('Digit2', ready({ loadoutGuns: ['carbine', 'sidearm'] }))).toBe(WEAPON_IDS.indexOf('sidearm'));
    expect(weaponIndexForKey('Digit1', ready({ loadoutGuns: ['marksman', 'sidearm'] }))).toBe(WEAPON_IDS.indexOf('marksman'));
    expect(weaponIndexForKey('Digit2', ready({ loadoutGuns: ['marksman', 'sidearm'] }))).toBe(WEAPON_IDS.indexOf('sidearm'));
  });

  it('keeps the pistol key bound to sidearm if the primary changes or the loadout order changes', () => {
    const changedLoadout = ['breacher', 'sidearm', 'carbine'];
    expect(weaponIndexForKey('Digit1', ready({ loadoutGuns: changedLoadout }))).toBe(WEAPON_IDS.indexOf('breacher'));
    expect(weaponIndexForKey('Digit2', ready({ loadoutGuns: changedLoadout }))).toBe(WEAPON_IDS.indexOf('sidearm'));
    expect(weaponIndexForKey('Digit2', ready({ loadoutGuns: changedLoadout }))).toBe(weaponIndexForKey('Digit2', ready({ loadoutGuns: changedLoadout })));
  });

  it('leaves a missing slot alone and keeps the free range defaults', () => {
    expect(weaponIndexForKey('Digit1', ready({ loadoutGuns: ['sidearm'] }))).toBeNull();
    expect(weaponIndexForKey('Digit2', ready({ loadoutGuns: ['carbine'] }))).toBeNull();
    expect(weaponIndexForKey('Digit1', ready())).toBe(WEAPON_IDS.indexOf('carbine'));
    expect(weaponIndexForKey('Digit2', ready())).toBe(WEAPON_IDS.indexOf('sidearm'));
    expect(weaponIndexForKey('Digit3', ready())).toBe(WEAPON_IDS.indexOf('knife'));
    expect(weaponIndexForKey('Digit3', ready({ loadoutGuns: ['carbine', 'sidearm'] }))).toBe(WEAPON_IDS.indexOf('knife'));
    expect(weaponIndexForKey('Digit4', ready())).toBe(WEAPON_IDS.indexOf('marksman'));
  });

  it('key 1 draws the primary the host says — a gun taken off the ground — and 2 keeps the pistol (U-018)', () => {
    expect(weaponIndexForKey('Digit1', ready({ loadoutGuns: ['marksman', 'sidearm'], primary: 'marksman' }))).toBe(WEAPON_IDS.indexOf('marksman'));
    expect(weaponIndexForKey('Digit2', ready({ loadoutGuns: ['marksman', 'sidearm'], primary: 'marksman' }))).toBe(WEAPON_IDS.indexOf('sidearm'));
    // On the range too: the picked-up gun is key 1, and 3 remains the knife.
    expect(weaponIndexForKey('Digit1', ready({ primary: 'breacher' }))).toBe(WEAPON_IDS.indexOf('breacher'));
    expect(weaponIndexForKey('Digit3', ready({ primary: 'breacher' }))).toBe(WEAPON_IDS.indexOf('knife'));
  });

  it('gives number keys to Q, menus and text fields, and refuses switches while downed or mounted', () => {
    for (const overrides of [
      { orderWheelOpen: true },
      { menuOpen: true },
      { textFieldFocused: true },
      { alive: false },
      { mounted: true },
    ]) {
      expect(weaponIndexForKey('Digit1', ready(overrides))).toBeNull();
      expect(weaponIndexForKey('Digit2', ready(overrides))).toBeNull();
      expect(weaponIndexForKey('Digit3', ready(overrides))).toBeNull();
    }
    expect(weaponIndexForKey('KeyQ', ready())).toBeNull();
  });
});
