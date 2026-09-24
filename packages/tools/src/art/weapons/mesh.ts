/**
 * The weapon mesh builder (T-4.36, ADR-018): parts in a weapon's aim space
 * (+Z along the bore, +Y up, +X the holder's left, the origin at the butt,
 * `client/src/weapons/weaponModels.ts`).
 *
 * Three primitives cover a rifle:
 *   - `extrude`: a side profile (a polygon in z, y) given thickness across x.
 *     Receivers, stocks, grips, magazines, sights and a curved AK magazine
 *     are profiles, which is how a gunsmith draws them;
 *   - `lathe`: a radius profile turned round an axis parallel to +Z, for
 *     barrels, handguards, buffer tubes, scopes, tubes and warheads;
 *   - `ring`, an open aperture turned round an axis parallel to +Z: a rear
 *     sight the eye looks through, with a hole in it;
 *   - `box`, for everything else.
 *
 * UVs are planar per part into its atlas region: an extrusion's sides map
 * its profile's bounds (z, y) onto the region and each edge runs along the
 * region; a lathe runs round the region's width and along its height. A
 * part never wraps inside its region, so no face straddles a seam. Normals are flat on
 * extrusions and boxes (machined edges), and smooth round a lathe.
 */
import type { WeaponRegion } from './atlas.ts';
import { weaponRegion } from './atlas.ts';

export type P2 = readonly [number, number];

export interface BuiltMesh {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

const r5 = (n: number): number => Math.round(n * 1e5) / 1e5;

export class WeaponBuilder {
  readonly out: BuiltMesh = { positions: [], normals: [], uvs: [], indices: [] };

  private vertex(p: readonly number[], n: readonly number[], uv: P2): number {
    this.out.positions.push(r5(p[0]!), r5(p[1]!), r5(p[2]!));
    this.out.normals.push(r5(n[0]!), r5(n[1]!), r5(n[2]!));
    this.out.uvs.push(uv[0], uv[1]);
    return this.out.positions.length / 3 - 1;
  }

  /** (fa, fb) in [0, 1] across the region, fb = 1 at the region's top. */
  private uv(region: WeaponRegion, fa: number, fb: number): P2 {
    const r = weaponRegion(region);
    const clamp = (t: number) => Math.min(1, Math.max(0, t));
    return [r.u0 + (r.u1 - r.u0) * clamp(fa), r.v0 + (r.v1 - r.v0) * (1 - clamp(fb))];
  }

  /** A quad, wound to face `n`. */
  private quad(corners: readonly (readonly number[])[], n: readonly number[], uvs: readonly P2[]): void {
    const i = corners.map((c, k) => this.vertex(c, n, uvs[k]!));
    // Order corners counter-clockwise seen from the normal's side; check and flip if needed.
    const [a, b, c] = corners as [number[], number[], number[]];
    const e1 = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const e2 = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const cr = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const facing = cr[0]! * n[0]! + cr[1]! * n[1]! + cr[2]! * n[2]!;
    if (facing >= 0) this.out.indices.push(i[0]!, i[1]!, i[2]!, i[0]!, i[2]!, i[3]!);
    else this.out.indices.push(i[0]!, i[2]!, i[1]!, i[0]!, i[3]!, i[2]!);
  }

  /**
   * A side profile (z, y), convex or not, but simple (no holes), extruded
   * from x − half to x + half. Its faces are triangulated by ear clipping.
   */
  extrude(profile: readonly P2[], half: number, region: WeaponRegion, x = 0): this {
    const pts = ensureCcw(profile);
    const tris = earClip(pts);
    const zs = pts.map(([z]) => z);
    const ys = pts.map(([, y]) => y);
    const [z0b, z1b, y0b, y1b] = [Math.min(...zs), Math.max(...zs), Math.min(...ys), Math.max(...ys)];
    const fz = (z: number) => (z - z0b) / (z1b - z0b || 1);
    const fy = (y: number) => (y - y0b) / (y1b - y0b || 1);
    let perimeter = 0;
    for (let k = 0; k < pts.length; k++) {
      const [za, ya] = pts[k]!;
      const [zb, yb] = pts[(k + 1) % pts.length]!;
      perimeter += Math.sqrt((zb - za) ** 2 + (yb - ya) ** 2);
    }
    let walked = 0;
    for (const side of [1, -1] as const) {
      const xs = x + side * half;
      const n = [side, 0, 0];
      const idx = pts.map(([z, y]) => this.vertex([xs, y, z], n, this.uv(region, fz(z), fy(y))));
      for (const [a, b, c] of tris) {
        // Seen from +X, (z, y) counter-clockwise is clockwise: flip for the +X side.
        if (side > 0) this.out.indices.push(idx[a]!, idx[c]!, idx[b]!);
        else this.out.indices.push(idx[a]!, idx[b]!, idx[c]!);
      }
    }
    for (let k = 0; k < pts.length; k++) {
      const [z0, y0] = pts[k]!;
      const [z1, y1] = pts[(k + 1) % pts.length]!;
      const dz = z1 - z0;
      const dy = y1 - y0;
      const len = Math.sqrt(dz * dz + dy * dy) || 1;
      // Outward for a counter-clockwise (z, y) polygon: rotate the edge by −90°.
      const n = [0, -dz / len, dy / len];
      // The edges walk along the region's width in turn, across it their thickness.
      const a0 = walked / perimeter;
      walked += len;
      const a1 = walked / perimeter;
      this.quad(
        [
          [x - half, y0, z0],
          [x + half, y0, z0],
          [x + half, y1, z1],
          [x - half, y1, z1],
        ],
        n,
        [this.uv(region, a0, 0), this.uv(region, a0, 1), this.uv(region, a1, 1), this.uv(region, a1, 0)],
      );
    }
    return this;
  }

  /**
   * A radius profile [(z, r), …] turned round the axis through (x, y)
   * parallel to +Z, with `sides` facets; closed at each end whose radius
   * is not zero.
   */
  lathe(profile: readonly P2[], sides: number, region: WeaponRegion, y = 0, x = 0, capEnds = true): this {
    const base = this.out.positions.length / 3;
    const cols = sides + 1;
    // Smooth normals round the lathe, from the profile's slope.
    const z0p = profile[0]![0];
    const zSpan = profile[profile.length - 1]![0] - z0p || 1;
    profile.forEach(([z, r], j) => {
      const prev = profile[Math.max(0, j - 1)]!;
      const next = profile[Math.min(profile.length - 1, j + 1)]!;
      const dz = next[0] - prev[0];
      const dr = next[1] - prev[1];
      const len = Math.sqrt(dz * dz + dr * dr) || 1;
      const nr = dz / len;
      const nz = -dr / len;
      for (let i = 0; i < cols; i++) {
        const a = (i / sides) * Math.PI * 2;
        const cx = Math.cos(a);
        const cy = Math.sin(a);
        this.vertex([x + cx * r, y + cy * r, z], [cx * nr, cy * nr, nz], this.uv(region, i / sides, (z - z0p) / zSpan));
      }
    });
    for (let j = 0; j < profile.length - 1; j++) {
      for (let i = 0; i < sides; i++) {
        const a = base + j * cols + i;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        // Rings go round counter-clockwise seen from +Z; with z increasing along j this faces out.
        this.out.indices.push(a, b, d, a, d, c);
      }
    }
    if (capEnds) {
      for (const [end, dir] of [
        [0, -1],
        [profile.length - 1, 1],
      ] as const) {
        const [z, r] = profile[end]!;
        if (r <= 0) continue;
        const centre = this.vertex([x, y, z], [0, 0, dir], this.uv(region, 0.5, 0.5));
        const ring: number[] = [];
        for (let i = 0; i < sides; i++) {
          const a = (i / sides) * Math.PI * 2;
          ring.push(this.vertex([x + Math.cos(a) * r, y + Math.sin(a) * r, z], [0, 0, dir], this.uv(region, 0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5)));
        }
        for (let i = 0; i < sides; i++) {
          const a = ring[i]!;
          const b = ring[(i + 1) % sides]!;
          if (dir > 0) this.out.indices.push(centre, a, b);
          else this.out.indices.push(centre, b, a);
        }
      }
    }
    return this;
  }

  /**
   * A flat ring between radii `inner` and `outer`, from z0 to z1, round the
   * axis through (x, y) parallel to +Z: a rear sight's aperture. The hole is
   * open, so the eye looks through it; faces are flat (a machined part).
   */
  ring(z0: number, z1: number, inner: number, outer: number, sides: number, region: WeaponRegion, y = 0, x = 0): this {
    const at = (r: number, a: number, z: number) => [x + Math.cos(a) * r, y + Math.sin(a) * r, z];
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const mid = (a0 + a1) / 2;
      const radial = [Math.cos(mid), Math.sin(mid), 0];
      const [f0, f1] = [i / sides, (i + 1) / sides];
      const uvs: P2[] = [this.uv(region, f0, 0), this.uv(region, f1, 0), this.uv(region, f1, 1), this.uv(region, f0, 1)];
      for (const [z, dir] of [
        [z0, -1],
        [z1, 1],
      ] as const) {
        this.quad([at(inner, a0, z), at(inner, a1, z), at(outer, a1, z), at(outer, a0, z)], [0, 0, dir], uvs);
      }
      this.quad([at(outer, a0, z0), at(outer, a1, z0), at(outer, a1, z1), at(outer, a0, z1)], radial, uvs);
      this.quad([at(inner, a0, z0), at(inner, a1, z0), at(inner, a1, z1), at(inner, a0, z1)], radial.map((c) => -c), uvs);
    }
    return this;
  }

  /** An axis-aligned box, given by its min and max corners. */
  box(min: readonly [number, number, number], max: readonly [number, number, number], region: WeaponRegion): this {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    return this.extrude(
      [
        [z0, y0],
        [z1, y0],
        [z1, y1],
        [z0, y1],
      ],
      (x1 - x0) / 2,
      region,
      (x0 + x1) / 2,
    );
  }

  build(): BuiltMesh {
    return this.out;
  }
}

function area(p: readonly P2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [ax, ay] = p[i]!;
    const [bx, by] = p[(i + 1) % p.length]!;
    s += ax * by - bx * ay;
  }
  return s / 2;
}

function ensureCcw(p: readonly P2[]): P2[] {
  return area(p) < 0 ? [...p].reverse() : [...p];
}

/** Ear clipping for a simple counter-clockwise polygon. */
function earClip(p: readonly P2[]): [number, number, number][] {
  const idx = p.map((_, i) => i);
  const out: [number, number, number][] = [];
  const cross = (a: P2, b: P2, c: P2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (q: P2, a: P2, b: P2, c: P2) => cross(a, b, q) > 0 && cross(b, c, q) > 0 && cross(c, a, q) > 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10_000) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length]!;
      const ib = idx[k]!;
      const ic = idx[(k + 1) % idx.length]!;
      const [a, b, c] = [p[ia]!, p[ib]!, p[ic]!];
      if (cross(a, b, c) <= 0) continue;
      if (idx.some((j) => j !== ia && j !== ib && j !== ic && inside(p[j]!, a, b, c))) continue;
      out.push([ia, ib, ic]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) throw new Error('earClip: the profile is not simple');
  }
  out.push([idx[0]!, idx[1]!, idx[2]!]);
  return out;
}
