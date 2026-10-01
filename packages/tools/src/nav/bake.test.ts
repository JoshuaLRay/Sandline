/**
 * The bake half of the T-3.01 spike: Recast bakes the hand-built soup in
 * Node, Detour exports it, and those bytes are what `spikeMesh.ts` commits.
 * Re-baking reproduces them exactly (same engine, same input), so a stale
 * fixture — geometry or agent edited without `pnpm gen:nav-spike` — fails here
 * rather than silently testing an old mesh in every browser.
 */
import { describe, expect, it } from 'vitest';
import { loadWorld, requireWorld } from '@sandline/shared';
import { NavMesh, initNav, pathLength } from '../../../server/src/ai/nav/NavMesh.ts';
import { SPIKE_MESH_BASE64, SPIKE_NODE_PATH_LENGTH } from '../../../server/src/ai/nav/spikeMesh.ts';
import { DEFAULT_NAV_AGENT, SPIKE_BOXES, SPIKE_FLOOR_HALF_EXTENT, SPIKE_FROM, SPIKE_TO, bakeNavMesh, bakeWorld, boxSoup, navBakeHash, onMesh, worldSoup } from './bake.ts';

describe('navmesh bake (T-3.01)', () => {
  it('builds a closed soup: floor plus ten triangles per box', () => {
    const soup = boxSoup(SPIKE_FLOOR_HALF_EXTENT, SPIKE_BOXES);
    expect(soup.indices.length / 3).toBe(2 + 10 * SPIKE_BOXES.length);
    const vertices = soup.positions.length / 3;
    expect(soup.indices.every((i) => i >= 0 && i < vertices)).toBe(true);
  });

  it('reproduces the committed spike bytes exactly, and they path as committed', async () => {
    const bytes = await bakeNavMesh(boxSoup(SPIKE_FLOOR_HALF_EXTENT, SPIKE_BOXES));
    expect(Buffer.from(bytes).toString('base64')).toBe(SPIKE_MESH_BASE64);

    await initNav();
    const mesh = NavMesh.load(bytes);
    const path = mesh.path(SPIKE_FROM, SPIKE_TO);
    expect(path).not.toBeNull();
    expect(pathLength(path!.points)).toBe(SPIKE_NODE_PATH_LENGTH);
    mesh.destroy();
  });

  it('fails loudly on a soup with nothing walkable', async () => {
    await expect(bakeNavMesh({ positions: [], indices: [] })).rejects.toThrow(/bake failed/);
  });
});

describe('a rectangular floor (U-082)', () => {
  // 20 m wide, 100 m long: a lane. A square floor of the longer side would be 100 m across.
  const lane = loadWorld({ id: 'lane', floor: { halfWidth: 10, halfDepth: 50 }, cover: [{ id: 'crate', x: 0, y: 0, z: 0, w: 2, h: 1, d: 2 }] });

  it('is a rectangle in the soup, and a square floor is the same soup it always was', () => {
    const soup = worldSoup(lane, 0);
    expect(soup.positions.slice(0, 12)).toEqual([-10, 0, -50, 10, 0, -50, 10, 0, 50, -10, 0, 50]);
    expect(boxSoup(7, []).positions).toEqual([-7, 0, -7, 7, 0, -7, 7, 0, 7, -7, 0, 7]);
    expect(boxSoup({ halfWidth: 7, halfDepth: 7 }, []).positions).toEqual(boxSoup(7, []).positions);
  });

  it('bakes a mesh over the rectangle only: the length is walkable and the ground beside it is not', async () => {
    await initNav();
    const mesh = NavMesh.load(await bakeWorld(lane));
    try {
      expect(mesh.path({ x: 5, y: 0, z: -45 }, { x: -5, y: 0, z: 45 })).not.toBeNull();
      expect(onMesh(mesh, { x: 0, y: 0, z: -48 }, DEFAULT_NAV_AGENT.climb)).toBe(true);
      // Past the width, where a square floor of the longer side would have walkable ground.
      expect(onMesh(mesh, { x: 30, y: 0, z: 0 }, DEFAULT_NAV_AGENT.climb)).toBe(false);
      expect(onMesh(mesh, { x: 0, y: 0, z: 60 }, DEFAULT_NAV_AGENT.climb)).toBe(false);
    } finally {
      mesh.destroy();
    }
  });

  it('hashes a rectangle differently from a square, and a square as it always has', () => {
    const square = loadWorld({ id: 'lane', floor: { halfExtent: 50 }, cover: [{ id: 'crate', x: 0, y: 0, z: 0, w: 2, h: 1, d: 2 }] });
    expect(navBakeHash(lane)).not.toBe(navBakeHash(square));
    // The committed worlds' hashes (checked against their committed bakes by the nav tests) do not move.
    for (const id of ['range', 'greybox-01', 'kit-gallery', 'mission-01']) {
      const world = requireWorld(id);
      expect(world.floorHalfWidth).toBe(world.floorHalfDepth);
    }
  });
});
