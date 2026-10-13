import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, TICK_SECONDS, blockedAt, createMoveState, stepCharacter, supportUnder, type WorldBox,
} from '@sandline/shared';
import { NavMesh, completePathLength, initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { PathFollower } from '../../../server/src/ai/locomotion/followPath.ts';
import { INSERTION, onInsertionFloor } from './qalatInsertion.ts';
import { bakeRoadSupportNav } from './qalatRoadNav.ts';
import { buildRoadSupportWorld } from './qalatRoadSupports.ts';

import { inConvex } from './planStrata.ts';
import { convexHull, ribbonPieces } from './roadSightLines.ts';

type Point = { x: number; z: number };
// Independent §6.1 transcription; the D0 court is the ridge's only mouth.
const D0: { id: string; x: number; y: number; z: number } = { id: 'D0', x: 32, y: 8, z: 64 };
type Node = { id: string; x: number; y: number; z: number };
const NODES: Node[] = ([['R0', 62, 8, 68], ['R1', 78, 14, 96], ['R2', 64, 20, 128], ['R3', 80, 26, 168],
  ['R4', 94, 30, 210], ['R5', 86, 30, 248], ['R6', 72, 26, 286], ['R7', 70, 20, 322],
  ['R7b', 70, 16, 336], ['R8', 70, 12, 350], ['R9', 56, 8, 370]] as const)
  .map(([id, x, y, z]) => ({ id, x, y, z }));
const LANDINGS = [[72, 84, 90, 102], [58, 70, 122, 134], [74, 86, 158, 182], [88, 100, 204, 216],
  [80, 92, 242, 254], [66, 78, 280, 292], [66, 74, 320, 322], [66, 74, 330, 342],
  [66, 74, 348, 352], [52, 60, 368, 374]].map(([minX, maxX, minZ, maxZ]) => ({ minX: minX!, maxX: maxX!, minZ: minZ!, maxZ: maxZ! }));
const X0 = { x: 96, y: 8, z: 444 }, A1 = { x: 32, y: 8, z: 98 }, A8 = { x: 16, y: 8, z: 332 };
const ROAD_UNDER_BRIDGE = [{ x: 84, y: 8, z: 338 }, { x: 70, y: 8, z: 336 },
  { x: 70, y: 8, z: 349 }, { x: 54, y: 8, z: 334 }];
const segments = NODES.slice(1).map((b, i) => {
  const a = NODES[i]!, length = Math.hypot(b.x - a.x, b.z - a.z);
  return { a, b, length, u: { x: (b.x - a.x) / length, z: (b.z - a.z) / length } };
});
// Independent local R6 clearance bevel; exact stairs/nodes remain unchanged.
const APRON = ribbonPieces([{ x: 75.86842105263158, z: 275.5 }, { x: 71.5, z: 281.9 },
  { x: 71.5, z: 290 }, { x: 71.5, z: 295 }], 8).filter((poly) => poly.length >= 3);
const inApron = (p: Point, margin: number) => APRON.some((poly) => margin < 0
  ? [-margin, margin].flatMap((dx) => [-margin, margin].map((dz) => ({ x: p.x + dx, z: p.z + dz }))).every((v) => inConvex(poly, v))
  : inConvex(convexHull(poly.flatMap((v) => [-margin, margin].flatMap((dx) =>
    [-margin, margin].map((dz) => ({ x: v.x + dx, z: v.z + dz }))))), p));
const FURNITURE_FLOORS = [
  [81.6, 90.6, 97.4, 106.6], [80, 82, 98, 102], [77.6, 86.6, 277.4, 288.6],
  [90, 98, 235, 251], [78, 85, 317.4, 323], [74, 78, 318, 322],
] as const;
const inFurnitureFloor = (p: Point, margin: number) => FURNITURE_FLOORS.some(([x0, x1, z0, z1]) =>
  p.x >= x0 - margin && p.x <= x1 + margin && p.z >= z0 - margin && p.z <= z1 + margin);

/** A superset of the designed shelf (8 m ribbons, turning bevels, landings). */
function onShelf(p: Point, margin = 0): boolean {
  if (inFurnitureFloor(p, margin) || inApron(p, margin)) return true;
  if (LANDINGS.some((l) => p.x >= l.minX - margin && p.x <= l.maxX + margin && p.z >= l.minZ - margin && p.z <= l.maxZ + margin)) return true;
  if (NODES.slice(0, -1).some((n) => Math.hypot(p.x - n.x, p.z - n.z) <= 4 + margin)) return true;
  return segments.some((s) => {
    const t = (p.x - s.a.x) * s.u.x + (p.z - s.a.z) * s.u.z, across = Math.abs((p.x - s.a.x) * s.u.z - (p.z - s.a.z) * s.u.x);
    return t >= -margin && t <= s.length + margin && across <= 4 + margin;
  });
}

const world = buildRoadSupportWorld();
const shelfFloors = world.boxes.filter((b) => /^ridge-(floor|slab|bridge-deck)/.test(b.id) || b.id === 'insertion-foundation');
const near = (p: Point, r: number) => world.boxes.filter((b) => b.maxX > p.x - r && b.minX < p.x + r && b.maxZ > p.z - r && b.minZ < p.z + r);
const yieldWorker = () => new Promise<void>((resolve) => setImmediate(resolve));
let nav: NavMesh, sealed: NavMesh;

describe('U-164 completed ridge travel on the actual tiled standing nav bake', () => {
  beforeAll(async () => {
    await initNav();
    nav = NavMesh.load(await bakeRoadSupportNav(world));
    // Close only the insertion's D0→R0 ridge mouth, west of R0's stair.
    const seal: WorldBox = { id: 'test-seal-R0-mouth', kind: 'cover', minX: 50, maxX: 52, minY: 8, maxY: 38, minZ: 56, maxZ: 76 };
    sealed = NavMesh.load(await bakeRoadSupportNav({ ...world, boxes: [...world.boxes, seal] }));
  }, 240_000);
  afterAll(() => { nav?.destroy(); sealed?.destroy(); });

  it('projects every ridge node to its floor and adds no synthetic links', () => {
    // Recast cell height is 5 cm; polygon interpolation at a stair/pad seam
    // may land on either side of the exact floor, rather than always +5 cm.
    for (const n of NODES) expect(Math.abs(nav.nearestPoint(n)!.point.y - n.y), n.id).toBeLessThanOrEqual(.05002);
    expect(nav.links()).toEqual([]);
  });

  for (const outward of [true, false]) it(`walks D0 → R0 … R9 ${outward ? 'up the ridge' : 'and back down'} on the real controller`, async () => {
    const stops = outward ? [D0, ...NODES] : [...NODES].reverse().concat(D0);
    let state = createMoveState(stops[0]!.x, stops[0]!.y, stops[0]!.z);
    state = { ...state, grounded: true };
    const follower = new PathFollower(nav, world.boxes);
    let ticks = 0;
    for (const [i, goal] of stops.slice(1).entries()) {
      const from = stops[i]!, low = Math.min(from.y, goal.y) - .05, high = Math.max(from.y, goal.y) + .05;
      expect(completePathLength(nav.path(state, goal), state, goal), `no complete path to ${goal.id}`).not.toBeNull();
      let arrived = false;
      for (let tick = 0; tick < 1500; tick++) {
        const { input, status } = follower.step(state, { goal, pace: 'walk' }, 0);
        if (status === 'arrived') { arrived = true; break; }
        const previousY = state.y;
        state = stepCharacter(state, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, world.boxes);
        expect(state.vault).toBeNull();
        expect(Math.abs(state.y - previousY), `${from.id}→${goal.id} changed storeys`).toBeLessThan(.3);
        // Never below the lower landing (no drop) and never above the higher one (no rock top).
        expect(state.y, `${from.id}→${goal.id} at ${JSON.stringify(state)}`).toBeGreaterThanOrEqual(low);
        expect(state.y, `${from.id}→${goal.id} at ${JSON.stringify(state)}`).toBeLessThanOrEqual(high);
        expect(onShelf(state, .05) || onInsertionFloor(state, .05), `left the shelf at ${JSON.stringify(state)}`).toBe(true);
        if (++ticks % 256 === 0) await yieldWorker();
      }
      expect(arrived, `stalled at ${JSON.stringify(state)} toward ${goal.id}`).toBe(true);
      expect(Math.abs(state.y - goal.y), `${goal.id} floor`).toBeLessThan(.05);
    }
    console.log(`U-164 ridge walk ${outward ? 'up' : 'down'}`, JSON.stringify({ ticks, seconds: ticks * TICK_SECONDS }));
  }, 120_000);

  it('joins the ridge to the road and start only through the D0 court mouth', () => {
    const start = INSERTION.squadStarts[0]!, r4 = NODES[4]!, r9 = NODES.at(-1)!;
    expect(completePathLength(nav.path(start, r9), start, r9)).toBeGreaterThan(350);
    expect(completePathLength(nav.path(r9, A8), r9, A8)).toBeGreaterThan(350);
    // The occupied bridge and the road below stay separate; only D0 joins them.
    for (const node of NODES.slice(7)) for (const road of [X0, ...ROAD_UNDER_BRIDGE]) {
      const viaCourt = nav.path(node, road)!;
      const length = completePathLength(viaCourt, node, road);
      expect(length, `${node.id} → ${JSON.stringify(road)} incomplete at ${JSON.stringify(viaCourt?.points.at(-1))}`).not.toBeNull();
      expect(length, `${node.id} → road shortcuts the ridge`).toBeGreaterThan(600);
      expect(viaCourt.points.some((p) => Math.hypot(p.x - D0.x, p.z - D0.z) < 14), `${node.id} → road bypasses D0`).toBe(true);
    }
    for (const node of NODES.slice(1)) for (const from of [start, A1, A8, X0, ...ROAD_UNDER_BRIDGE])
      expect(completePathLength(sealed.path(from, node), from, node), `${node.id} reachable past the sealed mouth from ${JSON.stringify(from)}`).toBeNull();
    expect(completePathLength(sealed.path(r4, r9), r4, r9)).not.toBeNull();
    expect(completePathLength(sealed.path(r9, r4), r9, r4)).not.toBeNull();
  });

  it('leaves the ridge rock, its barrier ring and every temporary cap an unreachable island', () => {
    const tops = [{ x: 106, z: 210 }, { x: 98, z: 140 }, { x: 55, z: 128 }, { x: 85, z: 210 }, { x: 63, z: 286 },
      { x: 73.5, z: 170 }, { x: 98.6, z: 248 }, { x: 94, z: 238 }, { x: 82, z: 320 },
      { x: 90.3, z: 102 }, { x: 86.3, z: 284 }, { x: 80, z: 279.35 }, { x: 84.4, z: 286 }, { x: 52, z: 112 },
      { x: 65.5, z: 336 }, { x: 74.5, z: 336 }, { x: 65.5, z: 344 }, { x: 74.5, z: 344 }, { x: 56, z: 374.3 }];
    for (const at of tops) {
      const top = { ...at, y: Math.max(...world.boxes.filter((b) => at.x >= b.minX && at.x <= b.maxX && at.z >= b.minZ && at.z <= b.maxZ).map((b) => b.maxY)) };
      const hit = nav.nearestPoint(top, { x: .6, y: .5, z: .6 });
      if (!hit) continue; // too narrow to carry any standing mesh at all
      for (const from of [D0, NODES[3]!, NODES[5]!, NODES.at(-1)!])
        expect(completePathLength(nav.path(from, hit.point), from, hit.point), `rock top ${JSON.stringify(top)} from ${JSON.stringify(from)}`).toBeNull();
    }
  });

  it('rejects walking, sprint-jumping, crouching and crawling off every ridge edge', async () => {
    let attempts = 0;
    const tryEscape = (inside: Point, out: Point) => {
      // Only edges that face rock: a landing edge opening onto a stair is the route.
      if (onShelf({ x: inside.x + out.x, z: inside.z + out.z }) || onInsertionFloor({ x: inside.x + out.x, z: inside.z + out.z })) return;
      if (!onShelf(inside, -.45) && !LANDINGS.some((l) => inside.x > l.minX + .4 && inside.x < l.maxX - .4 && inside.z > l.minZ + .4 && inside.z < l.maxZ - .4)) return;
      const boxes = near(inside, 10), y = supportUnder(inside.x, inside.z, DEFAULT_MOVE_CONFIG.radius, 31, boxes, 0);
      if (y < 7.9 || blockedAt(inside.x, inside.z, DEFAULT_MOVE_CONFIG.radius, y, 0, DEFAULT_MOVE_CONFIG.height, boxes)) return;
      const yaw = Math.round(Math.atan2(out.x, out.z) / (2 * Math.PI) * 1024 + 1024) % 1024;
      for (const stance of ['walk', 'jump', 'crouch', 'prone']) {
        let state = { ...createMoveState(inside.x, y, inside.z), grounded: true };
        for (let tick = 0; tick < 45; tick++) state = stepCharacter(state, {
          moveX: 0, moveY: 1, yaw, sprint: stance !== 'walk', jump: stance === 'jump', crouch: stance === 'crouch', prone: stance === 'prone',
        }, TICK_SECONDS, DEFAULT_MOVE_CONFIG, boxes);
        for (let settle = 0; settle < 30; settle++) state = stepCharacter(state, { moveX: 0, moveY: 0, yaw, sprint: false, jump: false, crouch: false, prone: false }, TICK_SECONDS, DEFAULT_MOVE_CONFIG, boxes);
        expect(state.vault).toBeNull();
        expect(onShelf(state, .05) || onInsertionFloor(state, .05), `${stance} left the ridge from ${JSON.stringify(inside)} to ${JSON.stringify(state)}`).toBe(true);
        // Sliding along the .30 m-tread approaches can climb several metres;
        // require the highest ridge floor, never the road beneath it.
        expect(supportUnder(state.x, state.z, DEFAULT_MOVE_CONFIG.radius, 31, shelfFloors, 0),
          `${stance} changed storeys from ${JSON.stringify(inside)} to ${JSON.stringify(state)}`).toBeCloseTo(state.y, 6);
        expect(supportUnder(state.x, state.z, DEFAULT_MOVE_CONFIG.radius, state.y + .01, boxes, 0)).toBeCloseTo(state.y, 6);
        attempts++;
      }
    };
    for (const s of segments) {
      for (let t = 1; t < s.length - 1; t += 2) for (const side of [-1, 1]) {
        const out = { x: -s.u.z * side, z: s.u.x * side };
        tryEscape({ x: s.a.x + s.u.x * t + out.x * 3.4, z: s.a.z + s.u.z * t + out.z * 3.4 }, out);
      }
      await yieldWorker();
    }
    for (const l of LANDINGS) {
      for (let x = l.minX + 1; x < l.maxX; x += 2) for (const [z, dz] of [[l.minZ + .6, -1], [l.maxZ - .6, 1]] as const) tryEscape({ x, z }, { x: 0, z: dz });
      for (let z = l.minZ + 1; z < l.maxZ; z += 2) for (const [x, dx] of [[l.minX + .6, -1], [l.maxX - .6, 1]] as const) tryEscape({ x, z }, { x: dx, z: 0 });
      await yieldWorker();
    }
    // Require both parapets at every bridge/approach phase to exercise all four
    // stances; the generic sampler must not silently skip these occupied edges.
    for (const z of [323, 326, 329, 331, 336, 341, 344, 347]) for (const side of [-1, 1]) {
      const before = attempts;
      tryEscape({ x: 70 + side * 3.4, z }, { x: side, z: 0 });
      expect(attempts - before, `untested bridge edge at z${z}, side${side}`).toBe(4);
    }
    const descent = segments.at(-1)!;
    for (const t of [8, 10, 12, 14, 16, 18, 20]) for (const side of [-1, 1]) {
      const out = { x: -descent.u.z * side, z: descent.u.x * side }, before = attempts;
      tryEscape({ x: 70 + descent.u.x * t + out.x * 3.4, z: 350 + descent.u.z * t + out.z * 3.4 }, out);
      expect(attempts - before, `untested R8→R9 edge at t${t}, side${side}`).toBe(4);
    }
    for (const x of [53, 56, 59]) {
      const before = attempts;
      tryEscape({ x, z: 373.4 }, { x: 0, z: 1 });
      expect(attempts - before, `untested east-gate cap at x${x}`).toBe(4);
    }
    expect(attempts).toBeGreaterThan(1000);
    console.log('U-164 ridge escape attempts', JSON.stringify({ attempts, stances: ['walk', 'sprint-jump', 'crouch', 'prone'], ticks: 45 }));
  }, 180_000);
});
