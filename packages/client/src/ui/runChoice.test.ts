import { describe, expect, it } from 'vitest';
import type { CampaignDef } from '@sandline/shared';
import { missionMenuModel, runChoiceModel } from './runChoice.ts';

const campaign: CampaignDef = {
  id: 't',
  replayKeepsLoadout: true,
  missions: [
    { mission: 'a', title: 'Alpha', briefing: ['go a'], debrief: ['won a'] },
    { mission: 'b', title: 'Bravo', briefing: ['go b'], debrief: [] },
  ],
} as CampaignDef;

const offer = (over: Partial<Parameters<typeof runChoiceModel>[0] & object> = {}) => ({
  kind: 'RunOffer' as const,
  mission: 'a',
  result: 'complete' as const,
  host: 2,
  campaign: 'b',
  replay: ['a'],
  ...over,
});

describe('runChoiceModel', () => {
  it('shows nothing without an offer', () => {
    expect(runChoiceModel(null, 0, 'x', campaign)).toBeNull();
  });

  it('offers the host the next mission and a replay, with the debrief', () => {
    const m = runChoiceModel(offer(), 2, 'Ann', campaign)!;
    expect(m.host).toBe(true);
    expect(m.waiting).toBe('');
    expect(m.heading).toBe('Alpha — complete');
    expect(m.debrief).toEqual(['won a']);
    expect(m.options.map((o) => [o.run, o.mission, o.label])).toEqual([
      ['campaign', 'b', 'Campaign — Bravo'],
      ['replay', 'a', 'Replay — Alpha'],
    ]);
    expect(m.options[0]!.briefing).toEqual(['go b']);
  });

  it('tells everyone else whose choice it is', () => {
    const m = runChoiceModel(offer(), 0, 'Ann', campaign)!;
    expect(m.host).toBe(false);
    expect(m.waiting).toBe('Ann is choosing what to play next');
  });

  it('calls a failed newest mission a retry and shows no debrief', () => {
    const m = runChoiceModel(offer({ mission: 'b', result: 'failed', replay: ['a'] }), 2, 'Ann', campaign)!;
    expect(m.debrief).toEqual([]);
    expect(m.options[0]!.label).toBe('Retry — Bravo');
  });

  it('offers only replays once the season is done', () => {
    const m = runChoiceModel(offer({ campaign: '', replay: ['a', 'b'] }), 2, 'Ann', campaign)!;
    expect(m.options.map((o) => o.run)).toEqual(['replay', 'replay']);
  });
});

describe('missionMenuModel (U-078)', () => {
  const running = (over = {}) => offer({ mission: 'b', result: 'progress', host: 1, campaign: 'b', replay: ['a'], ...over });

  it('is for the host only, and for nobody without an offer', () => {
    expect(missionMenuModel(null, 1, campaign)).toBeNull();
    expect(missionMenuModel(running(), 0, campaign)).toBeNull();
    expect(missionMenuModel(running(), 1, campaign)).not.toBeNull();
  });

  it('offers the other missions, not the one already on', () => {
    const m = missionMenuModel(running(), 1, campaign)!;
    expect(m.mission).toBe('Bravo');
    expect(m.options.map((o) => [o.run, o.mission])).toEqual([['replay', 'a']]);
  });

  it('on a replay of a beaten mission, offers the campaign’s newest and the other replays', () => {
    const m = missionMenuModel(running({ mission: 'a', campaign: 'b', replay: ['a'] }), 1, campaign)!;
    expect(m.options.map((o) => [o.run, o.mission])).toEqual([['campaign', 'b']]);
  });

  it('is not the after-action panel: the in-mission offer has no debrief to show', () => {
    expect(runChoiceModel(running(), 1, 'Ann', campaign)).toBeNull();
  });
});
