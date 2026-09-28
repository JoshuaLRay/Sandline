import type { NetClient } from '../net/NetClient.ts';
import type { CombatQA } from './CombatQA.ts';

type HostPrimary = Pick<NetClient, 'primary' | 'magazine'>;
export type PrimarySeen = { net: HostPrimary; primary: number };

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
  if (mounted || primary === null || (seen?.net === net && seen.primary === primary)) return { seen, adopted: false };
  const changed = seen?.net === net;
  const next = { net, primary };
  if (changed && net.magazine?.weapon === primary && combat.weaponIndex !== primary) {
    combat.adopt(primary, net.magazine.ammo);
    return { seen: next, adopted: true };
  }
  return { seen: next, adopted: false };
}
