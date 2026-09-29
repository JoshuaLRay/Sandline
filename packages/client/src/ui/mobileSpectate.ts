import type { RosterEntry } from '@sandline/shared';

/** Prefer a bot the mobile commander can order; wait for the host's roster. */
export function initialMobileSpectateSlot(roster: readonly RosterEntry[], mySlot: number): number | null {
  if (mySlot < 0 || roster.length === 0) return null;
  const mine = roster.findIndex((entry) => !entry.human && entry.commander === mySlot);
  if (mine >= 0) return mine;
  const otherBot = roster.findIndex((entry) => !entry.human);
  return otherBot >= 0 ? otherBot : mySlot;
}
