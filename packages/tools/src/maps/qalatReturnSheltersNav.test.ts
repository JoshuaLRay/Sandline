import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MOVE_CONFIG, TICK_SECONDS, createMoveState, stepCharacter } from '@sandline/shared';
import { NavMesh, completePathLength, initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { PathFollower } from '../../../server/src/ai/locomotion/followPath.ts';
import { bakeRoadSupportNav } from './qalatRoadNav.ts';
import { buildRoadSupportWorld } from './qalatRoadSupports.ts';

// Independent construction coordinates: changing authoring must not silently
// move the holding alcove, narrow its entrance, or cut the original escapes.
const HOLD = { x: 50, y: 8, z: 58 };
const COURT = { x: 32, y: 8, z: 64 };
const S3A = { x: 48, y: 8, z: 46.75 };
const S3 = { x: 12, y: 8, z: 44 };
const DEPOT = { x: 12, y: 8, z: 68 };
const world = buildRoadSupportWorld();
let nav: NavMesh;
const yieldWorker = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('U-152 return-store travel on the actual tiled standing nav bake', () => {
  beforeAll(async () => {
    await initNav();
    nav = NavMesh.load(await bakeRoadSupportNav(world));
  }, 180_000);
  afterAll(() => nav?.destroy());

  it('projects the screened hold to floor 8 and adds no synthetic connections', () => {
    expect(nav.nearestPoint(HOLD)?.point.y).toBeCloseTo(8.05, 2);
    expect(nav.links()).toEqual([]);
    const roof = { x: 50, y: 12.6, z: 58 };
    expect(nav.nearestPoint(roof)?.point.y).toBeCloseTo(12.65, 2);
    expect(completePathLength(nav.path(HOLD, roof), HOLD, roof)).toBeNull();
  });

  for (const stops of [[HOLD, COURT, S3A, S3, S3A, COURT, HOLD], [HOLD, COURT, DEPOT, COURT, HOLD]])
    it(`walks the store door, D0 and ${stops.includes(S3) ? 'S3 retreat' : 'depot connection'} in both directions`, async () => {
      let state = createMoveState(stops[0]!.x, 8, stops[0]!.z);
      const follower = new PathFollower(nav, world.boxes);
      for (const goal of stops.slice(1)) {
        expect(completePathLength(nav.path(state, goal), state, goal), `no complete path ${JSON.stringify(state)} → ${JSON.stringify(goal)}`).not.toBeNull();
        let arrived = false;
        for (let tick = 0; tick < 1500; tick++) {
          const { input, status } = follower.step(state, { goal, pace: 'walk' }, 0);
          if (status === 'arrived') { arrived = true; break; }
          state = stepCharacter(state, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, world.boxes);
          expect(state.y).toBeCloseTo(8); expect(state.vault).toBeNull();
          if (tick % 256 === 0) await yieldWorker();
        }
        expect(arrived, `controller stalled ${JSON.stringify(state)} toward ${JSON.stringify(goal)}`).toBe(true);
      }
    }, 60_000);
});
