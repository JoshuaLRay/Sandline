/**
 * U-126: the vehicle mesh builder (ADR-018). Hard-surface parts for a tank,
 * in the vehicle's frame: metres, origin at its feet, +Y up, +Z forward,
 * +X its left.
 *
 * The primitives:
 *   - `prism`: a 2D profile, convex or not, extruded along an axis. Hull
 *     plates, fenders, boxes, sprocket teeth.
 *   - `lathe`: a radius profile turned round an axis. Wheels, the cast
 *     turret (whose plan can bulge by angle), the gun, hatches, lamps.
 *   - `quad` and `orientedBox`: for parts that lie on a sloped plate.
 *
 * A transform stack (`push`) places, turns and mirrors parts, so one side's
 * running gear builds the other's.
 *
 * Every face names its surface:
 *   - `PAINT`: projected onto the atlas's paint sheets by the way it faces
 *     (`atlas.ts`), in the vehicle's frame. A builder for a part that
 *     moves (the turret) is given its rest offset, so its texels are where
 *     the painter expects them;
 *   - a cell, mapped per primitive: around and along a lathe, as a disc on
 *     a wheel's face, across and along a track link.
 *
 * Triangles are wound to face their normals whatever order a primitive
 * gives their corners. Identical vertices are shared.
 */
import { type Sheet, type VehicleCell, cellRect, regionUv, sheetFor, sheetUv } from './atlas.ts';
import { earClip, ensureCcw } from '../weapons/mesh.ts';

export type V3 = readonly [number, number, number];
export type P2 = readonly [number, number];

export interface BuiltMesh {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

export const PAINT = 'paint' as const;
export type Surface = typeof PAINT | VehicleCell;

/** A face's corner: where it is, its shading normal, and (for a cell) where in the cell, 0 to 1 each way. */
interface Corner {
  p: V3;
  n: V3;
  f?: P2;
}

/** A 3 × 4 affine transform, rows: [r00 r01 r02 tx, r10 r11 r12 ty, r20 r21 r22 tz]. Rotations and mirrors only. */
type Mat = readonly number[];
const IDENTITY: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

function mul(a: Mat, b: Mat): Mat {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      let s = c === 3 ? a[r * 4 + 3]! : 0;
      for (let k = 0; k < 3; k++) s += a[r * 4 + k]! * b[k * 4 + c]!;
      out.push(s);
    }
  }
  return out;
}

export const translate = (x: number, y: number, z: number): Mat => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
export const mirrorX: Mat = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
/** A turn about +X by `a` radians (+Y toward +Z). */
export function rotateX(a: number): Mat {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0];
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.sqrt(dot(a, a));
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const r5 = (n: number): number => Math.round(n * 1e5) / 1e5 || 0;

export type Axis = 'x' | 'y' | 'z';

/** A right-handed frame for turning about an axis: angle 0 lies along `u`, a quarter turn along `v`. */
function frame(axis: Axis): { a: V3; u: V3; v: V3 } {
  if (axis === 'x') return { a: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] };
  if (axis === 'y') return { a: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] };
  return { a: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] };
}

/** A profile point (a, b) on the plane across `axis`, at `t` along it. */
function lift(axis: Axis, a: number, b: number, t: number): V3 {
  if (axis === 'x') return [t, b, a]; // profile (z, y)
  if (axis === 'y') return [a, t, b]; // profile (x, z)
  return [a, b, t]; // profile (x, y)
}

export interface LatheOptions {
  /** Facets round the axis. */
  sides: number;
  /** The surface of profile segment j (from point j to j + 1); one surface for all when a string. */
  surface: Surface | ((segment: number) => Surface);
  /** How a cell is laid on the lathe: round and along it, or as a disc seen down the axis (a wheel's face). */
  map?: 'wrap' | 'disc';
  /** Radius the disc mapping reaches the cell's edge at. Default: the profile's largest. */
  discRadius?: number;
  /** Smooth normals along the profile as well as round it (a cast dome); else each segment is its own band. */
  smoothProfile?: boolean;
  /** Radius scale by angle, for a plan that is not round (the turret bulges toward its gun). */
  plan?: (angle: number) => number;
  /** Close the first and last rings with flat discs, when their radius is not zero. */
  caps?: boolean;
  /** The first facet's angle. */
  phase?: number;
}

export class VehicleBuilder {
  readonly out: BuiltMesh = { positions: [], normals: [], uvs: [], indices: [] };
  private readonly index = new Map<string, number>();
  private m: Mat = IDENTITY;
  private sheet: Sheet | null = null;

  /** `paintOffset`: added to every position before it is projected onto the paint sheets (a moving part's rest place). */
  constructor(private readonly paintOffset: V3 = [0, 0, 0]) {}

  /** Draw under a further transform. */
  push(t: Mat, draw: () => void): this {
    const saved = this.m;
    this.m = mul(saved, t);
    try {
      draw();
    } finally {
      this.m = saved;
    }
    return this;
  }

  /**
   * Draw with every painted face on one sheet, whatever its facing: for a smooth curved part (the cast dome),
   * where a change of sheet from one facet to the next would show as a seam.
   */
  onSheet(sheet: Sheet, draw: () => void): this {
    const saved = this.sheet;
    this.sheet = sheet;
    try {
      draw();
    } finally {
      this.sheet = saved;
    }
    return this;
  }

  private place(p: V3): V3 {
    const m = this.m;
    return [m[0]! * p[0] + m[1]! * p[1] + m[2]! * p[2] + m[3]!, m[4]! * p[0] + m[5]! * p[1] + m[6]! * p[2] + m[7]!, m[8]! * p[0] + m[9]! * p[1] + m[10]! * p[2] + m[11]!];
  }

  private turn(n: V3): V3 {
    const m = this.m;
    return norm([m[0]! * n[0] + m[1]! * n[1] + m[2]! * n[2], m[4]! * n[0] + m[5]! * n[1] + m[6]! * n[2], m[8]! * n[0] + m[9]! * n[1] + m[10]! * n[2]]);
  }

  private vertex(p: V3, n: V3, uv: P2): number {
    const key = `${r5(p[0])},${r5(p[1])},${r5(p[2])}|${r5(n[0])},${r5(n[1])},${r5(n[2])}|${r5(uv[0])},${r5(uv[1])}`;
    const found = this.index.get(key);
    if (found !== undefined) return found;
    this.out.positions.push(r5(p[0]), r5(p[1]), r5(p[2]));
    this.out.normals.push(r5(n[0]), r5(n[1]), r5(n[2]));
    this.out.uvs.push(r5(uv[0]), r5(uv[1]));
    const i = this.out.positions.length / 3 - 1;
    this.index.set(key, i);
    return i;
  }

  /** One triangle, placed by the current transform and wound to face its corners' normals. */
  tri(c: readonly [Corner, Corner, Corner], surface: Surface): this {
    const p = c.map((k) => this.place(k.p)) as [V3, V3, V3];
    const n = c.map((k) => this.turn(k.n)) as [V3, V3, V3];
    const face = cross(sub(p[1], p[0]), sub(p[2], p[0]));
    if (len(face) < 1e-9) return this;
    const sum: V3 = [n[0][0] + n[1][0] + n[2][0], n[0][1] + n[1][1] + n[2][1], n[0][2] + n[1][2] + n[2][2]];
    const flip = dot(face, sum) < 0;
    let uvs: P2[];
    if (surface === PAINT) {
      // One sheet for the whole triangle (by its own facing), so a face never straddles two.
      const sheet: Sheet = this.sheet ?? sheetFor(flip ? [-face[0], -face[1], -face[2]] : face);
      const o = this.paintOffset;
      uvs = p.map((q) => sheetUv(sheet, [q[0] + o[0], q[1] + o[1], q[2] + o[2]]));
    } else {
      const rect = cellRect(surface);
      uvs = c.map((k) => regionUv(rect, k.f?.[0] ?? 0.5, k.f?.[1] ?? 0.5));
    }
    const i = [0, 1, 2].map((k) => this.vertex(p[k]!, n[k]!, uvs[k]!));
    if (flip) this.out.indices.push(i[0]!, i[2]!, i[1]!);
    else this.out.indices.push(i[0]!, i[1]!, i[2]!);
    return this;
  }

  /** A flat quad (four coplanar corners in order round it), facing `n`; `f` lays a cell on it corner by corner. */
  quad(corners: readonly [V3, V3, V3, V3], n: V3, surface: Surface, f: readonly [P2, P2, P2, P2] = [[0, 0], [1, 0], [1, 1], [0, 1]]): this {
    const k = corners.map((p, i) => ({ p, n, f: f[i]! }));
    this.tri([k[0]!, k[1]!, k[2]!], surface);
    return this.tri([k[0]!, k[2]!, k[3]!], surface);
  }

  /**
   * A profile on the plane across `axis` ((z, y) for x, (x, z) for y, (x, y) for z), extruded from t0 to t1
   * along it, with flat faces. `cap` overrides the end faces' surface.
   */
  prism(profile: readonly P2[], axis: Axis, t0: number, t1: number, surface: Surface, cap: Surface = surface): this {
    const pts = ensureCcw(profile);
    const as = pts.map(([a]) => a);
    const bs = pts.map(([, b]) => b);
    const [a0, a1, b0, b1] = [Math.min(...as), Math.max(...as), Math.min(...bs), Math.max(...bs)];
    const fa = (a: number) => (a - a0) / (a1 - a0 || 1);
    const fb = (b: number) => (b - b0) / (b1 - b0 || 1);
    const ax = frame(axis).a;
    for (const [t, dir] of [
      [t0, -1],
      [t1, 1],
    ] as const) {
      const n: V3 = [ax[0] * dir, ax[1] * dir, ax[2] * dir];
      for (const [i, j, k] of earClip(pts)) {
        const corner = (q: number): Corner => ({ p: lift(axis, pts[q]![0], pts[q]![1], t), n, f: [fa(pts[q]![0]), fb(pts[q]![1])] });
        this.tri([corner(i), corner(j), corner(k)], cap);
      }
    }
    let perimeter = 0;
    for (let k = 0; k < pts.length; k++) {
      const [pa, pb] = [pts[k]!, pts[(k + 1) % pts.length]!];
      perimeter += Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    }
    let walked = 0;
    for (let k = 0; k < pts.length; k++) {
      const [pa, pb] = [pts[k]!, pts[(k + 1) % pts.length]!];
      const [da, db] = [pb[0] - pa[0], pb[1] - pa[1]];
      const l = Math.hypot(da, db) || 1;
      // Outward from a counter-clockwise profile: the edge turned a quarter clockwise.
      const n = lift(axis, db / l, -da / l, 0);
      const w0 = walked / perimeter;
      walked += l;
      const w1 = walked / perimeter;
      this.quad(
        [lift(axis, pa[0], pa[1], t0), lift(axis, pb[0], pb[1], t0), lift(axis, pb[0], pb[1], t1), lift(axis, pa[0], pa[1], t1)],
        n,
        surface,
        [
          [w0, 0],
          [w1, 0],
          [w1, 1],
          [w0, 1],
        ],
      );
    }
    return this;
  }

  /** An axis-aligned box. */
  box(min: V3, max: V3, surface: Surface, cap: Surface = surface): this {
    return this.prism(
      [
        [min[2], min[1]],
        [max[2], min[1]],
        [max[2], max[1]],
        [min[2], max[1]],
      ],
      'x',
      min[0],
      max[0],
      surface,
      cap,
    );
  }

  /** A box with its edges along `axis` bevelled by `c`. */
  chamferBox(min: V3, max: V3, axis: Axis, c: number, surface: Surface, cap: Surface = surface): this {
    const i = axis === 'x' ? [2, 1] : axis === 'y' ? [0, 2] : [0, 1];
    const [a0, b0, a1, b1] = [min[i[0]!]!, min[i[1]!]!, max[i[0]!]!, max[i[1]!]!];
    const t = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    return this.prism(
      [
        [a0 + c, b0],
        [a1 - c, b0],
        [a1, b0 + c],
        [a1, b1 - c],
        [a1 - c, b1],
        [a0 + c, b1],
        [a0, b1 - c],
        [a0, b0 + c],
      ],
      axis,
      min[t]!,
      max[t]!,
      surface,
      cap,
    );
  }

  /** A box on its own axes (unit, perpendicular): centre, axes, half sizes. `top` is the face along +ay. */
  orientedBox(centre: V3, ax: V3, ay: V3, az: V3, half: V3, surface: Surface, top: Surface = surface): this {
    const at = (sx: number, sy: number, sz: number): V3 => [
      centre[0] + ax[0] * half[0] * sx + ay[0] * half[1] * sy + az[0] * half[2] * sz,
      centre[1] + ax[1] * half[0] * sx + ay[1] * half[1] * sy + az[1] * half[2] * sz,
      centre[2] + ax[2] * half[0] * sx + ay[2] * half[1] * sy + az[2] * half[2] * sz,
    ];
    const neg = (v: V3): V3 => [-v[0], -v[1], -v[2]];
    this.quad([at(-1, 1, -1), at(1, 1, -1), at(1, 1, 1), at(-1, 1, 1)], ay, top, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    this.quad([at(-1, -1, -1), at(1, -1, -1), at(1, -1, 1), at(-1, -1, 1)], neg(ay), surface);
    this.quad([at(1, -1, -1), at(1, 1, -1), at(1, 1, 1), at(1, -1, 1)], ax, surface);
    this.quad([at(-1, -1, -1), at(-1, 1, -1), at(-1, 1, 1), at(-1, -1, 1)], neg(ax), surface);
    this.quad([at(-1, -1, 1), at(1, -1, 1), at(1, 1, 1), at(-1, 1, 1)], az, surface);
    return this.quad([at(-1, -1, -1), at(1, -1, -1), at(1, 1, -1), at(-1, 1, -1)], neg(az), surface);
  }

  /**
   * A radius profile [(t, r), …] turned round the axis through `centre`, t measured along it. Normals are smooth
   * round the axis; along it, each segment is its own band unless `smoothProfile`.
   */
  lathe(profile: readonly P2[], axis: Axis, centre: V3, o: LatheOptions): this {
    const { a, u, v } = frame(axis);
    const plan = o.plan ?? (() => 1);
    const phase = o.phase ?? 0;
    const surfaceOf = typeof o.surface === 'function' ? o.surface : () => o.surface as Surface;
    const rDisc = o.discRadius ?? Math.max(...profile.map(([, r]) => r));
    const t0 = profile[0]![0];
    const tSpan = profile[profile.length - 1]![0] - t0 || 1;
    const angle = (i: number) => phase + (i / o.sides) * Math.PI * 2;
    const at = (i: number, j: number): V3 => {
      const [t, r] = profile[j]!;
      const ang = angle(i);
      const s = r * plan(ang);
      const c = Math.cos(ang) * s;
      const d = Math.sin(ang) * s;
      return [centre[0] + a[0] * t + u[0] * c + v[0] * d, centre[1] + a[1] * t + u[1] * c + v[1] * d, centre[2] + a[2] * t + u[2] * c + v[2] * d];
    };
    // The solid is on the axis side of the profile. Walking it toward +t, outward is round × along; toward −t, the
    // opposite. So a profile may step out and back (a muzzle lip, a tyre's inner face) and still face the right way.
    const sense = Math.sign(tSpan);
    // The normal at ring j for facet column i, from the surface's slope there: round (central) by along.
    const normal = (i: number, j: number, jA: number, jB: number): V3 => {
      const c = cross(sub(at(i + 1, j), at(i - 1, j)), sub(at(i, jB), at(i, jA)));
      if (len(c) < 1e-12) {
        // On the axis: the end's own direction.
        const end = (j === 0 ? -1 : 1) * sense;
        return [a[0] * end, a[1] * end, a[2] * end];
      }
      const n = norm(c);
      return [n[0] * sense, n[1] * sense, n[2] * sense];
    };
    const f = (i: number, j: number): P2 => {
      if (o.map === 'disc') {
        const ang = angle(i);
        const k = profile[j]![1] / rDisc;
        return [0.5 + 0.5 * Math.cos(ang) * k, 0.5 + 0.5 * Math.sin(ang) * k];
      }
      return [i / o.sides, (profile[j]![0] - t0) / tSpan];
    };
    for (let j = 0; j < profile.length - 1; j++) {
      const surface = surfaceOf(j);
      for (let i = 0; i < o.sides; i++) {
        const corner = (ii: number, jj: number): Corner => {
          const n = o.smoothProfile ? normal(ii, jj, Math.max(0, jj - 1), Math.min(profile.length - 1, jj + 1)) : normal(ii, jj, j, j + 1);
          return { p: at(ii, jj), n, f: f(ii, jj) };
        };
        const [c00, c10, c01, c11] = [corner(i, j), corner(i + 1, j), corner(i, j + 1), corner(i + 1, j + 1)];
        this.tri([c00, c10, c11], surface);
        this.tri([c00, c11, c01], surface);
      }
    }
    if (o.caps) {
      for (const [j, dir] of [
        [0, -1],
        [profile.length - 1, 1],
      ] as const) {
        if (profile[j]![1] <= 0) continue;
        const sign = dir * Math.sign(tSpan);
        const n: V3 = [a[0] * sign, a[1] * sign, a[2] * sign];
        const [t] = profile[j]!;
        const mid: Corner = { p: [centre[0] + a[0] * t, centre[1] + a[1] * t, centre[2] + a[2] * t], n, f: [0.5, 0.5] };
        const surface = surfaceOf(j === 0 ? 0 : profile.length - 2);
        for (let i = 0; i < o.sides; i++) {
          const ang0 = angle(i);
          const ang1 = angle(i + 1);
          const k = profile[j]![1] / rDisc;
          const disc = (ang: number): P2 => [0.5 + 0.5 * Math.cos(ang) * k, 0.5 + 0.5 * Math.sin(ang) * k];
          this.tri([mid, { p: at(i, j), n, f: disc(ang0) }, { p: at(i + 1, j), n, f: disc(ang1) }], surface);
        }
      }
    }
    return this;
  }

  get triangles(): number {
    return this.out.indices.length / 3;
  }

  build(): BuiltMesh {
    return this.out;
  }
}
