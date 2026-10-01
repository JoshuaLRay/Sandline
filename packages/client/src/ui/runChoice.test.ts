import { describe, expect, it } from 'vitest';
import type { CampaignDef } from '@sandline/shared';
import { runChoiceModel } from './runChoice.ts';

const campaign: CampaignDef = {
  id: 't',
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
