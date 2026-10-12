import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, TICK_SECONDS, blockedAt, createMoveState, stepCharacter, supportUnder, type WorldBox,
} from '@sandline/shared';
import { NavMesh, completePathLength, initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { PathFollower } from '../../../server/src/ai/locomotion/followPath.ts';
import { INSERTION, onInsertionFloor } from './qalatInsertion.ts';
import { bakeRoadSupportNav } from './qalatRoadNav.ts';
import { buildRoadSupportWorld } from './qalatRoadSupports.ts';

type Point = { x: number; z: number };
// Independent §6.1 transcription; the D0 court is the ridge's only mouth.
const D0: { id: string; x: number; y: number; z: number } = { id: 'D0', x: 32, y: 8, z: 64 };
type Node = { id: string; x: number; y: number; z: number };
const NODES: Node[] = ([['R0', 62, 8, 68], ['R1', 78, 14, 96], ['R2', 64, 20, 128], ['R3', 80, 26, 168],
  ['R4', 94, 30, 210], ['R5', 86, 30, 248], ['R6', 72, 26, 286], ['R7', 70, 20, 322]] as const)
  .map(([id, x, y, z]) => ({ id, x, y, z }));
const LANDINGS = [[72, 84, 90, 102], [58, 70, 122, 134], [74, 86, 158, 182], [88, 100, 204, 216],
  [80, 92, 242, 254], [66, 78, 280, 292], [66, 74, 320, 324]].map(([minX, maxX, minZ, maxZ]) => ({ minX: minX!, maxX: maxX!, minZ: minZ!, maxZ: maxZ! }));
const X0 = { x: 96, y: 8, z: 444 }, A1 = { x: 32, y: 8, z: 98 }, A8 = { x: 16, y: 8, z: 332 };
const segments = NODES.slice(1).map((b, i) => {
  const a = NODES[i]!, length = Math.hypot(b.x - a.x, b.z - a.z);
  return { a, b, length, u: { x: (b.x - a.x) / length, z: (b.z - a.z) / length } };
});
/** A superset of the designed shelf (8 m ribbons, turning bevels, landings). */
function onShelf(p: Point, margin = 0): boolean {
  if (LANDINGS.some((l) => p.x >= l.minX - margin && p.x <= l.maxX + margin && p.z >= l.minZ - margin && p.z <= l.maxZ + margin)) return true;
  if (NODES.slice(0, -1).some((n) => Math.hypot(p.x - n.x, p.z - n.z) <= 4 + margin)) return true;
  return segments.some((s) => {
    const t = (p.x - s.a.x) * s.u.x + (p.z - s.a.z) * s.u.z, across = Math.abs((p.x - s.a.x) * s.u.z - (p.z - s.a.z) * s.u.x);
    return t >= -margin && t <= s.length + margin && across <= 4 + margin;
  });
}

const world = buildRoadSupportWorld();
const near = (p: Point, r: number) => world.boxes.filter((b) => b.maxX > p.x - r && b.minX < p.x + r && b.maxZ > p.z - r && b.minZ < p.z + r);
const yieldWorker = () => new Promise<void>((resolve) => setImmediate(resolve));
let nav: NavMesh, sealed: NavMesh;

describe('U-163 ridge travel on the actual tiled standing nav bake', () => {
  beforeAll(async () => {
    await initNav();
    nav = NavMesh.load(await bakeRoadSupportNav(world));
    // Close only the insertion's D0→R0 ridge mouth, west of R0's stair.
    const seal: WorldBox = { id: 'test-seal-R0-mouth', kind: 'cover', minX: 50, maxX: 52, minY: 8, maxY: 38, minZ: 56, maxZ: 76 };
    sealed = NavMesh.load(await bakeRoadSupportNav({ ...world, boxes: [...world.boxes, seal] }));
  }, 240_000);
  afterAll(() => { nav?.destroy(); sealed?.destroy(); });

  it('projects every ridge node to its floor and adds no synthetic links', () => {
    for (const n of NODES) expect(nav.nearestPoint(n)?.point.y, n.id).toBeCloseTo(n.y + .05, 1);
    expect(nav.links()).toEqual([]);
  });

  for (const outward of [true, false]) it(`walks D0 → R0 … R7 ${outward ? 'up the ridge' : 'and back down'} on the real controller`, async () => {
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
        state = stepCharacter(state, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, world.boxes);
        expect(state.vault).toBeNull();
        // Never below the lower landing (no drop) and never above the higher one (no rock top).
        expect(state.y, `${from.id}→${goal.id} at ${JSON.stringify(state)}`).toBeGreaterThanOrEqual(low);
        expect(state.y, `${from.id}→${goal.id} at ${JSON.stringify(state)}`).toBeLessThanOrEqual(high);
        expect(onShelf(state, .05) || onInsertionFloor(state, .05), `left the shelf at ${JSON.stringify(state)}`).toBe(true);
        if (++ticks % 256 === 0) await yieldWorker();
      }
      expect(arrived, `stalled at ${JSON.stringify(state)} toward ${goal.id}`).toBe(true);
      expect(Math.abs(state.y - goal.y), `${goal.id} floor`).toBeLessThan(.05);
    }
    console.log(`U-163 ridge walk ${outward ? 'up' : 'down'}`, JSON.stringify({ ticks, seconds: ticks * TICK_SECONDS }));
  }, 120_000);

  it('joins the ridge to the road and start only through the D0 court mouth', () => {
    const start = INSERTION.squadStarts[0]!, r4 = NODES[4]!, r7 = NODES.at(-1)!;
    expect(completePathLength(nav.path(start, r7), start, r7)).toBeGreaterThan(300);
    expect(completePathLength(nav.path(r7, A8), r7, A8)).toBeGreaterThan(300);
    // R7's bridge mouth is closed until U-164: the X spur is reached only back through D0 and A8.
    const viaCourt = nav.path(r7, X0)!;
    expect(completePathLength(viaCourt, r7, X0)).toBeGreaterThan(600);
    expect(viaCourt.points.some((p) => Math.hypot(p.x - D0.x, p.z - D0.z) < 14), 'R7 → X0 bypasses the D0 court').toBe(true);
    for (const node of NODES.slice(1)) for (const from of [start, A1, A8, X0])
      expect(completePathLength(sealed.path(from, node), from, node), `${node.id} reachable past the sealed mouth from ${JSON.stringify(from)}`).toBeNull();
    expect(completePathLength(sealed.path(r4, r7), r4, r7)).not.toBeNull();
  });

  it('leaves the ridge rock, its barrier ring and every temporary cap an unreachable island', () => {
    const tops = [{ x: 106, z: 210 }, { x: 98, z: 140 }, { x: 55, z: 128 }, { x: 85, z: 210 }, { x: 63, z: 286 },
      { x: 73.5, z: 170 }, { x: 92.6, z: 248 }, { x: 52, z: 112 }];
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
        // Sliding along a wall may change treads, never storeys.
        expect(Math.abs(state.y - y), `${stance} changed level from ${JSON.stringify(inside)} to ${JSON.stringify(state)}`).toBeLessThan(2);
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
    expect(attempts).toBeGreaterThan(1000);
    console.log('U-163 ridge escape attempts', JSON.stringify({ attempts, stances: ['walk', 'sprint-jump', 'crouch', 'prone'], ticks: 45 }));
  }, 180_000);
});
