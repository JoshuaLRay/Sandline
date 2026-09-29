import { WEAPON_IDS } from '@sandline/shared';

/** Resolve the direct weapon-slot keys without relying on global array order. */
export interface WeaponKeyContext {
  orderWheelOpen: boolean;
  menuOpen: boolean;
  textFieldFocused: boolean;
  alive: boolean;
  mounted: boolean;
  /** Null for the free range; otherwise the equipped class loadout. */
  loadoutGuns: readonly string[] | null;
  /** U-018: the primary the host says this soldier carries (a picked-up gun once one is taken); key 1 draws it. */
  primary?: string | null;
}

const FREE_RANGE_GUNS = ['carbine', 'sidearm'] as const;

export function weaponIndexForKey(code: string, context: WeaponKeyContext): number | null {
  if (!/^Digit[1-37-9]$/.test(code)) return null;
  if (context.orderWheelOpen || context.menuOpen || context.textFieldFocused || !context.alive || context.mounted) return null;

  const digit = Number(code.slice(-1));
  if (digit === 3) return WEAPON_IDS.indexOf('knife');
  if (digit === 1 || digit === 2) {
    const guns = context.loadoutGuns ?? FREE_RANGE_GUNS;
    const weaponId = digit === 1
      ? (context.primary ?? guns.find((id) => id !== 'sidearm'))
      : guns.find((id) => id === 'sidearm');
    if (weaponId === undefined) return null;
    const index = WEAPON_IDS.indexOf(weaponId as (typeof WEAPON_IDS)[number]);
    return index >= 0 ? index : null;
  }

  // 7-9 keep the free range's QA weapons (they were 4 and up before 4 became
  // the grenade, U-045). A class never gets them: its guns are 1-3.
  if (context.loadoutGuns !== null) return null;
  const rangeOnly = WEAPON_IDS.filter((id) => id !== 'carbine' && id !== 'sidearm');
  const extraId = rangeOnly.filter((id) => id !== 'knife')[digit - 7];
  return extraId === undefined ? null : WEAPON_IDS.indexOf(extraId);
}

/**
 * The device slots (U-044/U-045): 4 grenades, 5 equipment, 6 health kits.
 * Each is drawn before it is used. Whether the slot holds anything is the
 * caller's to say; an empty slot does nothing.
 */
export type DeviceSlot = 'grenade' | 'equipment' | 'health';

export function deviceSlotForKey(code: string, context: WeaponKeyContext): DeviceSlot | null {
  if (context.orderWheelOpen || context.menuOpen || context.textFieldFocused || !context.alive || context.mounted) return null;
  switch (code) {
    case 'Digit4': return 'grenade';
    case 'Digit5': return 'equipment';
    case 'Digit6': return 'health';
    default: return null;
  }
}
