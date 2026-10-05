import { describe, expect, it } from 'vitest';
import { loadWorld, parseEncounter, parseMission, requireWorld, TICK_SECONDS, createMoveState } from '@sandline/shared';
import { Session } from './Session.ts';
import { Spawner, type SpawnerHost } from '../ai/director/spawner.ts';

const world = loadWorld({
  id: 'stacked-area-test', floor: { halfExtent: 40 },
  cover: [{ id: 'roof', x: 0, y: 5.5, z: 10, w: 20, d: 20, h: 2.5 }],
  mission: {
    ...requireWorld('greybox-01').mission!,
    spawnZones: [
      { id: 'lower', on: 'objective', x: 0, y: 0, z: 10, radius: .1 },
      { id: 'upper', on: 'objective', x: 0, y: 8, z: 10, radius: .1 },
      { id: 'reserve', on: 'objective', x: 25, y: 0, z: 25, radius: 1 },
    ],
  },
});
const upper = { x: 0, z: 10, radius: 3, minY: 7.5, maxY: 8.5 };
const groups = [
  { id: 'lower', zone: 'lower', trigger: { kind: 'start' } },
  { id: 'upper', zone: 'upper', trigger: { kind: 'start' } },
  { id: 'entry', zone: 'reserve', trigger: { kind: 'enter', area: 'upper' } },
].map((g) => ({ ...g, members: [{ archetype: 'rifleman', count: 1 }], posture: { kind: 'hold' }, fixedCount: true }));
const encounter = parseEncounter({ world: world.id, aliveCap: 10, probes: [.3, 1, 1.7], areas: { upper }, groups }, () => world);
const mission = parseMission({ id: world.id, world: world.id, respawn: false, objectives: [{ type: 'reach', label: 'Reach upper floor', who: 'any', area: 'upper' }] });

describe('stacked-floor authoring on a real Session (U-108)', () => {
  it('spawns at the same x/z on both supported floors and does not credit entry from underneath', () => {
    const session = new Session(undefined, '', world, { encounter, mission, testHumanCount: 0 });
    session.step(TICK_SECONDS * 1000);
    const lowerId = session.spawner!.spawnedBy('lower')[0]!;
    const upperId = session.spawner!.spawnedBy('upper')[0]!;
    const lower = session.enemies.find((e) => e.netId === lowerId)!;
    const above = session.enemies.find((e) => e.netId === upperId)!;
    expect(lower.state.y).toBeCloseTo(0);
    expect(above.state.y).toBeCloseTo(8);
    expect(lower.state.x).toBeCloseTo(above.state.x);
    expect(lower.state.z).toBeCloseTo(above.state.z);
    session.slots[0]!.state = createMoveState(0, 0, 10);
    session.step(2 * TICK_SECONDS * 1000);
    expect(session.mission!.state).toBe('progress');
    expect(session.spawner!.spawnedBy('entry')).toHaveLength(0);
    session.slots[0]!.state = createMoveState(0, 8, 10);
    session.step(3 * TICK_SECONDS * 1000);
    expect(session.mission!.state).toBe('complete');
    expect(session.spawner!.spawnedBy('entry')).toHaveLength(1);
  });

  it('requires the escorted POW on the extraction floor as well as all six soldiers', () => {
    const escortEncounter = parseEncounter({
      world: world.id, aliveCap: 10, probes: [.3, 1, 1.7], areas: { upper },
      groups: [{ id: 'pow', zone: 'reserve', members: [{ archetype: 'pow', count: 1 }], captive: true, posture: { kind: 'hold' }, trigger: { kind: 'start' }, fixedCount: true }],
    }, () => world);
    const extraction = parseMission({ id: world.id, world: world.id, respawn: false, objectives: [{ type: 'reach', label: 'Extract', who: 'all', escort: true, area: upper }] });
    const session = new Session(undefined, '', world, { encounter: escortEncounter, mission: extraction, testHumanCount: 0 });
    session.step(TICK_SECONDS * 1000);
    for (const [i, slot] of session.slots.entries()) slot.state = createMoveState(-2 + i * .8, 8, 10);
    const pow = session.enemies.find((e) => e.def.friendly)!;
    pow.captive = false;
    pow.state = createMoveState(0, 0, 12);
    session.step(2 * TICK_SECONDS * 1000);
    expect(session.mission!.state).toBe('progress');
    pow.state = createMoveState(0, 8, 12);
    session.step(3 * TICK_SECONDS * 1000);
    expect(session.mission!.state).toBe('complete');
  });

  it('fails a named authored spawn zone with no supporting floor rather than spawning on a roof', () => {
    const invalid = { ...world, mission: { ...world.mission!, spawnZones: world.mission!.spawnZones.map((z) => z.id === 'lower' ? { ...z, y: 4 } : z) } };
    expect(() => new Session(undefined, '', invalid, { encounter, mission, testHumanCount: 0 })).toThrow(/spawn zone 'lower'.*y=4/);
  });

  it('distinguishes floors in direct encounter triggers as well as Session event translation', () => {
    const feet = { x: 0, y: 0, z: 10 };
    let nextId = 100;
    const host: SpawnerHost = { humanEyes: () => [], squadFeet: () => [feet], enemyFeet: () => [], isAlive: () => true, spawn: () => nextId++ };
    const spawner = new Spawner(encounter, world, host);
    spawner.step(0);
    expect(spawner.spawnedBy('entry')).toHaveLength(0);
    feet.y = 8;
    spawner.step(1);
    expect(spawner.spawnedBy('entry')).toHaveLength(1);
  });
});
