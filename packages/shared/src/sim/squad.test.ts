import { describe, expect, it } from 'vitest';
import RAW_SQUAD from '../data/squad.json' with { type: 'json' };
import { SQUAD, fireteamOf, formationBand, parseSquadConfig } from './squad.ts';

describe('the squad (T-3.25)', () => {
  it('puts every slot in exactly one fireteam, and knows which', () => {
    expect([0, 1, 2, 3, 4, 5].map((s) => fireteamOf(s))).toEqual([0, 0, 0, 1, 1, 1]);
    expect(() => fireteamOf(6)).toThrow(/slot 6/);
    for (const t of SQUAD.fireteams) expect(SQUAD.formations[t.formation]!.length).toBeGreaterThanOrEqual(5);
  });

  it('loosens the band the further back a place is', () => {
    expect(formationBand([0, 3])).toBeCloseTo(SQUAD.bandM + SQUAD.bandPerM * 3);
    expect(formationBand([0, 12])).toBeGreaterThan(formationBand([-3, 3]));
  });

  it('refuses a slot twice, a slot missing, a place on the lead, and an unknown key', () => {
    const teams = (a: number[], b: number[]) => ({ ...RAW_SQUAD, fireteams: [{ slots: a, formation: 'wedge' }, { slots: b, formation: 'file' }] });
    expect(() => parseSquadConfig(teams([0, 1, 2], [2, 3, 4, 5]))).toThrow(/two fireteams/);
    expect(() => parseSquadConfig(teams([0, 1], [3, 4, 5]))).toThrow(/every one/);
    expect(() => parseSquadConfig(teams([0, 1, 2], [3, 4, 9]))).toThrow(/not a slot/);
    expect(() => parseSquadConfig({ ...RAW_SQUAD, formations: { ...RAW_SQUAD.formations, file: [[0, 0.5], [0, 3], [0, 6], [0, 9], [0, 12]] } })).toThrow(/within 1 m/);
    expect(() => parseSquadConfig({ ...RAW_SQUAD, closeUpScale: 0 })).toThrow(/closeUpScale/);
    expect(() => parseSquadConfig({ ...RAW_SQUAD, colour: 'green' })).toThrow(/colour/);
  });
});
