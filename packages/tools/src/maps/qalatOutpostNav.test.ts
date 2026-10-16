import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, TICK_SECONDS, blockedAt, createMoveState, stepCharacter, supportUnder,
} from '@sandline/shared';
import { NavMesh, completePathLength, initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { PathFollower } from '../../../server/src/ai/locomotion/followPath.ts';
import { buildOutpostWorld } from './qalatOutpost.ts';
import { bakeRoadSupportNav } from './qalatRoadNav.ts';

type Point = { x: number; y: number; z: number };
// Independent §§8.1/9.3 witnesses, including every reserve-corridor turn.
const COURT = { x: 32, y: 8, z: 374 };
const RESERVE = [[32, 412], [32, 418], [20, 418], [20, 426], [32, 426], [32, 434], [32, 440]];
const TRIPS = [
  ['south approach', [[32, 350], [32, 356], [32, 374]]],
  ['depot west approach', [[2, 376], [5, 374], [8, 374], [26, 374], [32, 374]]],
  // R9's pad continues outside the eastwall. Its named centre at(56,370)
  // meets the structural arch's infilled jamb; use the actual outer pad.
  ['ridge east approach', [[59, 370], [59, 374], [56, 374], [48, 374], [32, 374]]],
  ['barracks', [[32, 374], [20, 374], [20, 368], [18, 365]]],
  ['refuge', [[32, 374], [26, 380], [20, 380], [16, 380]]],
  ['antechamber and captive', [[32, 374], [26, 392], [20, 392], [16, 392], [16, 398], [16, 402]]],
  ['radio room', [[32, 374], [38, 396], [44, 396], [48, 402]]],
  ['reserve service bends', [[32, 374], [32, 408], ...RESERVE]],
] as const;
const point = ([x, z]: readonly number[]): Point => ({ x: x!, y: 8, z: z! });
const within = (p: Point, x0: number, x1: number, z0: number, z1: number) =>
  p.x >= x0 - .06 && p.x <= x1 + .06 && p.z >= z0 - .06 && p.z <= z1 + .06;
const onFloor = (p: Point) => within(p, 8, 56, 356, 412) || within(p, 28, 36, 350, 356)
  || within(p, 1, 8, 372, 378) || within(p, 52, 60, 368, 374) || within(p, 56, 61, 370, 376)
  || within(p, 28, 36, 412, 414) || within(p, 24, 40, 434, 448)
  || RESERVE.slice(1).some((b, i) => {
    const a = RESERVE[i]!;
    return within(p, Math.min(a[0]!, b[0]!) - 2, Math.max(a[0]!, b[0]!) + 2,
      Math.min(a[1]!, b[1]!) - 2, Math.max(a[1]!, b[1]!) + 2);
  });
const world = buildOutpostWorld();
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

describe('U-175 outpost on the actual complete tiled standing bake', () => {
  beforeAll(async () => {
    await initNav();
    nav = NavMesh.load(await bakeRoadSupportNav(world));
  }, 240_000);
  afterAll(() => nav?.destroy());

  it('projects every independent room, approach and service witness onto its actual y8 floor without links', () => {
    expect(nav.links()).toEqual([]);
    for (const [, points] of TRIPS) for (const at of points) {
      const goal = point(at), projected = nav.nearestPoint(goal)?.point;
      expect(projected, JSON.stringify(goal)).toBeDefined();
      expect(Math.hypot(projected!.x - goal.x, projected!.z - goal.z), 'lost real floor').toBeLessThan(.1);
      // B10's exact top stair boundary borrows its adjacent ordinary .20m
      // riser in nav detail, as in the accepted depot endpoint proof. Its
      // actual support/controller feet must still remain exactly y8 below.
      const stairBoundary = goal.x === 2 && goal.z === 376;
      expect(Math.abs(projected!.y - 8), `wrong storey ${JSON.stringify(goal)}`).toBeLessThanOrEqual(stairBoundary ? .25002 : .05002);
      expect(supportUnder(goal.x, goal.z, .001, 8.01, nearby(goal), 0), 'authored floor').toBeCloseTo(8, 6);
    }
  });

  it('exposes the exact R9 centre versus fixed east-wall conflict rather than claiming the endpoint stayed clear', () => {
    // §6.1 R9(56,8,370) meets §8.1's solid south arch infill; the
    // exterior shoulder route above is distinct from that authored centre.
    expect(blockedAt(56, 370, DEFAULT_MOVE_CONFIG.radius, 8, .05,
      DEFAULT_MOVE_CONFIG.height, nearby({ x: 56, y: 8, z: 370 }))).toBe(true);
  });

  it('preserves the approved four-metre outside-wall turn and rejects escape beyond its bounded pocket', () => {
    for (let x = 57.01; x < 61; x += .4) for (let z = 370.01; z < 376; z += .4) {
      expect(blockedAt(x, z, .001, 8, 0, 3.999, world.boxes), `east four-metre turn ${x}/${z}`).toBe(false);
      expect(supportUnder(x, z, .001, 8.01, world.boxes, 0)).toBeCloseTo(8, 6);
    }
    for (const yaw of [0, 256]) {
      let state = { ...createMoveState(59, 8, 374), grounded: true };
      for (let tick = 0; tick < 150; tick++) {
        state = stepCharacter(state, { moveX: 0, moveY: 1, yaw, sprint: true,
          jump: tick % 30 === 0, crouch: false, prone: false }, TICK_SECONDS, DEFAULT_MOVE_CONFIG, nearby(state));
        expect(state.x, 'east pocket escape').toBeLessThanOrEqual(60.651);
        expect(state.z, 'north pocket escape').toBeLessThanOrEqual(375.651);
        expect(state.vault).toBeNull();
      }
    }
  });

  for (const reverse of [false, true]) it(`walks all three approaches, every room and every reserve bend ${reverse ? 'outward' : 'inward'}`, async () => {
    let ticks = 0;
    for (const [id, route] of TRIPS) {
      const stops = (reverse ? [...route].reverse() : route).map(point), first = stops[0]!;
      let state = { ...createMoveState(first.x, 8, first.z), grounded: true };
      const follower = new PathFollower(nav, world.boxes);
      for (const goal of stops.slice(1)) {
        const path = nav.path(state, goal), label = `${id} ${reverse ? 'reverse' : 'forward'} → ${JSON.stringify(goal)}`;
        expect(completePathLength(path, state, goal), label).not.toBeNull();
        expect(path!.vaults, label).toEqual([]);
        expect(path!.points.every(onFloor), `${label}: left prescribed approach/annex`).toBe(true);
        let arrived = false;
        for (let tick = 0; tick < 1_200; tick++) {
          const { input, status } = follower.step(state, { goal, pace: 'walk' }, 0);
          expect(input.jump, label).toBe(false);
          if (status === 'arrived') { arrived = true; break; }
          state = stepCharacter(state, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, nearby(state));
          expect(state.y, `${label}: roof or basement`).toBeCloseTo(8, 6);
          expect(state.vault, label).toBeNull();
          expect(state.crouched || state.prone, label).toBe(false);
          expect(onFloor(state), `${label}: fourth route`).toBe(true);
          expect(blockedAt(state.x, state.z, DEFAULT_MOVE_CONFIG.radius, state.y, .05,
            DEFAULT_MOVE_CONFIG.height, nearby(state)), `${label}: inside solid`).toBe(false);
          if (++ticks % 256 === 0) await yieldWorker();
        }
        expect(arrived, `${label}: stalled at ${JSON.stringify(state)}`).toBe(true);
      }
    }
    console.log(`U-175 outpost ${reverse ? 'outward' : 'inward'} controller`, JSON.stringify({ routes: TRIPS.length, ticks, seconds: ticks * TICK_SECONDS }));
  }, 120_000);

  it('reaches each of the six standing holding positions from the antechamber on the actual floor and controller', async () => {
    // Independently transcribed capacity layout: original POW then five
    // captured squad members. Session multi-actor release remains U-177.
    const positions = [[16, 402], [12, 400], [20, 400], [12, 404], [20, 404], [12, 408]];
    for (const holding of positions) {
      const goal = point(holding), projected = nav.nearestPoint(goal)?.point;
      expect(projected).toBeDefined(); expect(Math.abs(projected!.y - 8)).toBeLessThanOrEqual(.05002);
      expect(Math.hypot(projected!.x - goal.x, projected!.z - goal.z)).toBeLessThan(.1);
      let state = { ...createMoveState(16, 8, 392), grounded: true }, arrived = false;
      const path = nav.path(state, goal), follower = new PathFollower(nav, world.boxes);
      expect(completePathLength(path, state, goal), `unreachable holding ${holding}`).not.toBeNull();
      expect(path!.vaults).toEqual([]);
      for (let tick = 0; tick < 1_200; tick++) {
        const { input, status } = follower.step(state, { goal, pace: 'walk' }, 0);
        expect(input.jump).toBe(false);
        if (status === 'arrived') { arrived = true; break; }
        state = stepCharacter(state, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, nearby(state));
        expect(state.y).toBeCloseTo(8, 6); expect(state.vault).toBeNull();
        expect(state.crouched || state.prone).toBe(false);
        expect(within(state, 10, 22, 386, 410), 'left the ante/cell route').toBe(true);
        expect(blockedAt(state.x, state.z, DEFAULT_MOVE_CONFIG.radius, 8, .05,
          DEFAULT_MOVE_CONFIG.height, nearby(state)), 'holding route intersects construction').toBe(false);
        if (tick % 256 === 0) await yieldWorker();
      }
      expect(arrived, `stalled toward holding ${holding} at ${JSON.stringify(state)}`).toBe(true);
    }
  }, 120_000);

  it('walks the retained R8 final stairs directly to the courtyard and back through the new east pocket', async () => {
    const r8 = { x: 70, y: 12, z: 350 }, length = Math.hypot(14, 20);
    const retained = (p: Point) => onFloor(p) || within(p, 66, 74, 348, 352)
      || (((p.x - 70) * -14 + (p.z - 350) * 20) / length >= -.06
        && ((p.x - 70) * -14 + (p.z - 350) * 20) / length <= length + .06
        && Math.abs((p.x - 70) * 20 + (p.z - 350) * 14) / length <= 4.06);
    for (const [first, goal] of [[r8, COURT], [COURT, r8]]) {
      let state = { ...createMoveState(first!.x, first!.y, first!.z), grounded: true }, arrived = false;
      const path = nav.path(state, goal!);
      expect(completePathLength(path, state, goal!), 'final ridge connection').not.toBeNull();
      expect(path!.vaults).toEqual([]); expect(path!.points.every(retained), 'detoured through another approach').toBe(true);
      const follower = new PathFollower(nav, world.boxes);
      for (let tick = 0; tick < 2_400; tick++) {
        const { input, status } = follower.step(state, { goal: goal!, pace: 'walk' }, 0);
        if (status === 'arrived') { arrived = true; break; }
        expect(input.jump).toBe(false);
        const before = state;
        state = stepCharacter(state, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, nearby(state));
        expect(Math.abs(state.y - before.y)).toBeLessThanOrEqual(DEFAULT_MOVE_CONFIG.stepHeight);
        expect(state.y).toBeGreaterThanOrEqual(7.999999); expect(state.y).toBeLessThanOrEqual(12.000001);
        expect(retained(state), 'left final stair/pad, east pocket and courtyard').toBe(true);
        expect(state.vault).toBeNull(); expect(state.crouched || state.prone).toBe(false);
        expect(blockedAt(state.x, state.z, DEFAULT_MOVE_CONFIG.radius, state.y, DEFAULT_MOVE_CONFIG.stepHeight,
          DEFAULT_MOVE_CONFIG.height, nearby(state)), 'inside final stair structure').toBe(false);
        if (tick % 256 === 0) await yieldWorker();
      }
      expect(arrived, `stalled final ridge leg at ${JSON.stringify(state)}`).toBe(true);
      expect(state.y).toBeCloseTo(goal!.y, 6);
    }
  }, 120_000);

  it('uses the north gate as the reserve annex sole connection and excludes a fourth approach to X', () => {
    const reserve = point([32, 440]), x0 = point([96, 444]);
    expect(completePathLength(nav.path(reserve, COURT), reserve, COURT)).not.toBeNull();
    nav.setBlocker('test-seal-north-gate', [{ minX: 28, maxX: 36, minY: 8, maxY: 15, minZ: 411.9, maxZ: 413.1 }], true);
    try {
      for (const external of [COURT, point([32, 350]), point([58, 370]), point([2, 376]), x0])
        for (const [from, to] of [[reserve, external], [external, reserve]])
          expect(completePathLength(nav.path(from!, to!), from!, to!), 'unlisted reserve exit').toBeNull();
    } finally { nav.setBlocker('test-seal-north-gate', [], false); }
    nav.setBlocker('test-seal-three-player-gates', [
      { minX: 28, maxX: 36, minY: 8, maxY: 15, minZ: 354.9, maxZ: 356.1 },
      { minX: 6.9, maxX: 8.1, minY: 8, maxY: 15, minZ: 372, maxZ: 376 },
      { minX: 55.9, maxX: 57.1, minY: 8, maxY: 15, minZ: 372, maxZ: 376 },
    ], true);
    try {
      expect(completePathLength(nav.path(reserve, COURT), reserve, COURT)).not.toBeNull();
      for (const inside of [reserve, COURT]) for (const [from, to] of [[inside, x0], [x0, inside]])
        expect(completePathLength(nav.path(from!, to!), from!, to!), 'outpost shortcut to tank road').toBeNull();
    } finally { nav.setBlocker('test-seal-three-player-gates', [], false); }
  });

  it('keeps solid room roofs, perimeter tops and annex roofs inaccessible from all three approaches', () => {
    for (const roof of [[18, 12.8, 365], [16, 13.3, 380], [16, 12.8, 392], [16, 12.8, 402],
      [48, 12.8, 402], [32, 12.8, 440], [26, 12.8, 426], [40, 14, 412], [49, 26, 417]]) {
      const target = { x: roof[0]!, y: roof[1]!, z: roof[2]! };
      const projected = nav.nearestPoint(target, { x: .3, y: .15, z: .3 });
      // Narrow masonry may carry no standing polygon. A baked roof polygon
      // must remain a separate island even when it exists in the real mesh.
      if (!projected) continue;
      for (const from of [COURT, point([32, 350]), point([58, 370]), point([2, 376])])
        expect(completePathLength(nav.path(from, projected.point), from, projected.point), `roof route ${JSON.stringify(target)}`).toBeNull();
    }
  });
});
