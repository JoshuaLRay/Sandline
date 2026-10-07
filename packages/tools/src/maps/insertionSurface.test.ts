import { describe, expect, it } from 'vitest';
import { insertionSurface } from './insertionSurface.ts';

describe('construction render surface from solid box union', () => {
  it('keeps exposed faces and removes the interior boundary between adjacent rock strata', () => {
    const surface = insertionSurface([
      { id: 'west', x: -1, y: 0, z: 0, w: 2, h: 3, d: 2 },
      { id: 'east', x: 1, y: 0, z: 0, w: 2, h: 3, d: 2 },
    ]);
    for (let i = 0; i < surface.positions.length; i += 3) {
      if (surface.normals[i] !== 0) expect(surface.positions[i]).not.toBe(0);
    }
    expect(surface.indices.length / 3).toBe(20);
    expect(surface.positions.every(Number.isFinite)).toBe(true);
  });
  it('owns overlapping coplanar faces once and preserves a suspended canopy underside', () => {
    const box = { id: 'rock', x: 0, y: 0, z: 0, w: 4, h: 4, d: 4 };
    expect(insertionSurface([box, { ...box, id: 'overlapping-core' }]).indices.length / 3).toBe(12);
    const canopy = insertionSurface([{ id: 'roof', x: 0, y: 13, z: 0, w: 26, h: 1.2, d: 30 }]);
    expect(canopy.positions.some((y, i) => i % 3 === 1 && y === 13 && canopy.normals[i] === -1)).toBe(true);
    expect(Math.max(...canopy.indices)).toBeLessThan(canopy.positions.length / 3);
  });
});
