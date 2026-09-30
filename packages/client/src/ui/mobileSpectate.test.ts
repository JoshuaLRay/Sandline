import { describe, expect, it } from 'vitest';
import type { RosterEntry } from '@sandline/shared';
import { initialMobileSpectateSlot } from './mobileSpectate.ts';

const roster = (commanders: number[]): RosterEntry[] => commanders.map((commander, slot) => ({
  name: `Soldier ${slot + 1}`, classId: 'team-leader', human: commander === -1, commander, captured: false,
}));

describe('mobile first spectate target', () => {
  it('waits for a roster then watches the local AI-driven seat', () => {
    expect(initialMobileSpectateSlot([], 0)).toBeNull();
    expect(initialMobileSpectateSlot(roster([-1, -1, 1, 0, 1, 0]), 0)).toBe(0);
    expect(initialMobileSpectateSlot(roster([-1, -1, 1, 0, 1, 0]), 1)).toBe(1);
  });

  it('does not start spectating before the local seat appears', () => {
    expect(initialMobileSpectateSlot(roster([-1, -1]), 2)).toBeNull();
  });
});
