import { describe, expect, it } from 'vitest';
import { MAX_XP, PROGRESSION, parseProgression, rankForXp } from './progression.ts';

describe('progression data', () => {
  it('promotes at each threshold, including the last rank', () => {
    expect(rankForXp(0)).toBe(0);
    PROGRESSION.ranks.slice(1).forEach((rank, index) => {
      expect(rankForXp(rank.xp - 1)).toBe(index);
      expect(rankForXp(rank.xp)).toBe(index + 1);
    });
    expect(rankForXp(MAX_XP)).toBe(PROGRESSION.ranks.length - 1);
  });

  it.each([
    null,
    { ...PROGRESSION, awards: { ...PROGRESSION.awards, kill: -1 } },
    { ...PROGRESSION, awards: { ...PROGRESSION.awards, revive: 0.5 } },
    { ...PROGRESSION, awards: { ...PROGRESSION.awards, order: MAX_XP + 1 } },
    { ...PROGRESSION, awards: { kill: 1 } },
    { ...PROGRESSION, ranks: [] },
    { ...PROGRESSION, ranks: [{ name: 'Private', xp: 1 }] },
    { ...PROGRESSION, ranks: [{ name: 'Private', xp: 0 }, { name: 'Private', xp: 5 }] },
    { ...PROGRESSION, ranks: [{ name: 'Private', xp: 0 }, { name: 'Corporal', xp: 0 }] },
    { ...PROGRESSION, typo: 10 },
  ])('rejects invalid tuning %j', (data) => expect(() => parseProgression(data)).toThrow());
});
