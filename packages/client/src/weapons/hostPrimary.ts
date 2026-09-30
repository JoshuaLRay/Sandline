import type { NetClient } from '../net/NetClient.ts';
import type { CombatQA } from './CombatQA.ts';

type HostPrimary = Pick<NetClient, 'primary' | 'secondary' | 'magazine'>;
export type PrimarySeen = { net: HostPrimary; primary: number; secondary: number | null };

/** Apply a newly replicated carried gun only when the soldier has it in hand. */
export function syncHostPrimary(
  net: HostPrimary,
  mounted: boolean,
  seen: PrimarySeen | null,
  combat: CombatQA,
): { seen: PrimarySeen | null; adopted: boolean } {
  const primary = net.primary;
  // Defer a primary change while mounted. Remembering it now would suppress
  // adoption on dismount and leave the client holding its previous loadout.
  if (mounted || primary === null || (seen?.net === net && seen.primary === primary && seen.secondary === net.secondary)) return { seen, adopted: false };
  const changed = seen?.net === net;
  const secondary = net.secondary;
  const next = { net, primary, secondary };
  const held = net.magazine?.weapon;
  // A pickup can replace either carried primary, or turn into the second one and be drawn (U-022).
  // (or be put down, U-029: the host has then drawn the other primary, the pistol or the knife).
  if (changed && held !== undefined && combat.weaponIndex !== held) {
    combat.adopt(held, net.magazine!.ammo);
    return { seen: next, adopted: true };
  }
  return { seen: next, adopted: false };
}
