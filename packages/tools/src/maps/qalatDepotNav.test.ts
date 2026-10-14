import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, TICK_SECONDS, blockedAt, createMoveState, stepCharacter, supportUnder,
} from '@sandline/shared';
import { NavMesh, completePathLength, initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { PathFollower } from '../../../server/src/ai/locomotion/followPath.ts';
import { buildDepotWorld } from './qalatDepot.ts';
import { bakeRoadSupportNav } from './qalatRoadNav.ts';
import { inConvex, rectPolygon, type Point, type Polygon } from './planStrata.ts';
import { convexHull, ribbonPieces } from './roadSightLines.ts';

type Node = { id: string; x: number; y: number; z: number };
// Independent §7.2 transcription. Neither the authoring JSON nor a generator's
// own route helpers may move a room or silently remove a corridor turn here.
const SPINE: Node[] = [
  ['B1', -2, 96], ['B1-B2', -20, 96], ['B2', -20, 120], ['B2-B3', -36, 136],
  ['B3', -36, 160], ['B3-B4', -36, 188], ['B4', -18, 200], ['B4-B5', 8, 216],
  ['B5', 8, 232], ['B5-B6-south', 8, 250], ['B5-B6-east', 30, 250], ['B6', 30, 270],
  ['B6-B7-east', 30, 298], ['B6-B7-west', -14, 298], ['B7', -14, 310],
  ['B7-B8', -14, 330], ['B8', -14, 346], ['B8-B9', -8, 362], ['B9', -8, 370],
].map(([id, x, z]) => ({ id: id as string, x: x as number, y: 0, z: z as number }));
const ROOMS = [
  [-2, 96, 12, 12], [-20, 120, 20, 24], [-36, 160, 24, 32], [-18, 200, 20, 24],
  [8, 232, 16, 16], [30, 270, 28, 36], [-14, 310, 20, 20], [-14, 346, 20, 24], [-8, 370, 12, 12],
] as const;
// Independent §4 road nodes, including A6 directly over B6. U-171 will open
// the two endpoint stairs; this shell leaf must leave both endpoints capped.
const SURFACE: Node[] = [
  ['D0', 32, 64], ['A1', 32, 98], ['A2', 12, 128], ['A3', -37, 142], ['A4', -28, 210],
  ['A5', 26, 232], ['A6', 30, 270], ['A7', -18, 302], ['A8', 16, 332], ['A9', 32, 350],
].map(([id, x, z]) => ({ id: id as string, x: x as number, y: 8, z: z as number }));
// The construction's global y0 backing plane extends beyond the depot walls.
// Surface-only queries cannot detect a wall gap that leaks onto that plane.
const BACKING: Node[] = [
  ['backing-west-B1', -60, 96], ['backing-west-B3', -60, 160], ['backing-west-B6', -60, 270],
  ['backing-west-B9', -60, 370], ['backing-east-B3', 60, 160], ['backing-east-B6', 60, 270],
].map(([id, x, z]) => ({ id: id as string, x: x as number, y: 0, z: z as number }));

const floorPieces: Polygon[] = [
  ...ROOMS.map(([x, z, w, d]) => rectPolygon({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 })),
  ...ribbonPieces(SPINE, 4),
  ...SPINE.map((p) => rectPolygon({ minX: p.x - 2, maxX: p.x + 2, minZ: p.z - 2, maxZ: p.z + 2 })),
];
// A diagonal 4 m ribbon must widen locally to meet a wall's axis-aligned
// 4 m doorway. Admit the local portal bevel independently of its construction.
for (const [x, z, w, d] of ROOMS) for (const [i, a] of SPINE.slice(0, -1).entries()) {
  const b = SPINE[i + 1]!, dx = b.x - a.x, dz = b.z - a.z;
  for (const wallX of [x - w / 2, x + w / 2]) if (dx) {
    const t = (wallX - a.x) / dx, atZ = a.z + t * dz;
    if (t >= 0 && t <= 1 && atZ >= z - d / 2 && atZ <= z + d / 2)
      floorPieces.push(rectPolygon({ minX: wallX - 4, maxX: wallX + 4, minZ: atZ - 2, maxZ: atZ + 2 }));
  }
  for (const wallZ of [z - d / 2, z + d / 2]) if (dz) {
    const t = (wallZ - a.z) / dz, atX = a.x + t * dx;
    if (t >= 0 && t <= 1 && atX >= x - w / 2 && atX <= x + w / 2)
      floorPieces.push(rectPolygon({ minX: atX - 2, maxX: atX + 2, minZ: wallZ - 4, maxZ: wallZ + 4 }));
  }
}
const allowed = floorPieces.map((poly) => convexHull(poly.flatMap((p) => [-.06, .06].flatMap((dx) =>
  [-.06, .06].map((dz) => ({ x: p.x + dx, z: p.z + dz }))))));
const onDepotFloor = (p: Point) => allowed.some((poly) => inConvex(poly, p));

const world = buildDepotWorld();
// Keep the complete scene for baking/path following; this broadphase only
// removes collision boxes well beyond a controller tick's possible reach.
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

describe('U-170 covered B1–B9 shell on the actual standing nav and controller', () => {
  beforeAll(async () => {
    await initNav();
    nav = NavMesh.load(await bakeRoadSupportNav(world));
  }, 240_000);
  afterAll(() => nav?.destroy());

  it('projects every exact room centre and corridor vertex onto its own basement floor', () => {
    expect(nav.links()).toEqual([]);
    for (const node of SPINE) {
      const point = nav.nearestPoint(node)?.point;
      expect(point, node.id).toBeDefined();
      expect(Math.abs(point!.y), `${node.id} resolved to another storey`).toBeLessThanOrEqual(.05002);
      expect(Math.hypot(point!.x - node.x, point!.z - node.z), node.id).toBeLessThanOrEqual(.1);
      expect(supportUnder(node.x, node.z, DEFAULT_MOVE_CONFIG.radius, .3, nearby(node), 0), node.id).toBeCloseTo(0, 6);
      expect(blockedAt(node.x, node.z, DEFAULT_MOVE_CONFIG.radius, 0, .05, DEFAULT_MOVE_CONFIG.height, nearby(node)), node.id).toBe(false);
    }
    for (const [from, goal] of [[SPINE[0]!, SPINE.at(-1)!], [SPINE.at(-1)!, SPINE[0]!]]) {
      const path = nav.path(from!, goal!);
      expect(completePathLength(path, from!, goal!), `${from!.id}→${goal!.id}: incomplete whole-depot command`).not.toBeNull();
      expect(path!.vaults).toEqual([]);
      expect(path!.points.every((p) => Math.abs(p.y) <= .05002 && onDepotFloor(p))).toBe(true);
    }
  });

  for (const outward of [true, false]) it(`walks every B1–B9 leg ${outward ? 'toward B9' : 'back to B1'} without jumping or leaving floor zero`, async () => {
    const stops = outward ? SPINE : [...SPINE].reverse(), first = stops[0]!;
    let state = { ...createMoveState(first.x, 0, first.z), grounded: true };
    const follower = new PathFollower(nav, world.boxes);
    let ticks = 0;
    for (const [i, goal] of stops.slice(1).entries()) {
      const label = `${stops[i]!.id}→${goal.id}`, path = nav.path(state, goal);
      expect(completePathLength(path, state, goal), `${label}: no complete path`).not.toBeNull();
      expect(path!.vaults, label).toEqual([]);
      expect(path!.points.every((p) => Math.abs(p.y) <= .05002), `${label}: path changed storeys`).toBe(true);
      let arrived = false;
      for (let tick = 0; tick < 1200; tick++) {
        const { input, status } = follower.step(state, { goal, pace: 'walk' }, 0);
        expect(input.jump, `${label}: requested a jump`).toBe(false);
        if (status === 'arrived') { arrived = true; break; }
        state = stepCharacter(state, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, nearby(state));
        const at = `${label} at ${JSON.stringify(state)}`;
        expect(state.vault, at).toBeNull();
        expect(state.grounded, at).toBe(true);
        expect(state.crouched || state.prone, at).toBe(false);
        expect(Math.abs(state.y), `${at}: dropped or snapped to a roof`).toBeLessThan(1e-6);
        expect(onDepotFloor(state), `${at}: left the listed rooms and corridors`).toBe(true);
        expect(blockedAt(state.x, state.z, DEFAULT_MOVE_CONFIG.radius, state.y, .05, DEFAULT_MOVE_CONFIG.height, nearby(state)), `${at}: inside structure`).toBe(false);
        if (++ticks % 256 === 0) await yieldWorker();
      }
      expect(arrived, `${label}: stalled at ${JSON.stringify(state)}`).toBe(true);
    }
    console.log(`U-170 depot ${outward ? 'B1→B9' : 'B9→B1'} controller`, JSON.stringify({ ticks, seconds: ticks * TICK_SECONDS, legs: stops.length - 1 }));
  }, 120_000);

  it('keeps the capped basement disconnected from every road node in both directions', () => {
    for (const surface of SURFACE) {
      const point = nav.nearestPoint(surface)?.point;
      expect(point, surface.id).toBeDefined();
      expect(Math.abs(point!.y - 8), `${surface.id} lost its surface floor`).toBeLessThanOrEqual(.05002);
      for (const basement of SPINE.filter((n) => ['B1', 'B5', 'B9'].includes(n.id))) {
        expect(completePathLength(nav.path(basement, surface), basement, surface), `${basement.id} escaped to ${surface.id}`).toBeNull();
        expect(completePathLength(nav.path(surface, basement), surface, basement), `${surface.id} entered ${basement.id} through a roof`).toBeNull();
      }
    }
  });

  it('keeps the basement enclosed from the exterior backing plane in both directions', () => {
    for (const exterior of BACKING) {
      expect(onDepotFloor(exterior), `${exterior.id} must be outside the depot footprint`).toBe(false);
      const point = nav.nearestPoint(exterior)?.point;
      // Require real exterior nav, so a missing query target cannot make a
      // broken enclosure pass simply by returning no path.
      expect(point, exterior.id).toBeDefined();
      expect(Math.abs(point!.y), `${exterior.id} is not on the y0 backing plane`).toBeLessThanOrEqual(.05002);
      expect(Math.hypot(point!.x - exterior.x, point!.z - exterior.z), exterior.id).toBeLessThanOrEqual(.1);
      for (const basement of SPINE.filter((n) => ['B1', 'B5', 'B9'].includes(n.id))) {
        expect(completePathLength(nav.path(basement, exterior), basement, exterior), `${basement.id} escaped to ${exterior.id}`).toBeNull();
        expect(completePathLength(nav.path(exterior, basement), exterior, basement), `${exterior.id} entered ${basement.id} through a wall`).toBeNull();
      }
    }
  });
});
