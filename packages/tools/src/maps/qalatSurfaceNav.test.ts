import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Detour, importNavMesh, type NavMesh as DetourMesh } from '@recast-navigation/core';
import {
  DEFAULT_MOVE_CONFIG, TICK_SECONDS, blockedAt, createMoveState, stepCharacter, supportUnder, type MoveState,
} from '@sandline/shared';
import {
  NavMesh, completePathLength, initNav, type NavBlockerBox, type NavPoint, type NavPolygon,
} from '../../../server/src/ai/nav/NavMesh.ts';
import { PathFollower } from '../../../server/src/ai/locomotion/followPath.ts';
import { bakeRoadSupportNav } from './qalatRoadNav.ts';
import { buildRoadSupportWorld } from './qalatRoadSupports.ts';
import { inConvex, rectPolygon, type Polygon } from './planStrata.ts';
import { convexHull, ribbonPieces } from './roadSightLines.ts';

// Independent §§3.1/4.1/5.1/6.1 transcription. The outpost and basement
// remain future construction: these are the actual capped gate approaches,
// not a claim that the isolated build already contains either continuation.
type Node = NavPoint & { id: string };
const INSERTION: Node[] = [
  { id: 'S0', x: 0, y: 8, z: -6 }, { id: 'S1', x: -12, y: 8, z: 18 },
  { id: 'S2', x: -12, y: 8, z: 36 }, { id: 'S3', x: 12, y: 8, z: 44 },
  { id: 'S3a', x: 48, y: 8, z: 46.75 }, { id: 'D0', x: 32, y: 8, z: 64 },
];
const ROAD: Node[] = [
  { id: 'A1', x: 32, y: 8, z: 98 }, { id: 'A2', x: 12, y: 8, z: 128 },
  { id: 'A3', x: -37, y: 8, z: 142 }, { id: 'A4', x: -28, y: 8, z: 210 },
  { id: 'A5', x: 26, y: 8, z: 232 }, { id: 'A6', x: 30, y: 8, z: 270 },
  { id: 'A7', x: -18, y: 8, z: 302 }, { id: 'A8', x: 16, y: 8, z: 332 },
  { id: 'A9', x: 32, y: 8, z: 350 }, { id: 'south-gate', x: 32, y: 8, z: 356 },
];
const RIDGE: Node[] = [
  { id: 'R0', x: 62, y: 8, z: 68 }, { id: 'R1', x: 78, y: 14, z: 96 },
  { id: 'R2', x: 64, y: 20, z: 128 }, { id: 'R3', x: 80, y: 26, z: 168 },
  { id: 'R4', x: 94, y: 30, z: 210 }, { id: 'R5', x: 86, y: 30, z: 248 },
  { id: 'R6', x: 72, y: 26, z: 286 }, { id: 'R7', x: 70, y: 20, z: 322 },
  { id: 'R7b', x: 70, y: 16, z: 336 }, { id: 'R8', x: 70, y: 12, z: 350 },
  { id: 'R9', x: 56, y: 8, z: 370 }, { id: 'east-gate-approach', x: 56, y: 8, z: 373.4 },
];
const D0 = INSERTION.at(-1)!;
const CROSSING_SPINES = [
  [{ x: 12, z: 128 }, { x: 28, z: 134 }, { x: 40, z: 140 }, { x: 54, z: 140 }, { x: 64, z: 128 }],
  [{ x: 26, z: 232 }, { x: 40, z: 218 }, { x: 62, z: 216 }, { x: 78, z: 224 }, { x: 66, z: 244 }, { x: 86, z: 248 }],
];
const rect = (x0: number, x1: number, z0: number, z1: number) =>
  rectPolygon({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 });
const pocket = rect(-20, 18, -24, 12), court = rect(20, 44, 53, 75);
const insertionFloors = [pocket, court, ...ribbonPieces(INSERTION, 8)];
const junctionFloors = [[court, ...ribbonPieces([D0, RIDGE[0]!], 8)], ...CROSSING_SPINES.map((spine) => [
  ...ribbonPieces(spine, 4), ...spine.slice(1, -1).map((p) => rect(p.x - 2, p.x + 2, p.z - 2, p.z + 2)),
])];
const roadFloors = [...ribbonPieces([D0, ...ROAD], 20), ...ROAD.slice(0, 8).map((n) =>
  Array.from({ length: 64 }, (_, k) => ({ x: n.x + 18.01 * Math.cos(k * Math.PI / 32), z: n.z + 18.01 * Math.sin(k * Math.PI / 32) })))];
const ridgeFloors = [...ribbonPieces([D0, ...RIDGE], 8),
  ...[[72, 84, 90, 102], [58, 70, 122, 134], [74, 86, 158, 182], [88, 100, 204, 216],
    [80, 92, 242, 254], [66, 78, 280, 292], [66, 74, 320, 322], [66, 74, 330, 342],
    [66, 74, 348, 352], [52, 60, 368, 374]].map(([x0, x1, z0, z1]) => rect(x0!, x1!, z0!, z1!)),
  // U-165's bounded full-width R6 furnishing bevel, on its existing y26 rest.
  ...ribbonPieces([{ x: 75.86842105263158, z: 275.5 }, { x: 71.5, z: 281.9 },
    { x: 71.5, z: 290 }, { x: 71.5, z: 295 }], 8),
];
const expanded = new WeakMap<Polygon, Polygon>();
function contains(floors: readonly Polygon[], p: NavPoint): boolean {
  return floors.some((poly) => {
    let grown = expanded.get(poly);
    if (!grown) {
      grown = convexHull(poly.flatMap((v) => [-.06, .06].flatMap((dx) => [-.06, .06].map((dz) => ({ x: v.x + dx, z: v.z + dz })))));
      expanded.set(poly, grown);
    }
    return inConvex(grown, p);
  });
}

// Remove the real junction edges, not a hand-authored abstract road graph.
// Narrow cuts retain both approach floors; restoring each independently must
// recover the crossing, which prevents an overbroad cut from proving isolation.
const JUNCTIONS: { id: string; built: boolean; cuts: NavBlockerBox[] }[] = [
  { id: 'D0', built: true, cuts: [{ minX: 50, maxX: 52, minY: 8, maxY: 38, minZ: 56, maxZ: 76 }] },
  { id: 'C12-L', built: true, cuts: [{ minX: 32, maxX: 34, minY: 8, maxY: 38, minZ: 132, maxZ: 142 }] },
  { id: 'C12-U', built: true, cuts: [{ minX: 38, maxX: 42, minY: 8, maxY: 38, minZ: 214, maxZ: 222 }] },
  { id: 'outpost-hub', built: false, cuts: [
    { minX: 20, maxX: 44, minY: 8, maxY: 38, minZ: 356.4, maxZ: 358 },
    { minX: 52, maxX: 60, minY: 8, maxY: 38, minZ: 374, maxZ: 376 },
  ] },
];
function overlaps(p: NavPolygon, b: NavBlockerBox): boolean {
  return Math.max(...p.corners.map((v) => v.x)) > b.minX && Math.min(...p.corners.map((v) => v.x)) < b.maxX &&
    Math.max(...p.corners.map((v) => v.z)) > b.minZ && Math.min(...p.corners.map((v) => v.z)) < b.maxZ &&
    Math.max(...p.corners.map((v) => v.y)) + DEFAULT_MOVE_CONFIG.height > b.minY! &&
    Math.min(...p.corners.map((v) => v.y)) < b.maxY!;
}
const world = buildRoadSupportWorld();
const windows = new Map<string, typeof world.boxes>();
const nearby = (p: NavPoint) => {
  const x = Math.floor(p.x / 4) * 4, z = Math.floor(p.z / 4) * 4, key = `${x}/${z}`;
  let boxes = windows.get(key);
  if (!boxes) {
    boxes = world.boxes.filter((b) => b.maxX >= x - 8 && b.minX <= x + 12 && b.maxZ >= z - 8 && b.minZ <= z + 12);
    windows.set(key, boxes);
  }
  return boxes;
};
const yieldWorker = () => new Promise<void>((resolve) => setImmediate(resolve));
let nav: NavMesh, mesh: DetourMesh;
let graph: Map<number, Set<number>>;
const portals = new Map<number, { to: number; point: NavPoint }[]>();

function reachable(start: number, removed: ReadonlySet<number>): Set<number> {
  const seen = new Set<number>();
  const todo = removed.has(start) ? [] : [start];
  for (let i = 0; i < todo.length; i++) {
    const ref = todo[i]!;
    if (seen.has(ref)) continue;
    seen.add(ref);
    for (const next of graph.get(ref)!) if (!seen.has(next) && !removed.has(next)) todo.push(next);
  }
  return seen;
}
function regionSequence(points: readonly NavPoint[], nodes: readonly Node[]): string[] {
  // Project onto the independent spine, then partition its arclength halfway
  // between nodes. Euclidean nearest-node regions incorrectly assign the
  // S3→S3a leg to the nearby D0 court on the far side of its enclosing fold.
  const lengths = nodes.slice(1).map((b, i) => Math.hypot(b.x - nodes[i]!.x, b.y - nodes[i]!.y, b.z - nodes[i]!.z));
  const stations = [0];
  for (const length of lengths) stations.push(stations.at(-1)! + length);
  const boundaries = stations.slice(1).map((s, i) => (s + stations[i]!) / 2);
  const compressed: string[] = [];
  let previous = 0;
  for (const p of points) {
    const nearest = nodes.slice(1).map((b, i) => {
      const a = nodes[i]!, dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / lengths[i]! ** 2));
      return { distance: Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy, p.z - a.z - t * dz),
        station: stations[i]! + t * lengths[i]! };
    }).sort((a, b) => a.distance - b.distance)[0]!;
    const found = boundaries.findIndex((s) => nearest.station < s), index = found === -1 ? nodes.length - 1 : found;
    const node = nodes[index]!;
    expect(Math.abs(index - previous), `skipped a route region at ${JSON.stringify(p)}`).toBeLessThanOrEqual(1);
    previous = index;
    if (compressed.at(-1) !== node.id) compressed.push(node.id);
  }
  return compressed;
}

describe('U-169 GEO-02/04 integrated surface route regions and exact legal crossings', () => {
  beforeAll(async () => {
    await initNav();
    const bytes = await bakeRoadSupportNav(world);
    nav = NavMesh.load(bytes);
    mesh = importNavMesh(bytes).navMesh;
    graph = new Map(nav.polygons().map((p) => [p.ref, new Set<number>()]));
    const polygons = new Map(nav.polygons().map((p) => [p.ref, p]));
    // Read Detour's actual directed polygon links, including tiled seams.
    // Matching drawn edges or querying a few endpoint paths would miss links.
    for (const ref of graph.keys()) {
      const { tile, poly } = mesh.getTileAndPolyByRefUnsafe(ref);
      for (let index = poly.firstLink(); index !== Detour.DT_NULL_LINK;) {
        const link = tile.links(index), next = link.ref();
        if (graph.has(next)) {
          graph.get(ref)!.add(next);
          const corners = polygons.get(ref)!.corners, a = corners[link.edge()]!, b = corners[(link.edge() + 1) % corners.length]!;
          const t = link.side() === 255 ? .5 : (link.bmin() + link.bmax()) / 510;
          const point = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) };
          const edges = portals.get(ref) ?? [];
          edges.push({ to: next, point }); portals.set(ref, edges);
        }
        index = link.next();
      }
    }
  }, 240_000);
  afterAll(() => { nav?.destroy(); mesh?.destroy(); });

  it('disconnects the actual road/ridge graph with only registered hubs/links removed, retaining each approach', () => {
    expect(nav.links()).toEqual([]);
    const junctionRefs = JUNCTIONS.map((j) => new Set(nav.polygons().filter((p) => j.cuts.some((b) => overlaps(p, b))).map((p) => p.ref)));
    const removed = new Set(junctionRefs.flatMap((refs) => [...refs]));
    const roadRefs = ROAD.map((n) => nav.nearestPoint(n)!.polyRef);
    const ridgeRefs = RIDGE.map((n) => nav.nearestPoint(n)!.polyRef);
    const road = reachable(roadRefs[0]!, removed), ridge = reachable(ridgeRefs[0]!, removed);
    expect(road.size).toBeGreaterThan(100);
    expect(ridge.size).toBeGreaterThan(100);
    for (const ref of roadRefs) expect(road.has(ref), `removed a road approach polygon ${ref}`).toBe(true);
    for (const ref of ridgeRefs) expect(ridge.has(ref), `removed a ridge approach polygon ${ref}`).toBe(true);
    expect([...road].some((ref) => ridge.has(ref))).toBe(false);

    // Enumerate every live adjacency at both sides of each cut. A crossing
    // counts only when its removed polygons really connect the two approach
    // components. This compares actual graph boundaries to §3.1's register.
    const crossings = JUNCTIONS.flatMap((j, i) => {
      const refs = junctionRefs[i]!, boundary = [...refs].flatMap((ref) => [...graph.get(ref)!]);
      const rejoins = reachable(roadRefs[0]!, new Set([...removed].filter((r) => !refs.has(r)))).has(ridgeRefs[0]!);
      if (!rejoins) return [];
      expect(j.built, `${j.id} unexpectedly became a live crossing`).toBe(true);
      expect(boundary.some((ref) => road.has(ref)), `${j.id} missing road boundary`).toBe(true);
      expect(boundary.some((ref) => ridge.has(ref)), `${j.id} missing ridge boundary`).toBe(true);
      // The ridge-facing live portals are the actual route-change boundary.
      // On the road side an overlapping removed polygon can also expose an
      // ordinary apron/court edge, far from where the crossing begins.
      const crossingPortals = [...refs].flatMap((ref) => portals.get(ref) ?? []).filter((edge) => ridge.has(edge.to));
      expect(crossingPortals.length, `${j.id} has no actual ridge-facing portal`).toBeGreaterThan(0);
      for (const edge of crossingPortals)
        expect(contains(junctionFloors[i]!, edge.point), `${j.id} boundary portal outside its independent legal floor: ${JSON.stringify(edge.point)}`).toBe(true);
      return [j.id];
    });
    expect(crossings).toEqual(['D0', 'C12-L', 'C12-U']);
    console.log('U-169 actual surface crossing register', JSON.stringify({ polygons: graph.size, road: road.size, ridge: ridge.size,
      crossings, outpost: 'unbuilt and capped; no live convergence', basement: 'unbuilt; interfaces retained for U-115' }));
  });

  it('fails every cross-approach path when sealed, then restores only each legal built crossing as a positive control', () => {
    for (const j of JUNCTIONS) nav.setBlocker(j.id, j.cuts, true);
    try {
      for (const a of ROAD) for (const b of RIDGE) for (const [from, to] of [[a, b], [b, a]])
        expect(completePathLength(nav.path(from!, to!), from!, to!), `${a.id}↔${b.id} bypasses registered junctions`).toBeNull();
      for (const nodes of [ROAD, RIDGE]) for (const [from, to] of [[nodes[0]!, nodes.at(-1)!], [nodes.at(-1)!, nodes[0]!]])
        expect(completePathLength(nav.path(from!, to!), from!, to!), 'cut removed approach continuity').not.toBeNull();
      for (const j of JUNCTIONS) {
        nav.setBlocker(j.id, j.cuts, false);
        const from = ROAD[1]!, to = RIDGE[4]!;
        for (const [a, b] of [[from, to], [to, from]]) {
          const length = completePathLength(nav.path(a!, b!), a!, b!);
          if (j.built) expect(length, `restoring ${j.id} did not recover its real crossing`).not.toBeNull();
          else expect(length, 'unbuilt outpost became a live hub').toBeNull();
        }
        nav.setBlocker(j.id, j.cuts, true);
      }
    } finally { for (const j of JUNCTIONS) nav.setBlocker(j.id, j.cuts, false); }
  });

  for (const route of [
    { id: 'road/south gate', nodes: [...INSERTION, ...ROAD], floors: [...insertionFloors, ...roadFloors] },
    { id: 'ridge/east gate approach', nodes: [...INSERTION, ...RIDGE], floors: [...insertionFloors, ...ridgeFloors] },
  ]) for (const outward of [true, false])
    it(`traverses S0↔${route.id} ${outward ? 'outward' : 'return'} with the exact nav/controller region sequence`, async () => {
      const nodes = outward ? route.nodes : [...route.nodes].reverse();
      let state: MoveState = { ...createMoveState(nodes[0]!.x, nodes[0]!.y, nodes[0]!.z), grounded: true };
      const follower = new PathFollower(nav, world.boxes), controller: NavPoint[] = [state], navPoints: NavPoint[] = [state];
      const goal = nodes.at(-1)!, ridge = route.id.startsWith('ridge');
      const floors = world.boxes.filter((b) => b.id === 'insertion-foundation' || (ridge
        ? /^ridge-(floor|slab|bridge-deck)/.test(b.id) : b.id.startsWith('road-support-')));
      // Select the pure approach by removing only its optional intermediate
      // exits. Every actual waypoint must emerge from one final destination
      // command; no forced intermediate goals can manufacture the sequence.
      for (const j of JUNCTIONS.filter((j) => j.id.startsWith('C12-'))) nav.setBlocker(j.id, j.cuts, true);
      let ticks = 0, arrived = false;
      try {
        const path = nav.path(state, goal);
        expect(completePathLength(path, state, goal), `${nodes[0]!.id}→${goal.id}`).not.toBeNull();
        expect(path!.vaults).toEqual([]);
        const byRef = new Map(nav.polygons().map((p) => [p.ref, p]));
        const centres = path!.corridor.map((ref) => byRef.get(ref)!.centre);
        for (const centre of centres) expect(contains(route.floors, centre), `nav left ${route.id} at ${JSON.stringify(centre)}`).toBe(true);
        // Sample the real string-pulled path at ≤0.25 m. Corridor polygons
        // can span a whole court: their off-path centres do not describe the
        // order in which the actual path enters that court's route regions.
        for (const [i, to] of path!.points.slice(1).entries()) {
          const from = path!.points[i]!, steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) / .25);
          for (let k = 1; k <= steps; k++) {
            const t = k / steps, p = { x: from.x + t * (to.x - from.x), y: from.y + t * (to.y - from.y), z: from.z + t * (to.z - from.z) };
            expect(contains(route.floors, p), `nav path left ${route.id} at ${JSON.stringify(p)}`).toBe(true);
            navPoints.push(p);
          }
        }
        for (; ticks < 6000; ticks++) {
          const { input, status } = follower.step(state, { goal, pace: 'walk' }, 0);
          if (status === 'arrived') { arrived = true; break; }
          const before = state;
          state = stepCharacter(state, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, nearby(state));
          expect(state.vault).toBeNull();
          expect(Math.abs(state.y - before.y), `${route.id}: drop or roof snap`).toBeLessThanOrEqual(DEFAULT_MOVE_CONFIG.stepHeight);
          const support = supportUnder(state.x, state.z, DEFAULT_MOVE_CONFIG.radius, 31, floors, 0);
          // Ordinary descending risers can leave the body briefly airborne;
          // the floor remains within one step, never another approach storey.
          expect(state.y - support, `${route.id}: dropped off its storey at ${JSON.stringify(state)}`).toBeLessThanOrEqual(DEFAULT_MOVE_CONFIG.stepHeight);
          expect(state.y - support).toBeGreaterThanOrEqual(-.000001);
          expect(blockedAt(state.x, state.z, DEFAULT_MOVE_CONFIG.radius, state.y, DEFAULT_MOVE_CONFIG.stepHeight,
            DEFAULT_MOVE_CONFIG.height, nearby(state))).toBe(false);
          expect(contains(route.floors, state), `${route.id} left its listed lane at ${JSON.stringify(state)}`).toBe(true);
          controller.push(state);
          if (ticks % 256 === 0) await yieldWorker();
        }
        expect(arrived, `${route.id} stalled toward ${goal.id}: ${JSON.stringify(state)}`).toBe(true);
      } finally { for (const j of JUNCTIONS.filter((j) => j.id.startsWith('C12-'))) nav.setBlocker(j.id, j.cuts, false); }
      const expected = nodes.map((n) => n.id);
      // Check every compressed transition above; adjacent seam reversals may
      // repeat a region, but first entries must follow the complete register.
      const navRegions = regionSequence(navPoints, nodes), controllerRegions = regionSequence(controller, nodes);
      expect([...new Set(navRegions)], 'actual sampled nav path region order').toEqual(expected);
      expect([...new Set(controllerRegions)], 'actual controller region order').toEqual(expected);
      console.log(`U-169 ${route.id} ${outward ? 'outward' : 'return'}`, JSON.stringify({ ticks, navRegions, controllerRegions }));
    }, 120_000);
});
