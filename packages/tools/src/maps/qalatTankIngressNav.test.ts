import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, TICK_SECONDS, createMoveState, stepCharacter,
} from '@sandline/shared';
import { NavMesh, completePathLength, initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { PathFollower } from '../../../server/src/ai/locomotion/followPath.ts';
import { INSERTION } from './qalatInsertion.ts';
import { bakeRoadSupportNav } from './qalatRoadNav.ts';
import { buildRoadSupportWorld, onRoadSupportFloor } from './qalatRoadSupports.ts';
import { TANK_INGRESS, onTankIngressFloor } from './qalatTankIngress.ts';

// Independent §11.1 coordinates: the test must fail if authoring moves X0
// forward or adds a convenient extra approach.
const APPROVED_X = [
  { id: 'X0', x: 96, y: 8, z: 444 }, { id: 'X1', x: 114, y: 8, z: 432 },
  { id: 'X2', x: 112, y: 8, z: 386 }, { id: 'X3', x: 104, y: 8, z: 350 },
  { id: 'X4', x: 84, y: 8, z: 338 }, { id: 'X5', x: 54, y: 8, z: 334 },
  { id: 'X6', x: 16, y: 8, z: 332 },
];
const world = buildRoadSupportWorld();
const yieldWorker = () => new Promise<void>((resolve) => setImmediate(resolve));
let nav: NavMesh, sealed: NavMesh;

describe('U-151 actual infantry service-spur travel', () => {
  beforeAll(async () => {
    await initNav();
    nav = NavMesh.load(await bakeRoadSupportNav(world));
    // A geometric cut immediately east of A8 severs only its X throat. Both
    // sides retain their actual floors, terrain, shelter and standing mesh.
    // If any fourth approach exists, the complete path still succeeds.
    sealed = NavMesh.load(await bakeRoadSupportNav({ ...world, boxes: [...world.boxes, {
      id: 'test-seal-X-mouth', minX: 37, maxX: 39, minY: 5.5, maxY: 38, minZ: 314, maxZ: 358,
    }] }));
  }, 180_000);
  afterAll(() => { nav?.destroy(); sealed?.destroy(); });

  it('keeps the approved nodes and uses no synthetic links', () => {
    expect(TANK_INGRESS.spine).toEqual(APPROVED_X);
    expect(nav.links()).toEqual([]);
  });

  for (const outward of [true, false]) it(`walks every X bend ${outward ? 'from A8 to X0' : 'back to A8'}`, async () => {
    const stops = outward ? [...APPROVED_X].reverse() : APPROVED_X;
    let state = createMoveState(stops[0]!.x, 8, stops[0]!.z);
    const follower = new PathFollower(nav, world.boxes);
    for (const goal of stops.slice(1)) {
      expect(completePathLength(nav.path(state, goal), state, goal)).not.toBeNull();
      let arrived = false;
      for (let tick = 0; tick < 1500; tick++) {
        const { input, status } = follower.step(state, { goal, pace: 'walk' }, 0);
        if (status === 'arrived') { arrived = true; break; }
        state = stepCharacter(state, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, world.boxes);
        expect(Math.abs(state.y - 8)).toBeLessThan(.05);
        expect(state.vault).toBeNull();
        expect(onTankIngressFloor(state, .05) || onRoadSupportFloor(state, .05)).toBe(true);
        if (tick % 256 === 0) await yieldWorker();
      }
      expect(arrived, `stalled at ${JSON.stringify(state)} toward ${goal.id}`).toBe(true);
    }
  }, 60_000);

  it('connects the forecourt through A8, then loses all road/start access when only that throat is sealed', () => {
    const x0 = APPROVED_X[0]!, a8 = APPROVED_X.at(-1)!;
    const gate = { x: 32, y: 8, z: 356 };
    expect(completePathLength(nav.path(a8, x0), a8, x0)).toBeGreaterThan(120);
    expect(completePathLength(nav.path(gate, x0), gate, x0)).toBeGreaterThan(140);
    expect(sealed.nearestPoint(a8)?.point.y).toBeCloseTo(8.05, 2);
    expect(sealed.nearestPoint(x0)?.point.y).toBeCloseTo(8.05, 2);
    for (const from of [a8, gate, INSERTION.squadStarts[0]!]) {
      expect(completePathLength(sealed.path(from, x0), from, x0), `fourth approach from ${JSON.stringify(from)}`).toBeNull();
    }
  });
});
