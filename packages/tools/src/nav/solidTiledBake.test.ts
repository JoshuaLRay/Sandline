import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, TICK_SECONDS, createMoveState, loadWorld, stepCharacter,
} from '@sandline/shared';
import { NavMesh, completePathLength, initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { PathFollower } from '../../../server/src/ai/locomotion/followPath.ts';
import { DEFAULT_NAV_AGENT, navConfigFor, worldSolids, worldSoup } from './bake.ts';
import { bakeSolidNavMesh, bakeSolidTiledNavMesh } from './solidBake.ts';

describe('solid nav bake bounds and tiled seams (U-151)', () => {
  it('crops raster bounds without changing the soup or admitting a solid interior', async () => {
    await initNav();
    const world = loadWorld({ id: 'solid-crop', floor: { halfExtent: 100 }, cover: [
      { id: 'block', x: 0, y: 0, z: 0, w: 4, d: 4, h: 6 },
    ] });
    const soup = worldSoup(world), original = [...soup.positions];
    const mesh = NavMesh.load(await bakeSolidNavMesh(soup, worldSolids(world), {
      ...navConfigFor(DEFAULT_NAV_AGENT), bounds: [[-10, 0, -10], [10, 6, 10]],
    }));
    try {
      expect(soup.positions).toEqual(original);
      expect(mesh.nearestPoint({ x: 0, y: 0, z: 0 }, { x: .2, y: .2, z: .2 })).toBeNull();
      expect(mesh.nearestPoint({ x: 30, y: 0, z: 0 })).toBeNull();
      expect(completePathLength(mesh.path({ x: -8, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }), { x: -8, y: 0, z: 0 }, { x: 8, y: 0, z: 0 })).toBeGreaterThan(16);
    } finally { mesh.destroy(); }
  });

  it('walks through adjoining tiles around a solid wall and rejects low headroom across a seam', async () => {
    await initNav();
    const world = loadWorld({ id: 'solid-tiles', floor: { halfExtent: 24 }, cover: [
      { id: 'wall', x: 0, y: 0, z: -5, w: 2, d: 26, h: 6 },
      { id: 'low-roof', x: 10, y: 1.5, z: 10, w: 10, d: 6, h: 1 },
    ] });
    const mesh = NavMesh.load(await bakeSolidTiledNavMesh(worldSoup(world), worldSolids(world), {
      ...navConfigFor(DEFAULT_NAV_AGENT), tileSize: 128,
    }));
    try {
      const start = { x: -20, y: 0, z: -10 }, goal = { x: 20, y: 0, z: -10 };
      expect(completePathLength(mesh.path(start, goal), start, goal)).toBeGreaterThan(42);
      expect(mesh.nearestPoint({ x: 0, y: 0, z: 0 }, { x: .2, y: .2, z: .2 })).toBeNull();
      expect(mesh.nearestPoint({ x: 10, y: 0, z: 10 }, { x: .2, y: .2, z: .2 })).toBeNull();
      const follower = new PathFollower(mesh, world.boxes);
      let state = createMoveState(start.x, 0, start.z), arrived = false;
      for (let tick = 0; tick < 1800; tick++) {
        const { input, status } = follower.step(state, { goal, pace: 'walk' }, 0);
        if (status === 'arrived') { arrived = true; break; }
        state = stepCharacter(state, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, world.boxes);
        expect(state.y).toBe(0);
        expect(state.vault).toBeNull();
      }
      expect(arrived, `seam travel stopped at ${JSON.stringify(state)}`).toBe(true);
    } finally { mesh.destroy(); }
  }, 60_000);
});
