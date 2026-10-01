/**
 * The campaign as data (U-088): the committed file parses, a bad one is refused, and the helpers answer what the leader
 * may choose after a mission. A throwaway two- and three-mission campaign shows adding a mission is one data entry.
 */
import { describe, expect, it } from 'vitest';
import RAW from '../data/campaign.json' with { type: 'json' };
import { CAMPAIGN, beatenMissions, campaignMission, campaignOrder, isOffered, newestMission, parseCampaign, runOptions } from './campaign.ts';
import { missionFor } from './mission.ts';

const entry = (mission: string, extra: Record<string, unknown> = {}) => ({
  mission,
  title: `Title ${mission}`,
  briefing: [`Brief ${mission}`],
  debrief: [`Debrief ${mission}`],
  ...extra,
});
const known = (ids: string[]) => (id: string) => ids.includes(id);
const three = parseCampaign({ id: 't', missions: [entry('a'), entry('b'), entry('c')] }, known(['a', 'b', 'c']));

describe('the committed campaign (U-088)', () => {
  it('parses, starts at mission-01, and names only registered missions', () => {
    expect(CAMPAIGN.id).toBe('season-1');
    expect(campaignOrder()[0]).toBe('mission-01');
    for (const id of campaignOrder()) expect(missionFor(id), id).toBeDefined();
    const m = campaignMission('mission-01')!;
    expect(m.title).not.toBe('');
    expect(m.briefing.length).toBeGreaterThan(0);
    expect(m.debrief.length).toBeGreaterThan(0);
    expect(parseCampaign(RAW)).toEqual(CAMPAIGN);
  });
});

describe('refusing a bad campaign (U-088)', () => {
  const ok = known(['a', 'b']);
  it('refuses an unknown mission, a repeat, empty text and stray keys', () => {
    expect(() => parseCampaign({ id: 't', missions: [entry('zzz')] }, ok)).toThrow(/not a registered mission/);
    // U-077: whether a replay's end loadout is kept for the campaign; true when the data says nothing.
    expect(parseCampaign({ id: 't', missions: [entry('a')] }, known(['a'])).replayKeepsLoadout).toBe(true);
    expect(parseCampaign({ id: 't', replayKeepsLoadout: false, missions: [entry('a')] }, known(['a'])).replayKeepsLoadout).toBe(false);
    expect(() => parseCampaign({ id: 't', replayKeepsLoadout: 'no', missions: [entry('a')] }, known(['a']))).toThrow(/replayKeepsLoadout/);
    expect(() => parseCampaign({ id: 't', missions: [entry('a'), entry('a')] }, ok)).toThrow(/listed twice/);
    expect(() => parseCampaign({ id: 't', missions: [entry('a', { title: ' ' })] }, ok)).toThrow(/title/);
    expect(() => parseCampaign({ id: 't', missions: [entry('a', { briefing: [] })] }, ok)).toThrow(/briefing/);
    expect(() => parseCampaign({ id: 't', missions: [entry('a', { debrief: [''] })] }, ok)).toThrow(/debrief/);
    expect(() => parseCampaign({ id: 't', missions: [entry('a', { luck: 1 })] }, ok)).toThrow(/luck/);
    expect(() => parseCampaign({ id: 't', missions: [] }, ok)).toThrow(/non-empty/);
    expect(() => parseCampaign({ id: '', missions: [entry('a')] }, ok)).toThrow(/campaign\.id/);
    expect(() => parseCampaign({ id: 't', extra: 1, missions: [entry('a')] }, ok)).toThrow(/extra/);
  });
});

describe('what the leader may choose (U-088)', () => {
  it('a new campaign offers the first mission and nothing to replay', () => {
    expect(newestMission([], three)).toBe('a');
    expect(runOptions([], three)).toEqual({ campaign: 'a', replay: [] });
  });

  it('after a completion the next mission is the campaign run and the beaten ones can be replayed', () => {
    expect(runOptions(['a'], three)).toEqual({ campaign: 'b', replay: ['a'] });
    expect(runOptions(['a', 'b'], three)).toEqual({ campaign: 'c', replay: ['a', 'b'] });
  });

  it('after a failure the newest mission is still the same one: a retry or a replay, never skipping ahead', () => {
    // Failing `b` leaves the completed set as it was.
    expect(runOptions(['a'], three).campaign).toBe('b');
    expect(isOffered('campaign', 'b', ['a'], three)).toBe(true);
    expect(isOffered('campaign', 'c', ['a'], three)).toBe(false);
    expect(isOffered('replay', 'a', ['a'], three)).toBe(true);
    expect(isOffered('replay', 'b', ['a'], three)).toBe(false);
  });

  it('a finished season has no campaign run, only replays', () => {
    expect(newestMission(['a', 'b', 'c'], three)).toBeNull();
    expect(runOptions(['a', 'b', 'c'], three)).toEqual({ campaign: null, replay: ['a', 'b', 'c'] });
    expect(isOffered('campaign', 'c', ['a', 'b', 'c'], three)).toBe(false);
  });

  it('ignores completed missions that are not in the campaign, and keeps play order', () => {
    expect(beatenMissions(['greybox-01', 'b', 'a'], three)).toEqual(['a', 'b']);
    expect(newestMission(['greybox-01', 'b'], three)).toBe('a');
  });

  it('adding a mission is one data entry: nothing else changes', () => {
    const two = parseCampaign({ id: 't', missions: [entry('a'), entry('b')] }, known(['a', 'b', 'c']));
    const grown = parseCampaign({ id: 't', missions: [entry('a'), entry('b'), entry('c')] }, known(['a', 'b', 'c']));
    expect(runOptions(['a', 'b'], two).campaign).toBeNull();
    expect(runOptions(['a', 'b'], grown).campaign).toBe('c');
    expect(campaignMission('c', grown)?.briefing).toEqual(['Brief c']);
  });
});
