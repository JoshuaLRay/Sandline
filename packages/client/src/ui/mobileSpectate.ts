import type { RosterEntry } from '@sandline/shared';

/** The mobile seat becomes AI-driven as soon as spectating starts. */
export function initialMobileSpectateSlot(roster: readonly RosterEntry[], mySlot: number): number | null {
  return mySlot >= 0 && roster[mySlot] ? mySlot : null;
}
