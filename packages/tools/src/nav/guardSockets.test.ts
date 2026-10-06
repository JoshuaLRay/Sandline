import { expect, it } from 'vitest';
import { loadWorld, requireWorld, parseEncounter, parseMission, parseEventScript, TICK_SECONDS } from '@sandline/shared';
import { Session } from '../../../server/src/session/Session.ts';
import { NavMesh, initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { bakeWorld } from './bake.ts';

it('real baked nav validates three stacked sockets without moving their authored feet (U-129)', async () => {
  const world = loadWorld({ id: 'baked-guard-sockets', floor: { halfExtent: 20 }, cover: [
    { id: 'slab', x: 0, y: 5.5, z: 0, w: 16, d: 16, h: 2.5 },
    { id: 'bridge', x: 0, y: 14, z: 0, w: 12, d: 12, h: 2 },
  ], mission: { ...requireWorld('greybox-01').mission!, spawnZones: [{ id: 'z', on: 'objective', x: 16, z: 16, radius: .1 }] } });
  const sockets = [0, 8, 16].map((y) => ({ id: `floor-${y}`, archetype: 'rifleman', feet: { x: 0, y, z: 0 }, face: { x: 0, z: -5 } }));
  const encounter = parseEncounter({ world: world.id, aliveCap: 3, probes: [1], areas: {}, groups: [{ id: 'g', zone: 'z', members: [{ archetype: 'rifleman', count: 3 }], sockets, posture: { kind: 'hold' }, trigger: { kind: 'start' } }] }, () => world);
  const mission = parseMission({ id: world.id, world: world.id, respawn: false, objectives: [{ type: 'survive', label: 'Wait', seconds: 3600 }] });
  const events = parseEventScript({ world: world.id, blockers: [], events: [{ id: 'start', trigger: { kind: 'time', seconds: 0 }, actions: [{ kind: 'spawn-group', group: 'g' }] }] }, encounter, world, mission);
  await initNav();
  const mesh = NavMesh.load(await bakeWorld(world));
  try {
    const session = new Session(undefined, '', world, { encounter, mission, events, navMesh: mesh, testHumanCount: 1 });
    session.step(TICK_SECONDS * 1000);
    for (const s of sockets) {
      const e = session.enemies.find((e) => e.spawnId === s.id)!;
      expect(e.posture!.post).toEqual(s.feet);
      expect(e.state.x).toBeCloseTo(0, 4); expect(e.state.z).toBeCloseTo(0, 4);
      expect(e.state.y).toBeCloseTo(s.feet.y, 4);
    }
    const bad = { ...encounter, groups: [{ ...encounter.groups[0]!, sockets: [{ ...sockets[0]!, feet: { x: 19.9, y: 0, z: 19.9 } }, ...sockets.slice(1)] }] };
    expect(() => new Session(undefined, '', world, { encounter: bad, mission, events, navMesh: mesh })).toThrow(/navigable standing socket/);
  } finally { mesh.destroy(); }
});
