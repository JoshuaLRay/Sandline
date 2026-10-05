/**
 * U-125: no walkable navmesh inside a solid box (§14.2.7). Boxes are solid to
 * the controller, so a polygon inside one is ground nobody can stand on: an
 * island a nearest-point query can snap a spawn, a goal or a cover search into.
 */
import { describe, expect, it } from 'vitest';
import { type World, loadWorld, requireWorld } from '@sandline/shared';
import { initNav, NavMesh } from '../../../server/src/ai/nav/NavMesh.ts';
import { loadWorldNavMesh } from '../../../server/src/ai/nav/bakedNav.ts';
import { BAKED_NAV } from '../../../server/src/ai/nav/baked/index.ts';
import { DEFAULT_NAV_AGENT, bakeNavMesh, bakeWorld, navConfigFor, worldSoup } from './bake.ts';
import { bakeSolidNavMesh } from './solidBake.ts';

/**
 * Polygons wholly inside a box: every corner within its footprint, and the
 * polygon from its base to below its top. (A polygon that only straddles the
 * edge of a step it climbs onto is not inside it.)
 */
function interiorPolygons(mesh: NavMesh, world: World): string[] {
  const found: string[] = [];
  for (const poly of mesh.polygons()) {
    const c = poly.centre;
    const box = world.boxes.find((b) => c.y >= b.minY - 0.1 && c.y < b.maxY - 0.1 &&
      poly.corners.every((p) => p.x >= b.minX - 0.01 && p.x <= b.maxX + 0.01 && p.z >= b.minZ - 0.01 && p.z <= b.maxZ + 0.01));
    if (box) found.push(`${box.id} @ (${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)})`);
  }
  return found;
}
const tight = { x: 0.2, y: 0.2, z: 0.2 };
async function bake(world: World): Promise<NavMesh> {
  await initNav();
  return NavMesh.load(await bakeWorld(world));
}

describe('solid box interiors (U-125)', () => {
  it('bakes the top of a solid block and the ground round it, but nothing inside it', async () => {
    const world = loadWorld({ id: 'solid-block', floor: { halfExtent: 20 }, cover: [{ id: 'block', x: 0, y: 0, z: 0, w: 10, d: 10, h: 6 }] });
    const mesh = await bake(world);
    try {
      expect(interiorPolygons(mesh, world)).toEqual([]);
      expect(mesh.nearestPoint({ x: 0, y: 0, z: 0 }, tight)).toBeNull();
      expect(mesh.nearestPoint({ x: 0, y: 6, z: 0 }, tight)?.point.y).toBeCloseTo(6.05, 1);
      expect(mesh.nearestPoint({ x: 8, y: 0, z: 0 }, tight)?.point.y).toBeCloseTo(0.05, 1);
    } finally { mesh.destroy(); }
  });

  it('keeps a basement under a raised slab and the slab top, but not the inside of a wall standing on it', async () => {
    const world = loadWorld({ id: 'solid-stack', floor: { halfExtent: 20 }, cover: [
      { id: 'slab', x: 0, y: 5.5, z: 0, w: 16, d: 16, h: 2.5 },
      { id: 'tower', x: 3, y: 8, z: 3, w: 4, d: 4, h: 6 },
      // A box sunk into the slab: the slab's top runs through its inside.
      { id: 'sunk', x: -3, y: 6, z: -3, w: 4, d: 4, h: 5 },
    ] });
    const mesh = await bake(world);
    try {
      expect(interiorPolygons(mesh, world)).toEqual([]);
      expect(mesh.nearestPoint({ x: 3, y: 8, z: 3 }, tight)).toBeNull();
      expect(mesh.nearestPoint({ x: -3, y: 8, z: -3 }, tight)).toBeNull();
      expect(mesh.nearestPoint({ x: 3, y: 0, z: 3 }, tight)?.point.y).toBeCloseTo(0.05, 1);
      expect(mesh.nearestPoint({ x: -5, y: 8, z: 5 }, tight)?.point.y).toBeCloseTo(8.05, 1);
      for (const [x, z] of [[3, 3], [-3, -3]] as const) expect(mesh.nearestPoint({ x, y: 14, z }, tight) ?? mesh.nearestPoint({ x, y: 11, z }, tight)).not.toBeNull();
    } finally { mesh.destroy(); }
  });

  it('still walks through a doorway between two wall boxes under a lintel', async () => {
    const world = loadWorld({ id: 'solid-door', floor: { halfExtent: 20 }, cover: [
      { id: 'wall-w', x: -5.6, y: 0, z: 0, w: 10, d: 0.3, h: 3 },
      { id: 'wall-e', x: 5.6, y: 0, z: 0, w: 10, d: 0.3, h: 3 },
      { id: 'lintel', x: 0, y: 2.2, z: 0, w: 1.2, d: 0.3, h: 0.8 },
    ] });
    const mesh = await bake(world);
    try {
      const path = mesh.path({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 5 });
      expect(path?.points.at(-1)?.z).toBeCloseTo(5, 1);
      expect(path!.points.every((p) => p.y < 0.2)).toBe(true);
    } finally { mesh.destroy(); }
  });

  it('runs the library pipeline byte for byte when no box is solid', async () => {
    const world = loadWorld({ id: 'solid-same', floor: { halfExtent: 15 }, cover: [
      { id: 'slab', x: 0, y: 5.5, z: 0, w: 10, d: 10, h: 2.5 },
      { id: 'crate', x: 8, y: 0, z: 8, w: 1.2, d: 1.2, h: 1.2 },
      { id: 'wall', x: -8, y: 0, z: 0, w: 0.3, d: 10, h: 3 },
    ] });
    const soup = worldSoup(world, DEFAULT_NAV_AGENT.groundY);
    expect(await bakeSolidNavMesh(soup, [], navConfigFor(DEFAULT_NAV_AGENT))).toEqual(await bakeNavMesh(soup, navConfigFor(DEFAULT_NAV_AGENT)));
  }, 60_000);

  it('leaves no polygon inside any box of a committed world', async () => {
    await initNav();
    const found: Record<string, string[]> = {};
    for (const id of Object.keys(BAKED_NAV)) {
      const mesh = loadWorldNavMesh(id);
      try {
        const inside = interiorPolygons(mesh, requireWorld(id));
        if (inside.length > 0) found[id] = inside.slice(0, 5).concat(inside.length > 5 ? [`… ${inside.length} in all`] : []);
      } finally { mesh.destroy(); }
    }
    expect(found).toEqual({});
  });
});
