import { describe, expect, it } from 'vitest';
import { checkPrisonerHoldings, parsePrisonerHoldings, placePrisoners } from './prisonerHoldings.ts';
import { loadWorld } from './world.ts';
import { parseMission } from './mission.ts';

const holding = (x = 0, y = 8, z = 0, id = 'carry-1') => ({ id, feet: { x, y, z } });
const world = loadWorld({ id: 'holdings-test', floor: { halfExtent: 30 },
  cover: [{ id: 'deck', x: 0, y: 6, z: 0, w: 40, d: 40, h: 2 }] });
const mission = (prisonerHoldings?: unknown) => ({ id: 'holdings-test', world: world.id, respawn: false,
  ...(prisonerHoldings === undefined ? {} : { prisonerHoldings }),
  objectives: [{ type: 'survive', seconds: 30, label: 'Wait' }] });

describe('authored carried-prisoner holdings (U-224)', () => {
  it('parses optional mission holdings without changing existing mission data', () => {
    expect(parseMission(mission()).prisonerHoldings).toBeUndefined();
    expect(parseMission(mission([holding()])).prisonerHoldings).toEqual([holding()]);
    const raw = [holding()];
    const parsed = parsePrisonerHoldings(raw);
    raw[0]!.feet.x = 9;
    expect(parsed[0]!.feet.x).toBe(0);
  });

  it.each([null, {}, [], Array.from({ length: 6 }, (_, i) => holding(i, 8, 0, `carry-${i}`)),
    [holding(), holding(4)], [{ ...holding(), extra: 1 }], [{ feet: holding().feet }],
    [{ ...holding(), id: 'invalid id' }], [{ ...holding(), feet: null }],
    [{ ...holding(), feet: { x: 0, y: 8 } }], [{ ...holding(), feet: { x: 0, y: 8, z: 0, extra: 1 } }],
    [holding(Number.NaN)], [holding(Infinity)], [holding(-513)], [holding(512)],
  ].map((raw) => ({ raw })))('refuses malformed or unrepresentable content %#', ({ raw }) => {
    expect(() => parseMission(mission(raw))).toThrow(/prisonerHoldings/);
  });

  it('maps ascending slot indices to author order and never mutates the pool or holdings', () => {
    const slots = [5, 1, 3];
    const holds = [holding(8), holding(-8, 8, 0, 'carry-2'), holding(0, 8, 8, 'carry-3')];
    const placed = placePrisoners(slots, holds)!;
    expect(placed).toEqual([{ slot: 1, at: holds[0]!.feet }, { slot: 3, at: holds[1]!.feet }, { slot: 5, at: holds[2]!.feet }]);
    expect(placePrisoners([3, 5, 1], holds)).toEqual(placed);
    placed[0]!.at.x = 20;
    expect(holds[0]!.feet.x).toBe(8);
    expect(slots).toEqual([5, 1, 3]);
    expect(placePrisoners([], [])).toEqual([]);
    expect(placePrisoners([0], [])).toBeNull();
    expect(placePrisoners([0, 1], [holding()])).toBeNull();
  });

  it.each([[0, 0], [-1], [6], [.5], [Number.NaN]].map((slots) => ({ slots })))('refuses invalid squad membership $slots', ({ slots }) => {
    expect(() => placePrisoners(slots, [holding()])).toThrow(/unique squad indices/);
  });

  it('requires the exact supported standing floor and separated bodies', () => {
    expect(() => checkPrisonerHoldings([holding()], world)).not.toThrow();
    expect(() => checkPrisonerHoldings([holding(0, 7)], world)).toThrow(/unsupported, obstructed/);
    expect(() => checkPrisonerHoldings([holding(0, 9)], world)).toThrow(/unsupported, obstructed/);
    expect(() => checkPrisonerHoldings([holding(29.9, 0)], world)).toThrow(/outside/);
    expect(() => checkPrisonerHoldings([holding(), holding(.5, 8, 0, 'carry-2')], world)).toThrow(/overlaps/);
    const roof = loadWorld({ id: 'roof', cover: [
      { id: 'floor', x: 0, y: 6, z: 0, w: 40, d: 40, h: 2 },
      { id: 'ceiling', x: 0, y: 9.7, z: 0, w: 4, d: 4, h: 1 },
    ] });
    expect(() => checkPrisonerHoldings([holding()], roof)).toThrow(/obstructed/);
  });
});
