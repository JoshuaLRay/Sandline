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
  if (!/^Digit[1-4]$/.test(code)) return null;
  if (context.orderWheelOpen || context.menuOpen || context.textFieldFocused || !context.alive || context.mounted) return null;

  const digit = Number(code.slice(-1));
  if (digit === 1 || digit === 2) {
    const guns = context.loadoutGuns ?? FREE_RANGE_GUNS;
    const weaponId = digit === 1
      ? (context.primary ?? guns.find((id) => id !== 'sidearm'))
      : guns.find((id) => id === 'sidearm');
    if (weaponId === undefined) return null;
    const index = WEAPON_IDS.indexOf(weaponId as (typeof WEAPON_IDS)[number]);
    return index >= 0 ? index : null;
  }

  // 3–4 retain the free range's extra QA weapons. A class may add its own
  // additional weapon roles in a later task without inheriting array order.
  if (context.loadoutGuns !== null) return null;
  const rangeOnly = WEAPON_IDS.filter((id) => id !== 'carbine' && id !== 'sidearm');
  const extraId = rangeOnly[digit - 3];
  return extraId === undefined ? null : WEAPON_IDS.indexOf(extraId);
}
