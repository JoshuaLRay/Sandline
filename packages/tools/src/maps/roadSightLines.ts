/** U-159: plan-view sight-line proofs for the primary road, before any cover,
 * landform or AI rule exists. Nothing may ever stand in the 12 m tank lane, so a
 * straight view inside it can never be blocked; and everything outside the
 * walking surface is rock (U-150), so a view between two fights that has to
 * leave the surface is blocked by construction.
 */
export type Point = { x: number; z: number };
export type Polygon = readonly Point[];
export interface Disc { x: number; z: number; r: number }
export interface Pieces { polygons: readonly Polygon[]; discs: readonly Disc[] }
export interface Segment { length: number; from: Point; to: Point }
type Spine = readonly { id: string; x: number; z: number }[];

function ribbon(a: Point, b: Point, width: number): Polygon {
  const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
  const x = -dz / length * width / 2, z = dx / length * width / 2;
  return [{ x: a.x + x, z: a.z + z }, { x: b.x + x, z: b.z + z },
    { x: b.x - x, z: b.z - z }, { x: a.x - x, z: a.z - z }];
}

export function convexHull(points: readonly Point[]): Polygon {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const half = (ps: Point[]) => {
    const out: Point[] = [];
    for (const p of ps) {
      while (out.length > 1 && cross(out.at(-2)!, out.at(-1)!, p) <= 0) out.pop();
      out.push(p);
    }
    out.pop(); return out;
  };
  return [...half(sorted), ...half(sorted.reverse())];
}

/** §2.2 ribbons of one width plus the convex bevel at every corner. */
export function ribbonPieces(spine: Spine, width: number): Polygon[] {
  const ribbons = spine.slice(1).map((p, i) => ribbon(spine[i]!, p, width));
  const bevels = spine.slice(1, -1).map((_, i) => convexHull([
    ribbons[i]![1]!, ribbons[i]![2]!, ribbons[i + 1]![0]!, ribbons[i + 1]![3]!,
  ]));
  return [...ribbons, ...bevels];
}

const area = (p: Polygon) => Math.abs(p.reduce((s, a, i) => {
  const b = p[(i + 1) % p.length]!;
  return s + a.x * b.z - b.x * a.z;
}, 0)) / 2;

/** Parameter interval of the line o + t·d (|d| = 1) inside a convex polygon
 * grown outward by `grow` along every edge normal (a mitred superset). */
function clipPolygon(poly: Polygon, o: Point, d: Point, grow: number): [number, number] | null {
  const c = { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, z: poly.reduce((s, p) => s + p.z, 0) / poly.length };
  let lo = -Infinity, hi = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const ex = b.x - a.x, ez = b.z - a.z, el = Math.hypot(ex, ez);
    if (el < 1e-12) continue;
    let nx = -ez / el, nz = ex / el;
    if (nx * (c.x - a.x) + nz * (c.z - a.z) < 0) { nx = -nx; nz = -nz; }
    // Inside: n·(o + t d - a) >= -grow.
    const base = nx * (o.x - a.x) + nz * (o.z - a.z) + grow, rate = nx * d.x + nz * d.z;
    if (Math.abs(rate) < 1e-15) { if (base < 0) return null; continue; }
    const t = -base / rate;
    if (rate > 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
    if (lo > hi) return null;
  }
  return [lo, hi];
}

function clipDisc(disc: Disc, o: Point, d: Point, grow: number): [number, number] | null {
  const r = disc.r + grow, cx = disc.x - o.x, cz = disc.z - o.z;
  const along = cx * d.x + cz * d.z, h2 = r * r - (cx * cx + cz * cz - along * along);
  if (h2 < 0) return null;
  const h = Math.sqrt(h2);
  return [along - h, along + h];
}

/** Maximal parameter intervals of the line inside the union of the pieces. */
function covered(pieces: Pieces, o: Point, d: Point, grow = 0): [number, number][] {
  const spans: [number, number][] = [];
  for (const p of pieces.polygons) { const s = clipPolygon(p, o, d, grow); if (s) spans.push(s); }
  for (const p of pieces.discs) { const s = clipDisc(p, o, d, grow); if (s) spans.push(s); }
  spans.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const s of spans) {
    const last = out.at(-1);
    // Touching spans merge: a view grazing a pinch point is still a view.
    if (last && s[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], s[1]);
    else out.push([...s]);
  }
  return out;
}

/** Exact longest straight segment inside a union of convex polygons. Some
 * longest segment always passes through two vertices of the union's boundary
 * (slide it until one pins it, then rotate: its length is convex in the angle),
 * so every polygon vertex and edge crossing is tried in pairs. */
export function longestSegment(polygons: readonly Polygon[]): Segment {
  const solid = polygons.filter((p) => area(p) > 1e-9);
  const points: Point[] = solid.flat();
  const edges = solid.flatMap((p) => p.map((a, i) => [a, p[(i + 1) % p.length]!] as const));
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const [a, b] = edges[i]!, [c, e] = edges[j]!;
    const rx = b.x - a.x, rz = b.z - a.z, sx = e.x - c.x, sz = e.z - c.z, den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / den, u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) points.push({ x: a.x + t * rx, z: a.z + t * rz });
  }
  const pieces = { polygons: solid, discs: [] };
  let best: Segment = { length: 0, from: points[0]!, to: points[0]! };
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    const o = points[i]!, p = points[j]!, length = Math.hypot(p.x - o.x, p.z - o.z);
    if (length < 1e-6) continue;
    const d = { x: (p.x - o.x) / length, z: (p.z - o.z) / length };
    const span = covered(pieces, o, d).find(([a, b]) => a <= 1e-7 && b >= length - 1e-7);
    if (span && span[1] - span[0] > best.length) best = {
      length: span[1] - span[0],
      from: { x: o.x + d.x * span[0], z: o.z + d.z * span[0] },
      to: { x: o.x + d.x * span[1], z: o.z + d.z * span[1] },
    };
  }
  return best;
}

export interface Visibility { visible: boolean; lines: number; witness?: Segment }
interface Sampling { marginM?: number; stepDeg?: number; stepM?: number }

/** Every sampled line crossing all the discs (grown by the margin), with the
 * intervals the grown pieces cover on it. Turning a real segment of at most
 * `reach` metres by up to stepDeg/2 about its midpoint and shifting it by up to
 * stepM/2 lands it on a sampled line, moving no point by more than
 * reach·sin(stepDeg/4) + stepM/2 ≤ marginM, so it shows up inside a covered
 * interval of the grown pieces. */
function* sampledLines(pieces: Pieces, discs: readonly Disc[], reach: number,
  { marginM = .25, stepDeg = .05, stepM = .1 }: Sampling) {
  const slack = reach * Math.sin(stepDeg * Math.PI / 720) + stepM / 2;
  if (slack > marginM) throw new Error(`sampling slack ${slack} m exceeds the ${marginM} m margin`);
  for (let k = 0; k * stepDeg < 180; k++) {
    const angle = k * stepDeg * Math.PI / 180, d = { x: Math.cos(angle), z: Math.sin(angle) };
    const n = { x: -d.z, z: d.x };
    let lo = -Infinity, hi = Infinity;
    for (const c of discs) {
      const u = c.x * n.x + c.z * n.z;
      lo = Math.max(lo, u - c.r - marginM); hi = Math.min(hi, u + c.r + marginM);
    }
    for (let u = Math.floor(lo / stepM) * stepM; u <= hi + 1e-12; u += stepM) {
      const o = { x: n.x * u, z: n.z * u };
      const chords = discs.map((c) => clipDisc(c, o, d, marginM));
      if (chords.some((c) => !c)) continue;
      yield { o, d, chords: chords as [number, number][], spans: covered(pieces, o, d, marginM) };
    }
  }
}

const overlaps = ([s, e]: [number, number], [a, b]: [number, number]) => Math.min(e, b) >= Math.max(s, a);
const along = (o: Point, d: Point, s: number, e: number): Segment =>
  ({ length: e - s, from: { x: o.x + d.x * s, z: o.z + d.z * s }, to: { x: o.x + d.x * e, z: o.z + d.z * e } });

/** Conservative proof that no straight segment inside the pieces joins disc a
 * to disc b: the pieces and discs are grown by the margin and sampled densely
 * enough that a real segment would appear. Returns a witness otherwise. */
export function discsSeeEachOther(pieces: Pieces, a: Disc, b: Disc, sampling: Sampling = {}): Visibility {
  let lines = 0;
  const reach = Math.hypot(b.x - a.x, b.z - a.z) + a.r + b.r;
  for (const { o, d, chords, spans } of sampledLines(pieces, [a, b], reach, sampling)) {
    lines++;
    const span = spans.find((s) => overlaps(s, chords[0]!) && overlaps(s, chords[1]!));
    if (span) return { visible: true, lines, witness: along(o, d, span[0], span[1]) };
  }
  return { visible: false, lines };
}

/** Upper bound on the longest straight view from any point of the disc along
 * the pieces (each view is measured from where it leaves the disc's far side
 * or enters it, to the far end of the open interval). Grown geometry makes
 * the bound conservative; `reach` caps the views it can certify. */
export function farthestView(pieces: Pieces, disc: Disc, reach = 400, sampling: Sampling = {}): Segment {
  let best: Segment = { length: 0, from: disc, to: disc };
  for (const { o, d, chords, spans } of sampledLines(pieces, [disc], reach, sampling)) {
    const [c0, c1] = chords[0]!;
    for (const [s, e] of spans) {
      if (!overlaps([s, e], [c0, c1])) continue;
      const near = Math.max(s, c0), far = Math.min(e, c1);
      if (e - near > best.length) best = along(o, d, near, e);
      if (far - s > best.length) { const v = along(o, d, s, far); best = { length: v.length, from: v.to, to: v.from }; }
    }
  }
  if (best.length > reach) throw new Error(`a ${best.length} m view exceeds the certified ${reach} m`);
  return best;
}
