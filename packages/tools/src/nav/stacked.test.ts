import { describe, expect, it } from 'vitest';
import { loadWorld } from '@sandline/shared';
import { initNav, NavMesh } from '../../../server/src/ai/nav/NavMesh.ts';
import { bakeWorld } from './bake.ts';

async function fixture(ceiling: number) {
  const world = loadWorld({
    id: 'stacked-headroom', floor: { halfExtent: 20 },
    cover: [
      { id: 'surface', x: 0, y: ceiling, z: 0, w: 16, d: 16, h: 8 - ceiling },
      { id: 'bridge', x: 0, y: 14, z: 0, w: 10, d: 10, h: 2 },
    ],
  });
  await initNav();
  return NavMesh.load(await bakeWorld(world));
}
const extents = { x: .2, y: .2, z: .2 };

describe('stacked-floor bake headroom (U-120)', () => {
  it('rejects a low basement ceiling while keeping the surface and bridge walkable', async () => {
    const mesh = await fixture(1.5);
    try {
      expect(mesh.nearestPoint({ x: 0, y: 0, z: 0 }, extents)).toBeNull();
      for (const y of [8, 16]) expect(mesh.nearestPoint({ x: 0, y, z: 0 }, extents)?.point.y).toBeCloseTo(y + .05, 1);
    } finally { mesh.destroy(); }
  });

  it('keeps a full-height basement under the surface slab and a separate bridge layer', async () => {
    const mesh = await fixture(5.5);
    try {
      for (const y of [0, 8, 16]) {
        expect(mesh.nearestPoint({ x: 0, y, z: 0 }, extents)?.point.y).toBeCloseTo(y + .05, 1);
        const path = mesh.path({ x: -2, y, z: 0 }, { x: 2, y, z: 0 });
        expect(path).not.toBeNull();
        expect(path!.points.every((p) => Math.abs(p.y - y) < .15)).toBe(true);
      }
      // No navigable interior or underside, and no implicit upward connection.
      for (const y of [5.5, 6.5, 14, 15]) expect(mesh.nearestPoint({ x: 0, y, z: 0 }, extents)).toBeNull();
      const path = mesh.path({ x: 0, y: 0, z: 0 }, { x: 0, y: 8, z: 0 });
      expect(path?.points.at(-1)?.y ?? 0).toBeLessThan(1);
    } finally { mesh.destroy(); }
  });
});
