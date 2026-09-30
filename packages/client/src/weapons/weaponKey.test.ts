import { describe, expect, it } from 'vitest';
import { WEAPON_IDS } from '@sandline/shared';
import { deviceSlotForKey, weaponIndexForKey, type WeaponKeyContext } from './weaponKey.ts';

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
    // 4 is the grenade now (U-045); the range's extra QA guns moved to 7 and 8.
    expect(weaponIndexForKey('Digit4', ready())).toBeNull();
    expect(weaponIndexForKey('Digit7', ready())).toBe(WEAPON_IDS.indexOf('marksman'));
    expect(weaponIndexForKey('Digit7', ready({ loadoutGuns: ['carbine', 'sidearm'] }))).toBeNull();
  });

  it('key 1 draws the primary the host says — a gun taken off the ground — and 2 keeps the pistol (U-018)', () => {
    expect(weaponIndexForKey('Digit1', ready({ loadoutGuns: ['marksman', 'sidearm'], primary: 'marksman' }))).toBe(WEAPON_IDS.indexOf('marksman'));
    expect(weaponIndexForKey('Digit2', ready({ loadoutGuns: ['marksman', 'sidearm'], primary: 'marksman' }))).toBe(WEAPON_IDS.indexOf('sidearm'));
    // On the range too: the picked-up gun is key 1, and 3 remains the knife.
    expect(weaponIndexForKey('Digit1', ready({ primary: 'breacher' }))).toBe(WEAPON_IDS.indexOf('breacher'));
    expect(weaponIndexForKey('Digit3', ready({ primary: 'breacher' }))).toBe(WEAPON_IDS.indexOf('knife'));
  });

  it('key 2 is the second primary; a character carrying two primaries has no pistol (U-022)', () => {
    const support = { loadoutGuns: ['smg', 'breacher'], primary: 'smg', secondary: 'breacher' };
    expect(weaponIndexForKey('Digit2', ready(support))).toBe(WEAPON_IDS.indexOf('breacher'));
    // Preach with a second primary: the class list still names the pistol, but key 2 is the second gun.
    const preach = { loadoutGuns: ['carbine', 'smg', 'sidearm'], primary: 'carbine', secondary: 'smg' };
    expect(weaponIndexForKey('Digit2', ready({ ...preach, held: 'carbine' }))).toBe(WEAPON_IDS.indexOf('smg'));
    expect(weaponIndexForKey('Digit2', ready({ ...preach, held: 'smg' }))).toBe(WEAPON_IDS.indexOf('smg'));
    expect(weaponIndexForKey('Digit1', ready(preach))).toBe(WEAPON_IDS.indexOf('carbine'));
    // With one primary, Preach keeps the pistol on 2.
    expect(weaponIndexForKey('Digit2', ready({ loadoutGuns: ['carbine', 'sidearm'], primary: 'carbine' }))).toBe(WEAPON_IDS.indexOf('sidearm'));
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

describe('device slot keys (U-045)', () => {
  it('4 is the grenade, 5 the equipment and 6 the health kits', () => {
    expect(deviceSlotForKey('Digit4', ready())).toBe('grenade');
    expect(deviceSlotForKey('Digit5', ready())).toBe('equipment');
    expect(deviceSlotForKey('Digit6', ready())).toBe('health');
    for (const code of ['Digit1', 'Digit2', 'Digit3', 'Digit7', 'KeyG']) expect(deviceSlotForKey(code, ready())).toBeNull();
  });

  it('takes nothing while the wheel, a menu or a text field has the keys, or when downed or mounted', () => {
    for (const overrides of [{ orderWheelOpen: true }, { menuOpen: true }, { textFieldFocused: true }, { alive: false }, { mounted: true }]) {
      for (const code of ['Digit4', 'Digit5', 'Digit6']) expect(deviceSlotForKey(code, ready(overrides))).toBeNull();
    }
  });
});
