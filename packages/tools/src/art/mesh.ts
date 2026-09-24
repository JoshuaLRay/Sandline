/**
 * The mesh builder the art generators draw with (T-4.04, ADR-018).
 *
 * Hard-surface pieces are made of boxes, the way the era's were. The
 * builder has two duties beyond collecting triangles.
 *
 * - **Tiling by subdivision.** Each face of a box is cut into tiles no
 *   bigger than its surface's tile size, and each tile maps the whole atlas
 *   cell (a partial tile maps the matching part of it). A 4 m wall with a
 *   2 m plaster tile is two tiles across, at the cell's texel density, with
 *   no stretching and no UV outside the cell, so a shared atlas needs no
 *   texture repeat.
 * - **Collision from the same numbers.** A box added with `collide: true`
 *   records its bounds as a collision box, so what the player hits and what
 *   they see can never drift apart (§7.11 rule 1).
 *
 * Axes are the game's: +Y up, +Z forward, metres, origin at the piece's
 * base centre.
 */
import type { AtlasFamily } from './atlas.ts';
import { cellRect } from './atlas.ts';

export type Vec3 = [number, number, number];

export interface BoxFaces {
  /** The surface on every face, unless a face names its own. */
  all: string;
  px?: string;
  nx?: string;
  py?: string;
  ny?: string;
  pz?: string;
  nz?: string;
}

export interface BoxOptions {
  /** Record this box as a collision box too. */
  collide?: boolean;
  /** Leave these faces out (hidden against a neighbour, or the ground). */
  omit?: readonly (keyof Omit<BoxFaces, 'all'>)[];
}

export interface BuiltMesh {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  collision: { min: Vec3; max: Vec3 }[];
}

type Face = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';

/**
 * Each face as (normal, the axis its texture's u runs along, the axis its v
 * runs along). v runs DOWN the face on the sides, so a texture's top row is
 * the top of the wall, as glTF's v-down UVs expect.
 */
const FACES: Record<Face, { n: Vec3; u: Vec3; v: Vec3 }> = {
  pz: { n: [0, 0, 1], u: [1, 0, 0], v: [0, -1, 0] },
  nz: { n: [0, 0, -1], u: [-1, 0, 0], v: [0, -1, 0] },
  px: { n: [1, 0, 0], u: [0, 0, -1], v: [0, -1, 0] },
  nx: { n: [-1, 0, 0], u: [0, 0, 1], v: [0, -1, 0] },
  py: { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  ny: { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1] },
};

export class MeshBuilder {
  private readonly out: BuiltMesh = { positions: [], normals: [], uvs: [], indices: [], collision: [] };

  /**
   * @param family the atlas every surface is looked up in.
   * @param tileM metres a surface's cell covers, by surface name.
   */
  constructor(
    private readonly family: AtlasFamily,
    private readonly tileM: Readonly<Record<string, number>>,
  ) {}

  box(min: Vec3, max: Vec3, faces: BoxFaces, options: BoxOptions = {}): this {
    for (let a = 0; a < 3; a++) if (!(min[a]! < max[a]!)) throw new Error(`box: min ${min} must be below max ${max}`);
    if (options.collide) this.out.collision.push({ min: [...min], max: [...max] });
    for (const face of Object.keys(FACES) as Face[]) {
      if (options.omit?.includes(face)) continue;
      this.face(min, max, face, faces[face] ?? faces.all);
    }
    return this;
  }

  build(): BuiltMesh {
    return this.out;
  }

  private face(min: Vec3, max: Vec3, face: Face, surface: string): void {
    const { n, u, v } = FACES[face];
    const tile = this.tileM[surface];
    if (!tile || tile <= 0) throw new Error(`surface '${surface}' has no tile size`);
    const rect = cellRect(this.family, surface);
    // The face's corner where u and v are both least, and its extents.
    const axisOf = (d: Vec3) => d.findIndex((c) => c !== 0);
    const ua = axisOf(u);
    const va = axisOf(v);
    const na = axisOf(n);
    const span = (axis: number) => max[axis]! - min[axis]!;
    const uLen = span(ua);
    const vLen = span(va);
    const origin: Vec3 = [0, 0, 0];
    origin[na] = n[na]! > 0 ? max[na]! : min[na]!;
    origin[ua] = u[ua]! > 0 ? min[ua]! : max[ua]!;
    origin[va] = v[va]! > 0 ? min[va]! : max[va]!;
    const cuts = (len: number) => {
      const out = [0];
      for (let t = tile; t < len - 1e-6; t += tile) out.push(t);
      out.push(len);
      return out;
    };
    const us = cuts(uLen);
    const vs = cuts(vLen);
    for (let j = 0; j < vs.length - 1; j++) {
      for (let i = 0; i < us.length - 1; i++) {
        const base = this.out.positions.length / 3;
        const corners: [number, number][] = [
          [us[i]!, vs[j]!],
          [us[i + 1]!, vs[j]!],
          [us[i + 1]!, vs[j + 1]!],
          [us[i]!, vs[j + 1]!],
        ];
        for (const [a, b] of corners) {
          const p: Vec3 = [...origin];
          p[ua] = p[ua]! + u[ua]! * a;
          p[va] = p[va]! + v[va]! * b;
          this.out.positions.push(...p);
          this.out.normals.push(...n);
          // Within the tile, the fraction of a whole tile: a partial tile
          // maps the part of the cell it covers, never beyond it.
          const fu = (a - us[i]!) / tile;
          const fv = (b - vs[j]!) / tile;
          this.out.uvs.push(rect.u0 + (rect.u1 - rect.u0) * fu, rect.v0 + (rect.v1 - rect.v0) * fv);
        }
        // Counter-clockwise seen from outside (the normal's side).
        this.out.indices.push(base, base + 3, base + 2, base, base + 2, base + 1);
      }
    }
  }
}
