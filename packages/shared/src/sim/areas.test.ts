import { describe, expect, it } from 'vitest';
import { areaContains } from './areas.ts';
import { loadMission, requireWorld } from './world.ts';
import { parseEncounter } from './encounters.ts';
import { parseMission } from './mission.ts';
import { parseEventScript } from './events.ts';

const world = requireWorld('greybox-01');
const circle = { x: 0, z: 10, radius: 2 };
const bounded = { ...circle, minY: 7.5, maxY: 8.5 };
const rawEncounter = {
  world: world.id, aliveCap: 10, probes: [.3, 1, 1.7], areas: {},
  groups: [{ id: 'g', members: [{ archetype: 'rifleman', count: 1 }], zone: world.mission!.spawnZones[0]!.id, posture: { kind: 'hold' }, trigger: { kind: 'start' } }],
};
const encounter = parseEncounter(rawEncounter);
const parsers = {
  world: (area: unknown) => loadMission(world.id, { ...world.mission!, start: area }).start,
  encounter: (area: unknown) => parseEncounter({ ...rawEncounter, areas: { upper: area } }).areas['upper'],
  mission: (area: unknown) => parseMission({ id: world.id, world: world.id, respawn: false, objectives: [{ type: 'reach', label: 'Reach upper floor', who: 'any', area }] }).objectives[0],
  script: (area: unknown) => parseEventScript({ world: world.id, blockers: [], events: [{ id: 'upper', trigger: { kind: 'enter', area }, actions: [{ kind: 'message', text: 'upper only' }] }] }, encounter, world, null).events[0]!.trigger,
};

describe('height-bounded areas (U-108)', () => {
  it('distinguishes floors, includes boundaries and rejects a missing/nonfinite actor height', () => {
    expect(areaContains(bounded, { x: 0, y: 0, z: 10 })).toBe(false);
    for (const y of [7.5, 8, 8.5]) expect(areaContains(bounded, { x: 2, y, z: 10 })).toBe(true);
    for (const y of [7.49, 8.51, NaN, Infinity]) expect(areaContains(bounded, { x: 0, y, z: 10 })).toBe(false);
    expect(areaContains(bounded, { x: 0, z: 10 })).toBe(false);
    expect(areaContains(bounded, { x: 2.01, y: 8, z: 10 })).toBe(false);
  });
  it('keeps legacy circles independent of storey, including old 2D callers', () => {
    for (const feet of [{ x: 0, z: 10 }, { x: 0, y: 0, z: 10 }, { x: 0, y: 30, z: 10 }]) expect(areaContains(circle, feet)).toBe(true);
    expect(areaContains(circle, { x: NaN, y: 8, z: 10 })).toBe(false);
  });
  for (const [name, parse] of Object.entries(parsers)) {
    it(`${name}: retains bounds and rejects malformed or misspelled heights`, () => {
      expect(JSON.stringify(parse(bounded))).toContain('"minY":7.5');
      expect(JSON.stringify(parse(bounded))).toContain('"maxY":8.5');
      expect(JSON.stringify(parse(circle))).not.toContain('minY');
      for (const bad of [{ minY: 0 }, { maxY: 8 }, { minY: 9, maxY: 8 }, { minY: NaN, maxY: 8 }, { minY: 0, maxY: Infinity }, { minY: '0', maxY: 8 }]) {
        expect(() => parse({ ...circle, ...bad })).toThrow(/minY.*maxY/);
      }
      expect(() => parse({ ...bounded, minimumY: 7 })).toThrow(/unknown key/);
      expect(() => parse({ ...circle, minY: 0, maxY: 0 })).not.toThrow();
    });
  }
  it('preserves explicit zero-height spawn floors and rejects invalid floor authoring', () => {
    const zone = { ...world.mission!.spawnZones[0]!, y: 0, minY: 0, maxY: .5 };
    const parse = (z: unknown) => loadMission(world.id, { ...world.mission!, spawnZones: [z] }).spawnZones[0];
    expect(parse(zone)).toMatchObject({ y: 0, minY: 0, maxY: .5 });
    expect(() => parse({ ...zone, y: 8 })).toThrow(/within minY and maxY/);
    expect(() => parse({ ...zone, y: NaN })).toThrow(/finite number/);
    expect(() => parse({ ...zone, floor: 0 })).toThrow(/unknown key/);
  });
});
