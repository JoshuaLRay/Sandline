/**
 * The bake half of the T-3.01 spike: Recast bakes the hand-built soup in
 * Node, Detour exports it, and those bytes are what `spikeMesh.ts` commits.
 * Re-baking reproduces them exactly (same engine, same input), so a stale
 * fixture — geometry or agent edited without `pnpm gen:nav-spike` — fails here
 * rather than silently testing an old mesh in every browser.
 */
import { describe, expect, it } from 'vitest';
import { NavMesh, initNav, pathLength } from '../../../server/src/ai/nav/NavMesh.ts';
import { SPIKE_MESH_BASE64, SPIKE_NODE_PATH_LENGTH } from '../../../server/src/ai/nav/spikeMesh.ts';
import { SPIKE_BOXES, SPIKE_FLOOR_HALF_EXTENT, SPIKE_FROM, SPIKE_TO, bakeNavMesh, boxSoup } from './bake.ts';

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
