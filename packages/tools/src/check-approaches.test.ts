import { beforeAll, describe, expect, it } from 'vitest';
import { buildTree, loadWorld, requireWorld } from '@sandline/shared';
import { NavMesh, completePathLength, initNav } from '../../server/src/ai/nav/NavMesh.ts';
import { loadWorldNavMesh } from '../../server/src/ai/nav/bakedNav.ts';
import { createBrainRegistry } from '../../server/src/ai/Brain.ts';
import { Session } from '../../server/src/session/Session.ts';
import { bakeNavMesh, bakeWorld, boxSoup, spikeConfig } from './nav/bake.ts';
import { approachGraphSchema } from './maps/approachGraph.ts';
import { approachGraphFile, checkApproachGraph, readApproachGraph } from './check-approaches.ts';

const qalat = readApproachGraph(approachGraphFile('qalat-road'));
beforeAll(initNav);

describe('U-219 declared approach graphs', () => {
  it('validates both map records without claiming navigation for unbuilt Kestrel', () => {
    expect(qalat.approaches.map((a) => a.id)).toEqual(['riverbed', 'road', 'terraces']);
    const kestrel = readApproachGraph(approachGraphFile('kestrel-dam'));
    expect(kestrel.connections.filter((c) => c.kind === 'crossing').map((c) => c.id)).toEqual(['C12-P', 'C12-S']);
    expect(kestrel.separations).toHaveLength(3);
  });

  it('rejects malformed topology instead of silently skipping declarations', () => {
    for (const mutate of [
      (g: typeof qalat) => { g.approaches.push(g.approaches[0]!); },
      (g: typeof qalat) => { g.connections.push(g.connections[0]!); },
      (g: typeof qalat) => { g.separations.push(['road', 'missing']); },
      (g: typeof qalat) => { g.separations.push(['road', 'road']); },
      (g: typeof qalat) => { g.separations.push(['road', 'riverbed']); },
      (g: typeof qalat) => { g.approaches[0]!.probes = []; },
      (g: typeof qalat) => { g.connections[0]!.endpoints[0]!.approach = 'missing'; },
      (g: typeof qalat) => { g.connections[0]!.cuts[0]!.maxY = -100; },
      (g: typeof qalat) => { g.approaches[0]!.waypoints[0]!.y = NaN; },
    ]) {
      const graph = structuredClone(qalat); mutate(graph);
      expect(approachGraphSchema.safeParse(graph).success).toBe(false);
    }
    expect(approachGraphSchema.safeParse({ ...qalat, separation: [] }).success).toBe(false);
  });

  it('passes all three Qalat separations and leaves the mesh usable after checking', () => {
    const nav = loadWorldNavMesh(qalat.world);
    try {
      expect(checkApproachGraph(qalat, nav)).toEqual([]);
      expect(checkApproachGraph(qalat, nav)).toEqual([]);
      const c = qalat.connections[2]!, a = c.endpoints[0]!.point, b = c.endpoints[1]!.point;
      expect(completePathLength(nav.path(a, b), a, b)).not.toBeNull();
    } finally { nav.destroy(); }
  });

  it('fails a real Qalat bake with a seeded undeclared shortcut through the river/road barrier', async () => {
    const world = requireWorld(qalat.world), wall = world.boxes.find((b) => b.id === 'flank-inner-3')!;
    const nav = NavMesh.load(await bakeWorld({ ...world, boxes: [
      ...world.boxes.filter((b) => b !== wall),
      { ...wall, id: 'seed-wall-south', maxZ: 66 }, { ...wall, id: 'seed-wall-north', minZ: 70 },
    ] }));
    try {
      expect(checkApproachGraph(qalat, nav)).toContain('riverbed/road: undeclared adjacency with all registered connections closed');
    } finally { nav.destroy(); }
  }, 30_000);

  it('detects a missing crossing even though the start and objective hubs offer a detour', () => {
    const nav = loadWorldNavMesh(qalat.world), c = qalat.connections[2]!;
    try {
      nav.setBlocker('fixture/missing-crossing', c.cuts, true);
      const a = c.endpoints[0]!.point, b = c.endpoints[1]!.point;
      expect(completePathLength(nav.path(a, b), a, b)).not.toBeNull();
      expect(checkApproachGraph(qalat, nav).some((s) => s.startsWith('C12-S: declared crossing missing'))).toBe(true);
      nav.setBlocker('fixture/missing-crossing', c.cuts, false);
      expect(checkApproachGraph(qalat, nav)).toEqual([]);
    } finally { nav.destroy(); }
  });

  it('rejects wrong-floor stops and cuts that delete an approach to manufacture isolation', () => {
    const nav = loadWorldNavMesh(qalat.world), graph = structuredClone(qalat);
    try {
      graph.approaches[0]!.waypoints[2]!.y += 20;
      expect(checkApproachGraph(graph, nav).some((s) => s.startsWith('riverbed: incomplete'))).toBe(true);
      const broad = structuredClone(qalat);
      Object.assign(broad.connections[2]!.cuts[0]!, { minX: -46, maxX: 42, minZ: 40, maxZ: 160 });
      expect(checkApproachGraph(broad, nav).some((s) => s.includes('cut removes approach waypoint'))).toBe(true);
    } finally { nav.destroy(); }
  });

  it('finds a one-way off-mesh shortcut even when a bounded path query cannot return it', async () => {
    const a = { x: -4, y: 0, z: 0 }, b = { x: 4, y: 0, z: 0 };
    const nav = NavMesh.load(await bakeNavMesh(boxSoup(10, [{ min: [-1, 0, -10], max: [1, 3, 10] }]), {
      ...spikeConfig(), offMeshConnections: [{ startPosition: a, endPosition: b, radius: .5, bidirectional: false }],
    }));
    try {
      expect(nav.connected(a, b)).toBe(true);
      expect(nav.connected(b, a)).toBe(false);
      expect(nav.connected(a, { ...b, y: 8 })).toBe(false);
      nav.setBlocker('fixture', [{ minX: 1, maxX: 10, minZ: -10, maxZ: 10 }], true);
      expect(nav.connected(a, b)).toBe(false);
      nav.setBlocker('fixture', [], false);
      expect(nav.connected(a, b)).toBe(true);
      const graph = { world: 'one-way', stage: 'drop', connections: [], separations: [['right', 'left']],
        approaches: [['left', -4], ['right', 4]].map(([id, x]) => {
          const probes = [{ x: Number(x), y: 0, z: -4 }, { x: Number(x), y: 0, z: 4 }];
          return { id, probes, waypoints: probes };
        }) };
      const issues = checkApproachGraph(graph, {
        path: (from, to) => from.x * to.x < 0 ? null : nav.path(from, to),
        connected: (from, to) => nav.connected(from, to), setBlocker: () => {},
      });
      expect(issues).toContain('right/left: undeclared adjacency with all registered connections closed');
    } finally { nav.destroy(); }
  });

  it('rejects a two-way crossing declared as a one-way drop', () => {
    const nav = loadWorldNavMesh(qalat.world), graph = structuredClone(qalat);
    try {
      graph.connections[2]!.direction = 'forward';
      expect(checkApproachGraph(graph, nav)).toContain('C12-S: undeclared reverse direction');
    } finally { nav.destroy(); }
  });

  it('permits four braided approaches that share and recross open ground with no separations', async () => {
    const world = loadWorld({ id: 'braided', floor: { halfExtent: 20 }, cover: [] });
    const nav = NavMesh.load(await bakeWorld(world));
    try {
      const graph = { world: world.id, stage: 'courtyard', separations: [], connections: [{
        id: 'shared-court', kind: 'convergence', direction: 'both', endpoints: [
          { approach: 'braid-0', point: { x: -2, y: 0, z: -1 } }, { approach: 'braid-1', point: { x: 2, y: 0, z: 1 } },
        ], cuts: [{ minX: -.3, maxX: .3, minY: -1, maxY: 2, minZ: -.3, maxZ: .3 }],
      }],
        approaches: [-12, -4, 4, 12].map((x, i) => ({ id: `braid-${i}`, waypoints: [
          { x: 0, y: 0, z: -15 }, { x, y: 0, z: -5 }, { x: -x, y: 0, z: 5 }, { x: 0, y: 0, z: 15 },
        ] })) };
      let isolationQueries = 0;
      expect(checkApproachGraph(graph, {
        path: (a, b) => nav.path(a, b), setBlocker: (id, boxes, active) => nav.setBlocker(id, boxes, active),
        connected: (a, b) => { isolationQueries++; return nav.connected(a, b); },
      })).toEqual([]);
      expect(isolationQueries).toBe(0);
    } finally { nav.destroy(); }
  });

  for (const a of qalat.approaches) for (const reverse of [false, true])
    it(`walks an actual escorted POW along ${a.id} ${reverse ? 'return' : 'outward'}`, () => {
      const nav = loadWorldNavMesh(qalat.world), world = requireWorld(qalat.world);
      const stops = reverse ? [...a.waypoints].reverse() : a.waypoints;
      // Idle squad stays at extraction; only the real escort brain/follower
      // receives go orders. Existing Qalat tests exercise the friendly bot.
      const session = new Session(undefined, '', { ...world, id: 'approach-traversal' }, {
        navMesh: nav, testHumanCount: 0, brainTree: buildTree('idle', createBrainRegistry()),
      });
      try {
        expect(session.spawnEnemy('pow', { ...stops[0]!, authoredHeight: true })).not.toBeNull();
        const pow = session.enemies[0]!;
        for (const goal of stops.slice(1)) {
          session.orderFrom(0, { order: 'move', address: { to: 'all' }, point: goal, target: null });
          let arrived = false;
          for (let tick = 0; tick < 2400; tick++) {
            session.step((session.tick + 1) * 1000 / 30);
            const p = pow.state;
            if (Math.hypot(p.x - goal.x, p.z - goal.z) < 1.6 && Math.abs(p.y - goal.y) < .45) {
              arrived = true; break;
            }
          }
          expect(arrived, `${a.id}: stranded at ${JSON.stringify(pow.state)} toward ${JSON.stringify(goal)}`).toBe(true);
        }
      } finally { session.close(); nav.destroy(); }
    }, 15_000);
});
