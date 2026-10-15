import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, TICK_SECONDS, blockedAt, createMoveState, rayWorld, stepCharacter, supportUnder,
} from '@sandline/shared';
import { NavMesh, completePathLength, initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { PathFollower, yawToward } from '../../../server/src/ai/locomotion/followPath.ts';
import { buildDepotWorld } from './qalatDepot.ts';
import { bakeRoadSupportNav } from './qalatRoadNav.ts';
import type { Point } from './planStrata.ts';

// Independent §7.3 clearance witnesses: changing the furniture generator must
// not silently move an aisle or choose the other side of its obstruction.
const STRIPS = [
  ['B2 central', -23, -17, 110, 130, 6], ['B2 trimmed east bypass', -14, -10, 121, 127, 4],
  ['B3 west bypass', -42.7, -38.7, 159, 170, 4], ['B3 east bypass', -33.3, -29.3, 159, 170, 4],
  ['B4 main aisle', -21, -15, 192, 208, 6], ['B5 regroup', 5, 13, 226, 234, 8],
  ['B6 west pier aisle', 23.3, 27.3, 254, 286, 4], ['B6 east pier aisle', 32.7, 36.7, 254, 286, 4],
  ['B6 south main aisle', 27, 33, 253, 274, 6], ['B6 north main aisle', 27, 33, 278, 287, 6],
  ['B7 regroup', -18, -10, 306, 314, 8], ['B8 main aisle', -17, -11, 336, 356, 6],
] as const;
const TRIPS: { id: string; points: Point[] }[] = [
  { id: 'B2 main aisle', points: [[-20, 110], [-20, 120], [-20, 130]] },
  { id: 'B2 sack flank', points: [[-20, 111], [-27, 112], [-27, 120], [-20, 121]] },
  { id: 'B2 trimmed crate flank', points: [[-20, 120], [-12, 120], [-12, 128], [-20, 130]] },
  ...[-40.7, -31.3].map((x) => ({ id: `B3 low wall ${x < -36 ? 'west' : 'east'}`,
    points: [[-36, 156], [x, 160], [x, 169], [-36, 173]] })),
  { id: 'B4 main aisle', points: [[-18, 192], [-18, 200], [-18, 208]] },
  // The optional outer machine margins are 2.5 m; the required six-metre
  // route is the central aisle. Still prove a standing body can circle both.
  ...[-24, -12].map((x) => ({ id: `B4 engine ${x}`,
    points: [[x - 2.5, 194], [x + 2.5, 194], [x + 2.5, 206], [x - 2.5, 206], [x - 2.5, 194]] })),
  { id: 'B5 regroup', points: [[6, 227], [12, 227], [12, 233], [6, 233], [6, 227]] },
  ...[25.3, 34.7].map((x) => ({ id: `B6 low stack ${x < 30 ? 'west' : 'east'}`,
    points: [[30, 254], [x, 260], [x, 270], [x, 280], [x, 286], [30, 286]] })),
  { id: 'B6 south main aisle', points: [[30, 254], [30, 270], [30, 273]] },
  { id: 'B6 north main aisle', points: [[30, 279], [30, 286]] },
  { id: 'B7 empty regroup floor', points: [[-17, 307], [-11, 307], [-11, 313], [-17, 313], [-17, 307]] },
  { id: 'B8 between shelves', points: [[-14, 336], [-14, 346], [-14, 356]] },
].map((trip) => ({ ...trip, points: trip.points.map(([x, z]) => ({ x: x!, z: z! })) }));

const world = buildDepotWorld();
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

describe('U-172 furniture on the real standing nav and controller', () => {
  beforeAll(async () => {
    await initNav();
    nav = NavMesh.load(await bakeRoadSupportNav(world));
  }, 240_000);
  afterAll(() => nav?.destroy());

  it('keeps the complete required widths clear, supported and usable by standing bodies', () => {
    let bodies = 0;
    for (const [id, minX, maxX, minZ, maxZ, width] of STRIPS) {
      expect(maxX - minX, id).toBeCloseTo(width, 8);
      // An exact rectangle intersection catches a thin obstruction between
      // sampled actors. Roofs remain in the geometry, above standing height.
      const obstructions = world.boxes.filter((b) => b.maxY > .001 && b.minY < DEFAULT_MOVE_CONFIG.height
        && Math.min(maxX, b.maxX) - Math.max(minX, b.minX) > 1e-7
        && Math.min(maxZ, b.maxZ) - Math.max(minZ, b.minZ) > 1e-7);
      expect(obstructions.map((b) => b.id), `${id}: narrowed clear strip`).toEqual([]);
      const radius = DEFAULT_MOVE_CONFIG.radius;
      for (let x = minX + radius; x <= maxX - radius + 1e-8; x += .5)
        for (let z = minZ + radius; z <= maxZ - radius + 1e-8; z += .5) {
          const boxes = nearby({ x, z });
          expect(supportUnder(x, z, radius, .01, boxes, 0), `${id}: floor ${x}/${z}`).toBeCloseTo(0, 8);
          expect(blockedAt(x, z, radius, 0, .05, DEFAULT_MOVE_CONFIG.height, boxes), `${id}: body ${x}/${z}`).toBe(false);
          bodies++;
        }
      // Include the far edge, even when a half-metre sampling step misses it.
      for (const x of [minX + radius, maxX - radius]) for (const z of [minZ + radius, maxZ - radius])
        expect(blockedAt(x, z, radius, 0, .05, DEFAULT_MOVE_CONFIG.height, nearby({ x, z })), `${id}: edge body`).toBe(false);
    }
    expect(bodies).toBeGreaterThan(3_000);
    console.log('U-172 required furniture clearances', JSON.stringify({ strips: STRIPS.length, bodies }));
  });

  for (const reverse of [false, true]) it(`circulates ${reverse ? 'backward' : 'forward'} on both sides of cover, machines and piers`, async () => {
    let ticks = 0;
    expect(nav.links()).toEqual([]);
    for (const trip of TRIPS) {
      const points = reverse ? [...trip.points].reverse() : trip.points, first = points[0]!;
      let state = { ...createMoveState(first.x, 0, first.z), grounded: true };
      const follower = new PathFollower(nav, world.boxes);
      for (const [i, point] of points.slice(1).entries()) {
        const goal = { ...point, y: 0 }, label = `${trip.id}/${i}/${reverse ? 'reverse' : 'forward'}`;
        const projected = nav.nearestPoint(goal)?.point;
        expect(projected, `${label}: missing nav`).toBeDefined();
        expect(Math.hypot(projected!.x - goal.x, projected!.z - goal.z), `${label}: relocated goal`).toBeLessThan(.1);
        expect(Math.abs(projected!.y), `${label}: wrong floor`).toBeLessThanOrEqual(.05002);
        const path = nav.path(state, goal);
        expect(completePathLength(path, state, goal), `${label}: no complete path`).not.toBeNull();
        expect(path!.vaults, label).toEqual([]);
        expect(path!.points.every((p) => Math.abs(p.y) <= .05002), `${label}: climbed a prop`).toBe(true);
        let arrived = false;
        for (let tick = 0; tick < 900; tick++) {
          const { input, status } = follower.step(state, { goal, pace: 'walk' }, 0);
          expect(input.jump, label).toBe(false);
          if (status === 'arrived') { arrived = true; break; }
          state = stepCharacter(state, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, nearby(state));
          const at = `${label} at ${JSON.stringify(state)}`;
          expect(state.vault, at).toBeNull();
          expect(state.grounded, at).toBe(true);
          expect(state.crouched || state.prone, at).toBe(false);
          expect(state.y, `${at}: left basement floor`).toBeCloseTo(0, 8);
          expect(blockedAt(state.x, state.z, DEFAULT_MOVE_CONFIG.radius, 0, .05, DEFAULT_MOVE_CONFIG.height, nearby(state)), at).toBe(false);
          if (++ticks % 256 === 0) await yieldWorker();
        }
        expect(arrived, `${label}: stalled at ${JSON.stringify(state)}`).toBe(true);
      }
    }
    console.log(`U-172 furniture ${reverse ? 'reverse' : 'forward'} controller`, JSON.stringify({ trips: TRIPS.length, ticks }));
  }, 120_000);

  it('rejects repeated jump/vault chains from actual low/high tops toward piers, walls and roofs', async () => {
    // Deliberately begin on supported prop tops, even high tops not reachable
    // from an ordinary floor jump. B9 requires crouching under its 3.6 m roof.
    const starts = [
      [-24, 1.1, 116, -24, 108], [-14.3, 2.2, 124, -10, 124],
      [-36, 1.1, 164, -44, 168], [-36, 1.1, 164, -28, 168],
      [-24, 2.2, 200, -28, 200], [-12, 2.2, 200, -8, 200], [3, 1.1, 234, 0, 234],
      [19, 2.2, 265, 22, 258], [19, 2.2, 265, 22, 270],
      [41, 2.2, 277, 38, 270], [41, 2.2, 277, 38, 282],
      [30, 1.1, 276, 22, 282], [30, 1.1, 276, 38, 282],
      [-22, 1, 312, -24, 312], [-22, 2.2, 346, -24, 346], [-6, 2.2, 346, -4, 346],
      [-12, 2.2, 367, -14, 367],
    ] as const;
    // Seal only the two legal lower endpoints, so a successful climb up the
    // intended stairs cannot be misreported as an escape. Keep every actual
    // roof and ceiling; stripping overhead boxes would invalidate this proof.
    const enclosed = [...world.boxes,
      { id: 'test-closed-B1-endpoint', kind: 'blocker' as const,
        minX: 3.9, maxX: 4.7, minZ: 94, maxZ: 98, minY: 0, maxY: 3 },
      { id: 'test-closed-B9-endpoint', kind: 'blocker' as const,
        minX: -10, maxX: -6, minZ: 375.9, maxZ: 376.7, minY: 0, maxY: 3 },
    ];
    let attempts = 0;
    for (const [x, y, z, targetX, targetZ] of starts) {
      const boxes = enclosed.filter((b) => b.maxX >= x - 28 && b.minX <= x + 28 && b.maxZ >= z - 28 && b.minZ <= z + 28);
      const allowed = boxes.filter((b) => b.maxY >= 0 && b.maxY <= 2.200001);
      expect(supportUnder(x, z, DEFAULT_MOVE_CONFIG.radius, y + .01, boxes, 0), `unsupported escape start ${x}/${y}/${z}`).toBeCloseTo(y, 8);
      const crouched = z === 367;
      expect(blockedAt(x, z, DEFAULT_MOVE_CONFIG.radius, y, .05,
        crouched ? DEFAULT_MOVE_CONFIG.crouchHeight : DEFAULT_MOVE_CONFIG.height, boxes), `obstructed start ${x}/${y}/${z}`).toBe(false);
      const toward = yawToward(targetX - x, targetZ - z);
      for (const offset of [-128, 0, 128, 512]) for (const stance of ['jump', 'crouch', 'prone']) {
        let state = { ...createMoveState(x, y, z), grounded: true, crouched };
        for (let tick = 0; tick < 180; tick++) {
          // The second push turns across the first target: a chained attempt
          // cannot pass merely because the first jump stops at a pier face.
          const direction = (toward + offset + (tick >= 60 ? 128 : 0) + 1024) % 1024;
          state = stepCharacter(state, { moveX: 0, moveY: tick < 120 ? 1 : 0, yaw: direction,
            sprint: tick < 120, jump: tick < 120 && stance === 'jump',
            crouch: tick < 120 && stance === 'crouch', prone: tick < 120 && stance === 'prone' },
          TICK_SECONDS, DEFAULT_MOVE_CONFIG, boxes);
          const label = `${x}/${y}/${z}/${offset}/${stance}/${tick} at ${JSON.stringify(state)}`;
          expect(state.y, `${label}: reached surface`).toBeLessThan(5.5);
          if (state.grounded) {
            expect(state.y, `${label}: landed on structural pier/roof`).toBeCloseTo(
              supportUnder(state.x, state.z, DEFAULT_MOVE_CONFIG.radius, state.y + .01, allowed, 0), 6);
            expect(state.y, `${label}: unintended high top`).toBeLessThanOrEqual(2.200001);
          }
          if (tick % 60 === 0) {
            const roof = rayWorld({ origin: { x: state.x, y: state.y + .1, z: state.z },
              direction: { x: 0, y: 1, z: 0 }, maxDistance: 10 }, boxes);
            expect(roof, `${label}: lost enclosing roof`).not.toBeNull();
          }
        }
        expect(state.grounded, `escape attempt failed to settle ${JSON.stringify(state)}`).toBe(true);
        attempts++;
      }
      await yieldWorker();
    }
    expect(attempts).toBe(204);
    console.log('U-172 chained furniture escapes', JSON.stringify({ starts: starts.length, attempts, ticksPerAttempt: 180 }));
  }, 120_000);
});
