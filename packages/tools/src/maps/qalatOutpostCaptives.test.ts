import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { boxFrom, missionFor, placePrisoners } from '@sandline/shared';
import source from './qalat-outpost-mission.json' with { type: 'json' };
import { buildOutpostWorld, outpostManifest } from './qalatOutpost.ts';
import { buildOutpostCaptiveFixture } from './qalatOutpostCaptives.ts';

const world = buildOutpostWorld();
const fixture = buildOutpostCaptiveFixture(world);
const expected = [[12, 8, 400], [20, 8, 400], [12, 8, 404], [20, 8, 404], [12, 8, 408]];

describe('U-225 replacement-only six-captive declaration', () => {
  it('validates all six standing bodies on the actual composed floor, independently of pool occupancy', () => {
    expect(fixture.pow).toEqual({ id: 'mission-pow', feet: { x: 16, y: 8, z: 402 } });
    expect(fixture.mission.prisonerHoldings.map(({ id, feet }) => [id, feet.x, feet.y, feet.z]))
      .toEqual(expected.map((p, i) => [`carry-${i + 1}`, ...p]));
    expect(missionFor(world.id)).toBeUndefined();
    expect(missionFor('qalat-road')?.prisonerHoldings).toBeUndefined();
  });

  it('maps every possible zero-to-five captured-slot subset deterministically without moving the original POW', () => {
    let subsets = 0;
    for (let mask = 0; mask < 63; mask++) {
      const slots = Array.from({ length: 6 }, (_, i) => i).filter((i) => mask & (1 << i));
      const placements = placePrisoners([...slots].reverse(), fixture.mission.prisonerHoldings)!;
      expect(placements).toEqual(slots.map((slot, i) => ({ slot, at: fixture.mission.prisonerHoldings[i]!.feet })));
      expect(placePrisoners(slots, fixture.mission.prisonerHoldings)).toEqual(placements);
      expect(new Set([fixture.pow.feet, ...placements.map((p) => p.at)].map((p) => JSON.stringify(p))).size).toBe(slots.length + 1);
      if (placements.length) placements[0]!.at.x = -100;
      expect(fixture.pow.feet).toEqual({ x: 16, y: 8, z: 402 });
      expect(fixture.mission.prisonerHoldings[0]!.feet.x).toBe(12);
      subsets++;
    }
    expect(subsets).toBe(63);
    expect(placePrisoners([0, 1, 2, 3, 4, 5], fixture.mission.prisonerHoldings)).toBeNull();
  });

  it('fails closed on missing, insufficient, malformed, duplicate and wrong-world declarations', () => {
    const { prisonerHoldings: holdings, ...without } = source;
    for (const raw of [without, { ...source, prisonerHoldings: holdings.slice(0, 4) },
      { ...source, prisonerHoldings: [] }, { ...source, prisonerHoldings: [holdings[0], ...holdings.slice(0, 4)] },
      { ...source, prisonerHoldings: [{ id: 'bad', feet: { x: 12, z: 400 } }, ...holdings.slice(1)] },
      { ...source, world: 'qalat-road' }]) expect(() => buildOutpostCaptiveFixture(world, raw)).toThrow();
    expect(() => buildOutpostCaptiveFixture({ ...world, id: 'qalat-road' })).toThrow(/wrong composed world/);
  });

  it('refuses unsupported, obstructed, wrong-floor and overlapping placements in the composed scene', () => {
    for (const feet of [{ x: 12, y: 9, z: 400 }, { x: 12, y: 0, z: 400 },
      { x: 10, y: 8, z: 400 }, { x: 20, y: 8, z: 400 }, { x: 16, y: 8, z: 402 }]) {
      expect(() => buildOutpostCaptiveFixture(world, { ...source,
        prisonerHoldings: [{ ...source.prisonerHoldings[0], feet }, ...source.prisonerHoldings.slice(1)] })).toThrow(/prisoner holding/);
    }
    const roof = boxFrom({ id: 'bad-headroom', x: 12, y: 9.5, z: 400, w: 2, h: 1, d: 2 }, 'cover');
    expect(() => buildOutpostCaptiveFixture({ ...world, boxes: [...world.boxes, roof] })).toThrow(/obstructed/);
    const noFloor = { ...world, boxes: world.boxes.filter((b) => !(b.maxY <= 8 && b.maxX >= 11 && b.minX <= 13 && b.maxZ >= 399 && b.minZ <= 401)) };
    expect(() => buildOutpostCaptiveFixture(noFloor)).toThrow(/unsupported/);
  });

  it('keeps the generated declaration and evidence bound to the current composed geometry', async () => {
    const generated = JSON.parse(await readFile(new URL('../../../../artifacts/qalat-outpost/captives.json', import.meta.url), 'utf8'));
    const mission = JSON.parse(await readFile(new URL('../../../../artifacts/qalat-outpost/mission.json', import.meta.url), 'utf8'));
    expect(mission).toEqual(fixture.mission);
    expect(generated).toMatchObject({ isolated: true, capacity: 6, pow: fixture.pow,
      prisonerHoldings: fixture.mission.prisonerHoldings, levelHash: outpostManifest().levelHash,
      missionHash: createHash('sha256').update(JSON.stringify(mission)).digest('hex') });
  });
});
