import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, SQUAD, TICK_SECONDS, blockedAt, buildTree, characterSpace, createHealth,
  createMoveState, keepCharacterSpace, stepCharacter, supportUnder, type MoveState, type SquadSpread,
} from '@sandline/shared';
import { Brain, createBrainRegistry } from '../../../server/src/ai/Brain.ts';
import { Formation } from '../../../server/src/ai/friendly/formation.ts';
import { within } from '../../../server/src/ai/floor.ts';
import { NavMesh, completePathLength, initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { PathFollower, yawToward } from '../../../server/src/ai/locomotion/followPath.ts';
import { bakeRoadSupportNav } from './qalatRoadNav.ts';
import { buildRoadSupportWorld } from './qalatRoadSupports.ts';
import { inConvex, rectPolygon, type Point, type Polygon } from './planStrata.ts';
import { convexHull, ribbonPieces } from './roadSightLines.ts';

// Independent §6.3 transcription: do not derive required travel from authoring.
type Node = { id: string; x: number; y: number; z: number };
const CROSSINGS = [
  { id: 'C12-L', spine: [
    { id: 'A2', x: 12, y: 8, z: 128 }, { id: 'L1', x: 28, y: 8, z: 134 },
    { id: 'L2', x: 40, y: 12, z: 140 }, { id: 'L3', x: 54, y: 16, z: 140 },
    { id: 'R2', x: 64, y: 20, z: 128 },
  ], afterRoad: { id: 'A3', x: -37, y: 8, z: 142 }, afterRidge: { id: 'R3', x: 80, y: 26, z: 168 } },
  { id: 'C12-U', spine: [
    { id: 'A5', x: 26, y: 8, z: 232 }, { id: 'U1', x: 40, y: 8, z: 218 },
    { id: 'U2', x: 62, y: 14, z: 216 }, { id: 'U3', x: 78, y: 20, z: 224 },
    { id: 'U4', x: 66, y: 24, z: 244 }, { id: 'R5', x: 86, y: 30, z: 248 },
  ], afterRoad: { id: 'A6', x: 30, y: 8, z: 270 }, afterRidge: { id: 'R6', x: 72, y: 26, z: 286 } },
] satisfies { id: string; spine: Node[]; afterRoad: Node; afterRidge: Node }[];
const footprint = (spine: Node[]) => [...ribbonPieces(spine, 4), ...spine.slice(1, -1).map((n) =>
  rectPolygon({ minX: n.x - 2, maxX: n.x + 2, minZ: n.z - 2, maxZ: n.z + 2 }))];
const grown = (poly: Polygon, margin: number) => convexHull(poly.flatMap((p) => [-margin, margin].flatMap((x) =>
  [-margin, margin].map((z) => ({ x: p.x + x, z: p.z + z })))));
const grownPolys = new WeakMap<Polygon, Map<number, Polygon>>();
const contains = (polys: readonly Polygon[], p: Point, margin = .06) => polys.some((poly) => {
  let margins = grownPolys.get(poly);
  if (!margins) grownPolys.set(poly, margins = new Map());
  let expanded = margins.get(margin);
  if (!expanded) margins.set(margin, expanded = grown(poly, margin));
  return inConvex(expanded, p);
});
const world = buildRoadSupportWorld();
// The complete static scene is kept; cache a generous broadphase window only
// for controller collision queries. No box within a tick's possible reach is omitted.
const windows = new Map<string, typeof world.boxes>();
const nearby = (p: Point) => {
  const x = Math.floor(p.x / 4) * 4, z = Math.floor(p.z / 4) * 4, key = `${x}/${z}`;
  let boxes = windows.get(key);
  if (!boxes) {
    boxes = world.boxes.filter((b) => b.maxX >= x - 8 && b.minX <= x + 12 && b.maxZ >= z - 8 && b.minZ <= z + 12);
    windows.set(key, boxes);
  }
  return boxes;
};
const yieldWorker = () => new Promise<void>((resolve) => setImmediate(resolve));
let nav: NavMesh;

function assertOrdinaryStep(before: MoveState, after: MoveState, label: string): void {
  expect(after.vault, label).toBeNull();
  expect(Math.abs(after.y - before.y), `${label}: dropped or snapped to a roof`).toBeLessThan(.3);
  expect(blockedAt(after.x, after.z, DEFAULT_MOVE_CONFIG.radius, after.y, .05,
    DEFAULT_MOVE_CONFIG.height, nearby(after)), `${label}: standing inside rock`).toBe(false);
}

describe('U-168 both reversible road–ridge stairs on the actual standing nav and controller', () => {
  beforeAll(async () => {
    await initNav();
    nav = NavMesh.load(await bakeRoadSupportNav(world));
  }, 240_000);
  afterAll(() => nav?.destroy());

  it('projects the exact crossing nodes onto supported floors without synthetic links', () => {
    expect(nav.links()).toEqual([]);
    for (const c of CROSSINGS) for (const [i, node] of c.spine.entries()) {
      const point = nav.nearestPoint(node)?.point;
      expect(point, `${c.id}/${node.id}`).toBeDefined();
      // An interior pad's detail triangles may borrow a flight's first tread
      // at a sharp turn (U4); half a riser still names the pad's own storey.
      const interior = i > 0 && i < c.spine.length - 1;
      expect(Math.abs(point!.y - node.y), `${c.id}/${node.id}`).toBeLessThanOrEqual(interior ? .1 : .05002);
      expect(supportUnder(node.x, node.z, DEFAULT_MOVE_CONFIG.radius, node.y + .3, nearby(node), 0)).toBeCloseTo(node.y, 6);
      expect(blockedAt(node.x, node.z, DEFAULT_MOVE_CONFIG.radius, node.y, .05, DEFAULT_MOVE_CONFIG.height, nearby(node))).toBe(false);
    }
  });

  for (const c of CROSSINGS) for (const outward of [true, false])
    it(`${c.id} walks every landing ${outward ? 'road → ridge' : 'ridge → road'} without vaults or drops`, async () => {
      const stops = outward ? c.spine : [...c.spine].reverse(), allowed = footprint(c.spine);
      let state = { ...createMoveState(stops[0]!.x, stops[0]!.y, stops[0]!.z), grounded: true };
      const follower = new PathFollower(nav, world.boxes);
      let ticks = 0;
      for (const [i, goal] of stops.slice(1).entries()) {
        const from = stops[i]!, path = nav.path(state, goal);
        expect(completePathLength(path, state, goal), `${c.id}/${from.id}→${goal.id}`).not.toBeNull();
        expect(path!.vaults).toEqual([]);
        let arrived = false;
        for (let tick = 0; tick < 1200; tick++) {
          const { input, status } = follower.step(state, { goal, pace: 'walk' }, 0);
          if (status === 'arrived') { arrived = true; break; }
          const before = state;
          state = stepCharacter(state, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, nearby(state));
          assertOrdinaryStep(before, state, `${c.id}/${from.id}→${goal.id}`);
          expect(contains(allowed, state), `${c.id} left its listed spine: ${JSON.stringify(state)}`).toBe(true);
          expect(state.y).toBeGreaterThanOrEqual(Math.min(from.y, goal.y) - .05);
          expect(state.y).toBeLessThanOrEqual(Math.max(from.y, goal.y) + .05);
          if (++ticks % 256 === 0) await yieldWorker();
        }
        expect(arrived, `${c.id} stalled toward ${goal.id} at ${JSON.stringify(state)}`).toBe(true);
        expect(Math.abs(state.y - goal.y)).toBeLessThan(.05);
      }
      console.log(`U-168 ${c.id} ${outward ? 'up' : 'down'} controller`, JSON.stringify({ ticks, seconds: ticks * TICK_SECONDS }));
    }, 90_000);

  // Movement-only GEO-03 fixture: no combat, damage or rescue timing. The
  // production Formation places all five followers at the requested spread;
  // the actual escort Brain follows the nearest living squad member. Every
  // body then uses PathFollower, stepCharacter and session body separation.
  for (const c of CROSSINGS) for (const outward of [true, false]) for (const spread of ['tight', 'standard', 'wide'] satisfies SquadSpread[])
    it(`${c.id} carries six soldiers and the POW ${outward ? 'road → ridge' : 'ridge → road'} at ${spread}`, async () => {
      const spine = outward ? c.spine : [...c.spine].reverse(), start = spine[0]!, endpoint = spine.at(-1)!;
      const after = outward ? c.afterRidge : c.afterRoad, route = [...spine.slice(1), after];
      const dx = spine[1]!.x - start.x, dz = spine[1]!.z - start.z, length = Math.hypot(dx, dz), ux = dx / length, uz = dz / length;
      const initialYaw = yawToward(dx, dz);
      const actors = Array.from({ length: 7 }, (_, index) => {
        const side = index === 0 ? 0 : index % 2 ? -.8 : .8, back = index === 0 ? 0 : Math.ceil(index / 2) * .8;
        const x = start.x + uz * side - ux * back, z = start.z - ux * side - uz * back;
        const y = supportUnder(x, z, DEFAULT_MOVE_CONFIG.radius, start.y + .3, nearby({ x, z }), 0);
        const state = { ...createMoveState(x, y, z), grounded: true };
        expect(Math.abs(y - start.y), `initial actor ${index} floor`).toBeLessThan(.05);
        expect(blockedAt(x, z, DEFAULT_MOVE_CONFIG.radius, y, .05, DEFAULT_MOVE_CONFIG.height, nearby(state))).toBe(false);
        return { index, netId: index + 1, state, yaw: initialYaw, speed: 0, follower: new PathFollower(nav, world.boxes) };
      });
      const formation = new Formation((p) => nav.nearestPoint(p)?.point ?? null);
      const pow = actors[6]!;
      const escortBody = {
        netId: pow.netId, get state() { return pow.state; }, get yaw() { return pow.yaw; }, health: createHealth(),
        escort: { order: () => ({ kind: 'follow' as const, point: null }), nearestSquad: () =>
          [...actors.slice(0, 6)].sort((a, b) => Math.hypot(a.state.x - pow.state.x, a.state.y - pow.state.y, a.state.z - pow.state.z) -
            Math.hypot(b.state.x - pow.state.x, b.state.y - pow.state.y, b.state.z - pow.state.z))[0]!.state },
      };
      const escort = new Brain(escortBody, buildTree('escort', createBrainRegistry()));
      // Followers start on the legal road apron or ridge lane and fall in up
      // to 1.5 × 12 m behind the lead; no other road–ridge route lies within
      // 20 m of either crossing's ends, and `visited` proves each stair leg.
      const allowed = [...footprint(c.spine), ...ribbonPieces([endpoint, after], outward ? 8 : 12),
        rectPolygon({ minX: start.x - 20, maxX: start.x + 20, minZ: start.z - 20, maxZ: start.z + 20 }),
        rectPolygon({ minX: after.x - 6, maxX: after.x + 6, minZ: after.z - 6, maxZ: after.z + 6 })];
      const dest = ribbonPieces([endpoint, after], outward ? 8 : 12);
      const visited = actors.map(() => new Set<number>()), spreads = new Set<number>();
      let leg = 0, ticks = 0, allAcross = false;
      for (; ticks < 3600; ticks++) {
        const leader = actors[0]!;
        if (leg < route.length && within(leader.state, route[leg]!, .6)) leg++;
        formation.update(actors.slice(0, 6).map((a) => ({ ...a.state, index: a.index, human: a.index === 0,
          yaw: a.yaw, speed: a.speed, sprint: false, spread })));
        if (escort.due(ticks)) escort.think(ticks);
        const intents = actors.map((a) => {
          if (a.index === 0) return leg < route.length ? { goal: route[leg]!, pace: 'walk' as const } : null;
          if (a.index === 6) return escort.intent;
          const place = formation.place(a.index);
          if (place) { expect(place.offset).toEqual(SQUAD.formations.wedge![place.rank]!.map((v) => v * SQUAD.spreadScales[spread])); spreads.add(a.index); }
          return place?.intent ?? null;
        });
        for (const a of actors) {
          const intent = intents[a.index], input = intent ? a.follower.step(a.state, intent, a.yaw).input :
            { moveX: 0, moveY: 0, yaw: a.yaw, sprint: false, jump: false, crouch: false, prone: false };
          const before = a.state, boxes = nearby(before);
          a.state = keepCharacterSpace(before, stepCharacter(before, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, boxes),
            actors.filter((other) => other !== a).map((other) => characterSpace(other.state, DEFAULT_MOVE_CONFIG, false, other.netId)),
            DEFAULT_MOVE_CONFIG, boxes, a.netId);
          a.yaw = input.yaw; a.speed = Math.hypot(a.state.x - before.x, a.state.z - before.z) / TICK_SECONDS;
          assertOrdinaryStep(before, a.state, `${c.id}/${spread}/actor${a.index}`);
          expect(contains(allowed, a.state, .1), `${c.id}/${spread}/actor${a.index} left its legal corridor at ${JSON.stringify(a.state)}`).toBe(true);
          // Every actor must actually pass every interior stair leg, rather
          // than reaching a final floor through D0 or the other crossing.
          for (let i = 0; i < spine.length - 1; i++) {
            const from = spine[i]!, to = spine[i + 1]!, dx = to.x - from.x, dz = to.z - from.z, len2 = dx * dx + dz * dz;
            const t = ((a.state.x - from.x) * dx + (a.state.z - from.z) * dz) / len2;
            if (t > .25 && t < .75 && Math.hypot(a.state.x - from.x - t * dx, a.state.z - from.z - t * dz) <= 2.1 &&
                a.state.y >= Math.min(from.y, to.y) - .05 && a.state.y <= Math.max(from.y, to.y) + .05) visited[a.index]!.add(i);
          }
        }
        allAcross = leg === route.length && actors.every((a) => visited[a.index]!.size === spine.length - 1 && contains(dest, a.state, .1));
        if (allAcross) break;
        if (ticks % 128 === 0) await yieldWorker();
      }
      expect(spreads).toEqual(new Set([1, 2, 3, 4, 5]));
      expect(allAcross, `${c.id}/${spread} stranded group after ${ticks} ticks: ${JSON.stringify(actors.map((a) => ({ actor: a.index, state: a.state, visited: [...visited[a.index]!] })))}`).toBe(true);
      console.log(`U-168 ${c.id} ${outward ? 'up' : 'down'} ${spread} seven bodies`, JSON.stringify({ ticks, seconds: ticks * TICK_SECONDS, legsPerActor: visited.map((v) => v.size) }));
    }, 120_000);
});
