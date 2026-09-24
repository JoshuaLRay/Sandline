/**
 * The art generators (T-4.04, ADR-018): every committed generated source is
 * exactly what its generator writes now; a piece's collision is the shape
 * you see; every UV stays inside its surface's cell; the atlas tiles.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSET_MANIFEST, KIT, checkBudgets } from '@sandline/shared';
import { createIO, sha256 } from '../assets/pipeline.ts';
import { cellRect, paintAtlas } from './atlas.ts';
import { KIT_A } from './families.ts';
import { MeshBuilder } from './mesh.ts';
import { buildPiece, pieceDocument } from './piece.ts';
import { PIECES } from './pieces/index.ts';

const REPO = new URL('../../../../', import.meta.url);

describe('generated pieces (T-4.04)', () => {
  for (const piece of PIECES) {
    describe(`'${piece.id}'`, () => {
      it('is committed exactly as its generator writes it — else run pnpm gen:art && pnpm gen:assets', async () => {
        const io = await createIO();
        const fresh = await io.writeBinary(pieceDocument(piece));
        const committed = new Uint8Array(readFileSync(new URL(`assets/src/${piece.id}.glb`, REPO)));
        expect(sha256(committed), `'${piece.id}' is stale — run pnpm gen:art && pnpm gen:assets`).toBe(sha256(fresh));
      });

      it('collides where it is seen: the collision boxes bound exactly the mesh', () => {
        const mesh = buildPiece(piece);
        if (piece.decal) {
          // A decal is drawn and collides with nothing, by design.
          expect(mesh.collision).toEqual([]);
          return;
        }
        const lo = [Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < mesh.positions.length; i++) {
          lo[i % 3] = Math.min(lo[i % 3]!, mesh.positions[i]!);
          hi[i % 3] = Math.max(hi[i % 3]!, mesh.positions[i]!);
        }
        const cLo = [0, 1, 2].map((a) => Math.min(...mesh.collision.map((c) => c.min[a]!)));
        const cHi = [0, 1, 2].map((a) => Math.max(...mesh.collision.map((c) => c.max[a]!)));
        expect(mesh.collision.length).toBeGreaterThan(0);
        for (let a = 0; a < 3; a++) {
          expect(cLo[a]).toBeCloseTo(lo[a]!, 6);
          expect(cHi[a]).toBeCloseTo(hi[a]!, 6);
        }
        // And every vertex is inside some collision box: nothing drawn is outside what collides.
        for (let v = 0; v < mesh.positions.length / 3; v++) {
          const p = [mesh.positions[v * 3]!, mesh.positions[v * 3 + 1]!, mesh.positions[v * 3 + 2]!];
          const inside = mesh.collision.some((c) => p.every((x, a) => x >= c.min[a]! - 1e-6 && x <= c.max[a]! + 1e-6));
          expect(inside, `vertex ${p} is outside every collision box`).toBe(true);
        }
      });

      it('is in the manifest, within its budget, with its collision', () => {
        const entry = ASSET_MANIFEST.assets.find((a) => a.id === piece.id);
        expect(entry, `'${piece.id}' is not in the manifest — run pnpm gen:assets`).toBeDefined();
        expect(entry!.class).toBe(piece.class);
        expect(checkBudgets({ version: 1, assets: [entry!] })).toEqual([]);
        expect(entry!.collision).toEqual(buildPiece(piece).collision);
      });

      it('keeps every UV inside the cell of its surface', () => {
        const mesh = buildPiece(piece);
        const rects = Object.keys(piece.family.surfaces).map((s) => cellRect(piece.family, s));
        for (let i = 0; i < mesh.uvs.length; i += 2) {
          const [u, v] = [mesh.uvs[i]!, mesh.uvs[i + 1]!];
          const inside = rects.some((r) => u >= r.u0 - 1e-6 && u <= r.u1 + 1e-6 && v >= r.v0 - 1e-6 && v <= r.v1 + 1e-6);
          expect(inside, `uv (${u}, ${v}) is outside every cell`).toBe(true);
        }
      });
    });
  }

  it('the kit file lists exactly the generated pieces (T-4.10)', () => {
    expect(KIT.map((p) => p.id).sort()).toEqual(PIECES.map((p) => p.id).sort());
  });

  it('the wall: 88 triangles, three collision boxes, plinth and coping proud of the plaster', () => {
    const wall = buildPiece(PIECES.find((p) => p.id === 'wall-plaster-4m')!);
    expect(wall.indices.length / 3).toBe(88);
    expect(wall.collision).toEqual([
      { min: [-2, 0, -0.18], max: [2, 0.3, 0.18] },
      { min: [-2, 0.3, -0.15], max: [2, 2.9, 0.15] },
      { min: [-2, 2.9, -0.19], max: [2, 3, 0.19] },
    ]);
  });
});

describe('the mesh builder (T-4.04)', () => {
  const tiles = { plaster: 2, concrete: 1 };
  it('cuts a face into tiles of its surface, the last one partial and mapping only its part of the cell', () => {
    const m = new MeshBuilder(KIT_A, tiles).box([0, 0, 0], [3, 1, 1], { all: 'plaster' }, { omit: ['px', 'nx', 'py', 'ny', 'nz'] }).build();
    // The +Z face, 3 m by 1 m in 2 m tiles: one whole tile's width and a half.
    expect(m.indices.length / 3).toBe(4);
    const r = cellRect(KIT_A, 'plaster');
    const us = new Set<number>();
    for (let i = 0; i < m.uvs.length; i += 2) us.add(Number(m.uvs[i]!.toFixed(6)));
    const w = r.u1 - r.u0;
    expect([...us].sort()).toEqual([r.u0, r.u0 + w, r.u0 + w / 2].map((x) => Number(x.toFixed(6))).sort());
  });

  it('winds every triangle to face its normal', () => {
    const m = new MeshBuilder(KIT_A, tiles).box([-1, 0, -1], [1, 2, 1], { all: 'concrete' }).build();
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!].map((i) => [0, 1, 2].map((k) => m.positions[i * 3 + k]!));
      const e1 = [b![0]! - a![0]!, b![1]! - a![1]!, b![2]! - a![2]!];
      const e2 = [c![0]! - a![0]!, c![1]! - a![1]!, c![2]! - a![2]!];
      const cross = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      const n = [0, 1, 2].map((k) => m.normals[m.indices[t]! * 3 + k]!);
      expect(cross[0]! * n[0]! + cross[1]! * n[1]! + cross[2]! * n[2]!).toBeGreaterThan(0);
    }
  });

  it('refuses a box inside out and a surface with no tile size', () => {
    expect(() => new MeshBuilder(KIT_A, tiles).box([0, 0, 0], [1, 0, 1], { all: 'plaster' })).toThrow(/must be below/);
    expect(() => new MeshBuilder(KIT_A, { plaster: 2 }).box([0, 0, 0], [1, 1, 1], { all: 'concrete' })).toThrow(/no tile size/);
    expect(() => cellRect(KIT_A, 'marble')).toThrow(/no surface 'marble'/);
  });
});

describe('the family atlas (T-4.04)', () => {
  it('paints the same bytes every time', () => {
    expect(sha256(paintAtlas(KIT_A))).toBe(sha256(paintAtlas(KIT_A)));
  });

  it('tiles: each cell’s gutter repeats the opposite edge of its interior, so a tiled wall has no seam', () => {
    const px = paintAtlas(KIT_A);
    const at = (x: number, y: number) => [...px.subarray((y * KIT_A.size + x) * 4, (y * KIT_A.size + x) * 4 + 3)].join(',');
    const inner = KIT_A.cell - 2 * KIT_A.gutter;
    Object.keys(KIT_A.surfaces).forEach((_, i) => {
      const cx = (i % (KIT_A.size / KIT_A.cell)) * KIT_A.cell;
      const cy = Math.floor(i / (KIT_A.size / KIT_A.cell)) * KIT_A.cell;
      for (let t = 0; t < inner; t += 13) {
        // Left gutter column = the interior's last column; top gutter row = its last row.
        expect(at(cx + KIT_A.gutter - 1, cy + KIT_A.gutter + t)).toBe(at(cx + KIT_A.gutter + inner - 1, cy + KIT_A.gutter + t));
        expect(at(cx + KIT_A.gutter + t, cy + KIT_A.gutter - 1)).toBe(at(cx + KIT_A.gutter + t, cy + KIT_A.gutter + inner - 1));
      }
    });
  });
});
