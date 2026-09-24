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

  /**
   * An upright prism (a drum, a post): `sides` faces round a circle of
   * `radius` about (cx, cz), from y0 to y1, with capped ends. Its side faces
   * share one surface, tiled round the circumference; each cap maps its
   * disc into the cap surface's cell. A drum with a multiple of four sides
   * has its bounds at exactly ±radius, so a square collision box round it
   * is its bounds. Coordinates are rounded to 0.1 mm so trigonometry cannot
   * put a last-bit difference into committed bytes.
   */
  prism(cx: number, cz: number, radius: number, y0: number, y1: number, sides: number, faces: { side: string; cap: string }, options: { collide?: boolean } = {}): this {
    if (sides < 3 || !(radius > 0) || !(y0 < y1)) throw new Error('prism: needs 3+ sides, a radius and y0 < y1');
    if (options.collide) this.out.collision.push({ min: [cx - radius, y0, cz - radius], max: [cx + radius, y1, cz + radius] });
    const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
    const ring = Array.from({ length: sides + 1 }, (_, i) => {
      const a = (i / sides) * Math.PI * 2;
      return [r4(Math.sin(a)), r4(Math.cos(a))] as const;
    });
    const tile = this.tileM[faces.side];
    if (!tile || tile <= 0) throw new Error(`surface '${faces.side}' has no tile size`);
    const side = cellRect(this.family, faces.side);
    const circumference = 2 * Math.PI * radius;
    const height = y1 - y0;
    // Side quads; u runs round, v down from the top, each tile the whole cell.
    for (let i = 0; i < sides; i++) {
      const [sa, ca] = ring[i]!;
      const [sb, cb] = ring[i + 1]!;
      const ua = ((i / sides) * circumference) / tile;
      const ub = (((i + 1) / sides) * circumference) / tile;
      // A side face may straddle a tile edge; wrap its u into the cell by the tile it starts in.
      const t0 = Math.floor(ua + 1e-9);
      const fu = (x: number) => side.u0 + (side.u1 - side.u0) * Math.min(1, x - t0);
      const fv = (y: number) => side.v0 + (side.v1 - side.v0) * Math.min(1, (y1 - y) / Math.min(height, tile));
      const nx = r4(Math.sin(((i + 0.5) / sides) * Math.PI * 2));
      const nz = r4(Math.cos(((i + 0.5) / sides) * Math.PI * 2));
      const base = this.out.positions.length / 3;
      const corners: [number, number, number, number][] = [
        [sa, ca, ua, y1],
        [sb, cb, ub, y1],
        [sb, cb, ub, y0],
        [sa, ca, ua, y0],
      ];
      for (const [s, c, u, y] of corners) {
        this.out.positions.push(r4(cx + s * radius), y, r4(cz + c * radius));
        this.out.normals.push(nx, 0, nz);
        this.out.uvs.push(fu(u), fv(y));
      }
      this.out.indices.push(base, base + 3, base + 2, base, base + 2, base + 1);
    }
    // Caps: a fan round the centre, the disc inscribed in the cap cell.
    const cap = cellRect(this.family, faces.cap);
    for (const [y, up] of [
      [y1, 1],
      [y0, -1],
    ] as const) {
      const centre = this.out.positions.length / 3;
      const cu = (cap.u0 + cap.u1) / 2;
      const cv = (cap.v0 + cap.v1) / 2;
      const hu = (cap.u1 - cap.u0) / 2;
      const hv = (cap.v1 - cap.v0) / 2;
      this.out.positions.push(cx, y, cz);
      this.out.normals.push(0, up, 0);
      this.out.uvs.push(cu, cv);
      for (let i = 0; i <= sides; i++) {
        const [s, c] = ring[i]!;
        this.out.positions.push(r4(cx + s * radius), y, r4(cz + c * radius));
        this.out.normals.push(0, up, 0);
        this.out.uvs.push(cu + s * hu, cv + c * hv);
      }
      for (let i = 0; i < sides; i++) {
        const a = centre + 1 + i;
        const b = centre + 2 + i;
        // Seen from above, the ring runs clockwise (sin, cos): +Z then +X.
        if (up > 0) this.out.indices.push(centre, a, b);
        else this.out.indices.push(centre, b, a);
      }
    }
    return this;
  }

  /** A collision box with no mesh of its own, round parts that are drawn but should collide as one. */
  collider(min: Vec3, max: Vec3): this {
    for (let a = 0; a < 3; a++) if (!(min[a]! < max[a]!)) throw new Error(`collider: min ${min} must be below max ${max}`);
    this.out.collision.push({ min: [...min], max: [...max] });
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
