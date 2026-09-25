import { describe, expect, it } from 'vitest';
import { MAX_XP, PROGRESSION, rankForXp } from '@sandline/shared';
import { newCampaignState } from './CampaignDatabase.ts';
import { SoldierXp } from './xp.ts';

describe('soldier XP', () => {
  it('stores totals on soldiers and keeps each player’s credit separate', () => {
    const xp = new SoldierXp(newCampaignState('range').soldiers);
    expect(xp.award(0, null, 'kill')).toBe(false);
    xp.award(0, 'a', 'kill');
    xp.award(0, 'b', 'revive');
    expect(xp.view('a')[0]).toMatchObject({ xp: 75, earned: 25 });
    expect(xp.view('b')[0]).toMatchObject({ xp: 75, earned: 50 });
    expect(xp.view('stranger')[0]).toMatchObject({ xp: 75, earned: 0 });
    xp.restart();
    expect(xp.view('a')[0]).toMatchObject({ xp: 75, earned: 0 });
  });

  it('recomputes ranks from saved XP, promotes and caps totals without wrapping', () => {
    const soldiers = newCampaignState('range').soldiers;
    soldiers[0]!.xp = PROGRESSION.ranks[1]!.xp - PROGRESSION.awards.kill;
    const xp = new SoldierXp(soldiers);
    xp.award(0, 'a', 'kill');
    expect(xp.view('a')[0]?.rank).toBe(1);
    soldiers[0]!.xp = MAX_XP - 1;
    xp.award(0, 'a', 'kill');
    expect(xp.view('a')[0]).toMatchObject({ xp: MAX_XP, rank: rankForXp(MAX_XP) });
    expect(xp.award(0, 'a', 'kill')).toBe(false);
    expect(new SoldierXp(soldiers).view('a')[0]?.rank).toBe(rankForXp(MAX_XP));
  });
});
