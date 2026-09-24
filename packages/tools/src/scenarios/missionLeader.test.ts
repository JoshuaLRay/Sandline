import { beforeAll, describe, expect, it } from 'vitest';
import { type Encounter, type MissionDef, type ObjectiveDef, TICK_SECONDS, buildTree, encounterFor, requireWorld } from '@sandline/shared';
import { Session } from '../../../server/src/session/Session.ts';
import { createBrainRegistry } from '../../../server/src/ai/Brain.ts';
import { initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { loadWorldNavMesh } from '../../../server/src/ai/nav/bakedNav.ts';
import { MISSION_SCENARIO } from './mission.ts';
import { createMissionLeader } from './missionLeader.ts';

const world = requireWorld('greybox-01');
const encounter = encounterFor(world.id)!;
beforeAll(async () => { await initNav(); });

function fixture(objectives: ObjectiveDef[], fight: Encounter = { ...encounter, groups: [] }) {
  const def: MissionDef = { id: 'leader-test', world: world.id, respawn: false, objectives };
  const session = new Session(undefined, '', world, {
    navMesh: loadWorldNavMesh(world.id), brainTree: buildTree('friendly', createBrainRegistry()), encounter: fight, mission: def, testHumanCount: 6,
  });
  const lead = createMissionLeader(session, def, fight, world, MISSION_SCENARIO);
  const step = () => {
    if (session.tick % 15 === 0) lead();
    session.step((session.tick + 1) * TICK_SECONDS * 1000);
  };
  return { session, lead, step };
}

describe('objective-aware scripted leader (T-4.17)', () => {
  it('walks reach objectives in order, then holds, defends and survives on a real session', () => {
    const a = { x: 0, z: -14, radius: 3 };
    const b = { x: 10, z: -14, radius: 3 };
    const f = fixture([
      { type: 'reach', label: 'first', area: a, who: 'all' },
      { type: 'reach', label: 'second', area: b, who: 'any' },
      { type: 'clear-and-hold', label: 'hold', area: b, holdSeconds: 1 },
      { type: 'defend', label: 'defend', area: b, seconds: 1, breachSeconds: 0.5 },
      { type: 'survive', label: 'survive', seconds: 1 },
    ]);
    expect(f.session.orderFor(0)).toMatchObject({ order: 'hold', point: { x: a.x, y: 0, z: a.z } });
    const seen = new Set<number>();
    for (let t = 0; t < 30 * 60 && f.session.mission!.state === 'progress'; t++) {
      seen.add(f.session.mission!.objective);
      f.step();
    }
    expect([...seen]).toEqual([0, 1, 2, 3, 4]);
    expect(f.session.mission!.state).toBe('complete');
    expect(f.session.orderFor(0)!.point!.z).toBeLessThan(0); // Never sent to the map's compound.
  });

  it('targets the named destroy group and retargets when its first member dies', () => {
    const f = fixture([{ type: 'destroy', label: 'patrol', group: 'overwatch-patrol' }], encounter);
    f.step();
    f.lead();
    const ids = f.session.spawner!.spawnedBy('overwatch-patrol');
    expect(ids.length).toBeGreaterThan(1);
    const target = f.session.orderFor(0)!.target!;
    expect(ids).toContain(target);
    expect(f.session.orderFor(0)!.order).toBe('attack');
    const enemy = f.session.enemies.find((e) => e.netId === target)!;
    enemy.health.current = 0;
    enemy.health.diedAt = 0;
    f.lead();
    expect(f.session.orderFor(0)!.target).not.toBe(target);
    expect(ids).toContain(f.session.orderFor(0)!.target);
  });

  it('uses an enter trigger and a prerequisite group to find an unspawned destroy target', () => {
    const enter = fixture([{ type: 'destroy', label: 'ambush', group: 'assault-hold' }], encounter);
    expect(enter.session.orderFor(0)).toMatchObject({ order: 'hold', point: { x: 22, y: 0, z: 12 } });
    const prerequisite = fixture([{ type: 'destroy', label: 'waves', group: 'counterattack' }], encounter);
    prerequisite.step();
    prerequisite.lead();
    expect(prerequisite.session.spawner!.spawnedBy('garrison')).toContain(prerequisite.session.orderFor(0)!.target);
  });
});
