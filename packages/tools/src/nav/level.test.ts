/**
 * The navmesh and cover bake from a level as from a world (T-4.09): a level
 * whose only solid is a kit piece, turned a quarter, bakes a mesh with a
 * hole where the wall stands and cover points along it — from the boxes the
 * piece brought, with no change to the bake.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadLevel } from '@sandline/shared';
import { NavMesh, initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { DEFAULT_NAV_AGENT, bakeWorld, navBakeHash, onMesh } from './bake.ts';
import { coverPoints } from './cover.ts';

const yard = (rot: number) =>
  loadLevel({ id: 'yard', format: 1, floor: { halfExtent: 12 }, pieces: [{ id: 'w', piece: 'wall-plaster-4m', x: 0, z: 0, rot }] });

describe('a level bakes as a world does (T-4.09)', () => {
  beforeAll(() => initNav());

  it('a turned wall piece cuts the mesh where it stands, and gives cover along it', async () => {
    const world = yard(90);
    const mesh = NavMesh.load(await bakeWorld(world));
    const climb = DEFAULT_NAV_AGENT.climb;
    // Turned 90°, the 4 m run lies along z at x = 0.
    expect(onMesh(mesh, { x: 0, y: 0, z: 0 }, climb)).toBe(false);
    expect(onMesh(mesh, { x: 0, y: 0, z: 1.5 }, climb)).toBe(false);
    expect(onMesh(mesh, { x: 1.5, y: 0, z: 0 }, climb)).toBe(true);
    expect(onMesh(mesh, { x: -1.5, y: 0, z: 0 }, climb)).toBe(true);
    const cover = coverPoints(world, DEFAULT_NAV_AGENT, (p) => onMesh(mesh, p, climb));
    mesh.destroy();
    expect(cover.length).toBeGreaterThan(0);
    // Every cover point sits beside the wall, on one of its long faces.
    for (const c of cover) expect(Math.abs(c.z)).toBeLessThanOrEqual(2.5);
  });

  it('a turn changes the bake’s hash, so a level edited without a re-bake fails as a world does', () => {
    expect(navBakeHash(yard(0))).not.toBe(navBakeHash(yard(90)));
    expect(navBakeHash(yard(90))).toBe(navBakeHash(yard(90)));
  });
});
