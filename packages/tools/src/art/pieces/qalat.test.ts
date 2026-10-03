import { describe, expect, it } from 'vitest';
import { buildPiece } from '../piece.ts';
import { QALAT_GROUND, QALAT_DETAIL, QALAT_BANK_ROCK, qalatFragments, qalatTint, terrainHeight } from './qalat.ts';

describe('U-096 Qalat authored surfaces and route-safe dressing', () => {
  it('skins only supporting terrain; every upward face remains within 1.3 cm of its plane', () => {
    const mesh = buildPiece(QALAT_GROUND);
    expect(mesh.collision).toEqual([]);
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const indices = mesh.indices.slice(i, i + 3);
      if (mesh.normals[indices[0]! * 3 + 1]! < .9) continue;
      const x = indices.reduce((sum, n) => sum + mesh.positions[n * 3]!, 0) / 3;
      const z = indices.reduce((sum, n) => sum + mesh.positions[n * 3 + 2]!, 0) / 3;
      const y = mesh.positions[indices[0]! * 3 + 1]!;
      // Base floor is also drawn below elevated earth, never above the walkable plane.
      expect(y).toBeLessThanOrEqual(terrainHeight(x, z) + .013);
      expect(y === .012 || Math.abs(y - terrainHeight(x, z) - .012) < 1e-6).toBe(true);
    }
  });

  it('gives the river, road, winter fields and compound distinct palettes', () => {
    const colours = [[-41, 0, 60], [0, 0, 60], [41, 1, 60], [0, 0, 182]].map(([x, y, z]) => qalatTint(x!, y!, z!));
    for (let i = 0; i < colours.length; i++) for (let j = i + 1; j < colours.length; j++) {
      expect(colours[i]!.reduce((sum, c, k) => sum + Math.abs(c - colours[j]![k]!), 0)).toBeGreaterThan(.1);
    }
  });

  it('keeps clustered scrub/gravel low, on supporting planes, and outside the tank corridor', () => {
    const fragments = qalatFragments();
    expect(fragments.length).toBeGreaterThan(150);
    for (const p of fragments) {
      expect(Math.abs(p.x)).toBeGreaterThanOrEqual(13);
      expect(p.y).toBe(terrainHeight(p.x, p.z));
      expect(p.height).toBeLessThan(.18);
    }
    expect(buildPiece(QALAT_DETAIL).collision).toEqual([]);
    // The only added physical rock is under the normal 0.45 m step height.
    const rock = buildPiece(QALAT_BANK_ROCK);
    expect(rock.collision).toEqual([{ min: [-1, 0, -.7], max: [1, .4, .7] }]);
    for (let i = 1; i < rock.normals.length; i += 3) expect(rock.normals[i]).toBeGreaterThan(0);
  });
});
