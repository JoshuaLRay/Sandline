/**
 * The character mesh builder (T-4.08, ADR-018): smooth, skinned forms for a
 * soldier that must read as a 2002 console character, not a stack of boxes.
 *
 * EVERYTHING IS A VERTICAL LOFT. In the rig's bind pose the arms hang
 * straight down and the legs stand straight (humanoidSoldier.ts), so every
 * limb, the torso, the head, the helmet, the vest and each pouch is a stack
 * of horizontal rings joined into a tube. A ring is a superellipse, so the
 * same primitive gives a round forearm (exponent 2), a boxy vest (3) or a
 * pouch with rounded corners (4). It can be deeper in front than behind, for
 * a boot's toe or a chest plate, and can drop at the back, for a helmet's
 * skirt. Each ring carries its own bone weights, so a knee ring half on the
 * thigh and half on the shin bends smoothly instead of cracking open.
 *
 * Normals are smooth, accumulated from the faces and welded across each
 * tube's seam (T-2.32: Gouraud, not faceted). UVs run round each tube (u,
 * with the seam at the back and the front at u = 0.5) and down it (v) inside
 * the tube's atlas region.
 */
export type Vec3 = [number, number, number];

export interface Ring {
  y: number;
  cx?: number;
  cz?: number;
  /** Half-width across x. */
  rx: number;
  /** Half-depth in front of the centre. */
  rzF: number;
  /** Half-depth behind the centre; the front's when omitted. */
  rzB?: number;
  /** Superellipse exponent: 2 round, 3 boxy, 4+ a rounded rectangle. */
  n?: number;
  /** How far the ring drops at the very back (a helmet's skirt), metres. */
  dropBack?: number;
  /** Bone weights, [boneIndex, weight]; normalised here. */
  bones: readonly (readonly [number, number])[];
  /** Local swellings outward: a nose at t 0.5, ears at 0.25 and 0.75. `w` is the half-width in t, `d` the height in metres. */
  bumps?: readonly { t: number; w: number; d: number }[];
}

export interface Region {
  /** The region's rectangle in the atlas, UV units, v down (glTF). */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface LoftOptions {
  sides: number;
  region: Region;
  /** 0 the body material, 1 the palette accent. */
  material?: 0 | 1;
  capTop?: boolean;
  capBottom?: boolean;
  /** v by height down the tube rather than by ring count, so a painter can place a feature at a model height (the face). */
  vByHeight?: boolean;
  /** Only this span of the way round (0..1, front at 0.5), for a patch on one side. Closed tube when omitted. */
  arc?: readonly [number, number];
}

export interface BuiltSkin {
  positions: number[];
  normals: number[];
  uvs: number[];
  joints: number[];
  weights: number[];
  /** Triangle indices per material. */
  indices: [number[], number[]];
}

const r5 = (n: number): number => Math.round(n * 1e5) / 1e5;

function ringPoint(ring: Ring, t: number): Vec3 {
  // θ = π + 2πt: t = 0 is −Z (the back), 0.25 is −X (the soldier's right),
  // 0.5 is +Z (the front) and 0.75 is +X (the soldier's left).
  const theta = Math.PI + 2 * Math.PI * t;
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  const e = 2 / (ring.n ?? 2);
  const sx = Math.sign(s) * Math.abs(s) ** e;
  const sz = Math.sign(c) * Math.abs(c) ** e;
  const rz = c >= 0 ? ring.rzF : (ring.rzB ?? ring.rzF);
  const back = ring.dropBack ? ring.dropBack * Math.max(0, -c) ** 2 : 0;
  // A bump pushes the surface out along the ring's own outward direction, in a cosine window.
  let bump = 0;
  for (const b of ring.bumps ?? []) {
    const d = Math.abs(t - b.t);
    if (d < b.w) bump += b.d * 0.5 * (1 + Math.cos((Math.PI * d) / b.w));
  }
  const x = ring.rx * sx;
  const z = rz * sz;
  const len = Math.sqrt(x * x + z * z) || 1;
  return [r5((ring.cx ?? 0) + x + (bump * x) / len), r5(ring.y - back), r5((ring.cz ?? 0) + z + (bump * z) / len)];
}

export class SkinBuilder {
  readonly out: BuiltSkin = { positions: [], normals: [], uvs: [], joints: [], weights: [], indices: [[], []] };

  loft(rings: readonly Ring[], o: LoftOptions): this {
    if (rings.length < 2) throw new Error('loft: needs two rings');
    const cols = o.sides + 1;
    const [a0, a1] = o.arc ?? [0, 1];
    const base = this.out.positions.length / 3;
    const tri = this.out.indices[o.material ?? 0];
    const faceNormals: Vec3[] = [];
    const yTop = rings[0]!.y;
    const ySpan = yTop - rings[rings.length - 1]!.y;
    rings.forEach((ring, j) => {
      const v = o.vByHeight ? (yTop - ring.y) / ySpan : j / (rings.length - 1);
      const w = weights4(ring.bones);
      for (let i = 0; i < cols; i++) {
        const t = a0 + ((a1 - a0) * i) / o.sides;
        this.out.positions.push(...ringPoint(ring, t % 1));
        this.out.normals.push(0, 0, 0);
        this.out.uvs.push(o.region.u0 + (o.region.u1 - o.region.u0) * ((t - a0) / (a1 - a0)), o.region.v0 + (o.region.v1 - o.region.v0) * v);
        this.out.joints.push(...w.j);
        this.out.weights.push(...w.w);
      }
    });
    // Rings are listed top to bottom; each quad wound to face outward.
    for (let j = 0; j < rings.length - 1; j++) {
      for (let i = 0; i < o.sides; i++) {
        const a = base + j * cols + i;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        this.tri(tri, faceNormals, a, c, d);
        this.tri(tri, faceNormals, a, d, b);
      }
    }
    if (o.capTop) this.cap(rings[0]!, base, cols, o, true, faceNormals);
    if (o.capBottom) this.cap(rings[rings.length - 1]!, base + (rings.length - 1) * cols, cols, o, false, faceNormals);
    // A closed tube's first and last columns are the same points: one normal for both.
    if (!o.arc) {
      for (let j = 0; j < rings.length; j++) {
        const first = base + j * cols;
        const last = first + o.sides;
        for (let k = 0; k < 3; k++) {
          const sum = this.out.normals[first * 3 + k]! + this.out.normals[last * 3 + k]!;
          this.out.normals[first * 3 + k] = sum;
          this.out.normals[last * 3 + k] = sum;
        }
      }
    }
    this.normalise(base);
    return this;
  }

  build(): BuiltSkin {
    return this.out;
  }

  private cap(ring: Ring, start: number, cols: number, o: LoftOptions, top: boolean, faceNormals: Vec3[]): void {
    const centre = this.out.positions.length / 3;
    const p = [0, 0, 0];
    for (let i = 0; i < cols - 1; i++) for (let k = 0; k < 3; k++) p[k]! += this.out.positions[(start + i) * 3 + k]! / (cols - 1);
    this.out.positions.push(r5(p[0]!), r5(p[1]!), r5(p[2]!));
    this.out.normals.push(0, 0, 0);
    // The cap's centre samples the region's middle: a hand's palm, a helmet's crown.
    this.out.uvs.push((o.region.u0 + o.region.u1) / 2, top ? o.region.v0 : o.region.v1);
    const w = weights4(ring.bones);
    this.out.joints.push(...w.j);
    this.out.weights.push(...w.w);
    const tri = this.out.indices[o.material ?? 0];
    for (let i = 0; i < cols - 1; i++) {
      if (top) this.tri(tri, faceNormals, centre, start + i, start + i + 1);
      else this.tri(tri, faceNormals, centre, start + i + 1, start + i);
    }
  }

  private tri(list: number[], _faces: Vec3[], a: number, b: number, c: number): void {
    const P = this.out.positions;
    const e1 = [P[b * 3]! - P[a * 3]!, P[b * 3 + 1]! - P[a * 3 + 1]!, P[b * 3 + 2]! - P[a * 3 + 2]!];
    const e2 = [P[c * 3]! - P[a * 3]!, P[c * 3 + 1]! - P[a * 3 + 1]!, P[c * 3 + 2]! - P[a * 3 + 2]!];
    const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    // A degenerate triangle (two points of a ring collapsed into one) adds nothing and is skipped.
    if (n[0]! * n[0]! + n[1]! * n[1]! + n[2]! * n[2]! < 1e-14) return;
    list.push(a, b, c);
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) this.out.normals[v * 3 + k]! += n[k]!;
  }

  private normalise(from: number): void {
    const N = this.out.normals;
    for (let v = from; v < N.length / 3; v++) {
      const l = Math.sqrt(N[v * 3]! ** 2 + N[v * 3 + 1]! ** 2 + N[v * 3 + 2]! ** 2) || 1;
      for (let k = 0; k < 3; k++) N[v * 3 + k] = r5(N[v * 3 + k]! / l);
    }
  }
}

function weights4(bones: readonly (readonly [number, number])[]): { j: number[]; w: number[] } {
  const sorted = [...bones].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const total = sorted.reduce((s, [, w]) => s + w, 0);
  const j = [0, 0, 0, 0];
  const w = [0, 0, 0, 0];
  sorted.forEach(([b, x], i) => {
    j[i] = b;
    w[i] = r5(x / total);
  });
  // Round-off lands on the heaviest weight, so each vertex sums to exactly one.
  w[0] = r5(1 - w.slice(1).reduce((s, x) => s + x, 0));
  return { j, w };
}
