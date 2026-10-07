import { describe, expect, it } from 'vitest';
import { RESTORE_MAP_CHANGED_MESSAGE, type CampaignDef, type RestoreChoice } from '@sandline/shared';
import { restoreChoiceModel } from './restoreChoice.ts';

const campaign = { id: 'test', replayKeepsLoadout: true, missions: [
  { mission: 'earlier', title: 'Earlier', briefing: ['First mission'], debrief: ['Done'] },
  { mission: 'current', title: 'Current', briefing: ['Current mission'], debrief: ['Done'] },
] } as CampaignDef;
const offer = { kind: 'RunOffer' as const, host: 1, mission: 'current', result: 'progress' as const, campaign: 'current', replay: ['earlier'] };
const choice = (restart: RestoreChoice['restart'] = 'original'): RestoreChoice => ({ host: 1, mission: 'current', restart });

describe('the desktop/mobile incompatible restore model (U-143)', () => {
  it('waits for an authoritative gate and shows the exact message and permitted missions', () => {
    expect(restoreChoiceModel(null, offer, 1, 'Ann', campaign)).toBeNull();
    const model = restoreChoiceModel(choice(), offer, 1, 'Ann', campaign)!;
    expect(model.message).toBe(RESTORE_MAP_CHANGED_MESSAGE);
    expect(model.message).toBe('This mission map has changed. Restart the mission to continue.');
    expect(model.host).toBe(true);
    expect(model.restartAllowed).toBe(true);
    expect(model.inventory).toBe('Restart uses the original mission-start inventory.');
    expect(model.options.map((o) => [o.run, o.mission])).toEqual([['campaign', 'current'], ['replay', 'earlier']]);
    expect(model.options[1]!.briefing).toEqual(['First mission']);
  });

  it('identifies the host to other players and explains legacy inventory without promising spent stock', () => {
    const model = restoreChoiceModel(choice('legacy'), offer, 0, 'Ann', campaign)!;
    expect(model.host).toBe(false);
    expect(model.waiting).toBe('Ann is choosing how to continue');
    expect(model.inventory).toMatch(/no mission-start snapshot.*pre-mission carry-over or class inventory/);
    expect(restoreChoiceModel(choice(), offer, 0, '', campaign)!.waiting).toMatch(/^The host /);
  });

  it('explains the prisoner blocker and keeps restart disabled while leaving mission select available', () => {
    const model = restoreChoiceModel(choice('prisoner-placement'), offer, 1, 'Ann', campaign)!;
    expect(model.restartAllowed).toBe(false);
    expect(model.inventory).toMatch(/approved holding positions.*pool is preserved/);
    expect(model.options.map((o) => o.mission)).toEqual(['earlier']);
  });

  it('does not expose a stale offer after a host or mission change', () => {
    expect(restoreChoiceModel(choice(), { ...offer, host: 0 }, 1, '', campaign)!.options).toEqual([]);
    expect(restoreChoiceModel(choice(), { ...offer, mission: 'elsewhere' }, 1, '', campaign)!.options).toEqual([]);
    expect(restoreChoiceModel(choice(), null, 1, '', campaign)!.options).toEqual([]);
  });
});
