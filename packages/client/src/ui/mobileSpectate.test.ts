import { describe, expect, it } from 'vitest';
import type { RosterEntry } from '@sandline/shared';
import { initialMobileSpectateSlot } from './mobileSpectate.ts';

const roster = (commanders: number[]): RosterEntry[] => commanders.map((commander, slot) => ({
  name: `Soldier ${slot + 1}`, classId: 'team-leader', human: commander === -1, commander,
}));

describe('mobile first spectate target', () => {
  it('waits for a roster and watches a bot commanded by the local player', () => {
    expect(initialMobileSpectateSlot([], 0)).toBeNull();
    expect(initialMobileSpectateSlot(roster([-1, -1, 1, 0, 1, 0]), 0)).toBe(3);
    expect(initialMobileSpectateSlot(roster([-1, -1, 1, 0, 1, 0]), 1)).toBe(2);
  });

  it('falls back to a bot belonging to another commander, then the own seat', () => {
    expect(initialMobileSpectateSlot(roster([-1, -1, 1, 1, 1, 1]), 0)).toBe(2);
    expect(initialMobileSpectateSlot(roster([-1, -1]), 0)).toBe(0);
  });
});
