import { MAX_XP, PROGRESSION, rankForXp, type SoldierProgress, type XpEvent } from '@sandline/shared';
import type { SoldierSave } from './CampaignDatabase.ts';

/** Campaign soldiers own totals. Mission credit is private to the verified player. */
export class SoldierXp {
  private readonly credits = new Map<string, number[]>();

  constructor(readonly soldiers: SoldierSave[]) {
    for (const soldier of soldiers) {
      soldier.xp = Math.min(MAX_XP, soldier.xp);
      soldier.rank = rankForXp(soldier.xp);
    }
  }

  award(slot: number, playerId: string | null, event: XpEvent): boolean {
    const soldier = this.soldiers[slot];
    if (!playerId || !soldier) return false;
    const amount = Math.min(PROGRESSION.awards[event], MAX_XP - soldier.xp);
    if (amount === 0) return false;
    soldier.xp += amount;
    soldier.rank = rankForXp(soldier.xp);
    const earned = this.credits.get(playerId) ?? this.soldiers.map(() => 0);
    earned[slot] = Math.min(MAX_XP, (earned[slot] ?? 0) + amount);
    this.credits.set(playerId, earned);
    return true;
  }

  view(playerId: string): SoldierProgress[] {
    return this.soldiers.map(({ slot, xp, rank }) => ({ slot, xp, rank, earned: this.credits.get(playerId)?.[slot] ?? 0 }));
  }

  /** A replay starts new after-action credit; checkpoint retries retain it. */
  restart(): void {
    this.credits.clear();
  }
}
