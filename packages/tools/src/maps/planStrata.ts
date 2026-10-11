/** Plan-view helpers shared by the road's generated strata (U-149 supports,
 * U-160 rock): row spans of polygons, interval unions and convex clipping.
 */
export type Point = { x: number; z: number };
export type Polygon = readonly Point[];
export type Interval = [number, number];

/** The polygon's x extent on the line z (null when the line misses it). */
export function scan(polygon: Polygon, z: number): Interval | null {
  const xs: number[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
    if (z < Math.min(a.z, b.z) || z > Math.max(a.z, b.z)) continue;
    if (a.z === b.z) { if (z === a.z) xs.push(a.x, b.x); }
    else xs.push(a.x + (b.x - a.x) * (z - a.z) / (b.z - a.z));
  }
  return xs.length ? [Math.min(...xs), Math.max(...xs)] : null;
}

/** Conservative x extent over a whole row z0..z1, including vertices inside it. */
export function sweep(p: Polygon, z0: number, z1: number): Interval | null {
  const spans = [z0, z1, ...p.filter((v) => v.z > z0 && v.z < z1).map((v) => v.z)]
    .map((z) => scan(p, z)).filter((s): s is Interval => s !== null);
  return spans.length ? [Math.min(...spans.map((s) => s[0])), Math.max(...spans.map((s) => s[1]))] : null;
}

export function union(spans: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const s of spans.sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1);
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else out.push([...s]);
  }
  return out;
}

const signedArea = (p: Polygon) => p.reduce((s, a, i) => {
  const b = p[(i + 1) % p.length]!;
  return s + a.x * b.z - b.x * a.z;
}, 0) / 2;

/** Sutherland–Hodgman: the part of `subject` inside the convex `clipper`
 * (either winding). An empty result means they do not overlap. */
export function clipConvex(subject: Polygon, clipper: Polygon): Point[] {
  const turn = Math.sign(signedArea(clipper));
  let out: Point[] = [...subject];
  for (let i = 0; i < clipper.length && out.length; i++) {
    const a = clipper[i]!, b = clipper[(i + 1) % clipper.length]!;
    const side = (p: Point) => turn * ((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x));
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j]!, q = input[(j + 1) % input.length]!, sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
      }
    }
  }
  return out;
}

export const rectPolygon = (r: { minX: number; maxX: number; minZ: number; maxZ: number }): Polygon => [
  { x: r.minX, z: r.minZ }, { x: r.maxX, z: r.minZ }, { x: r.maxX, z: r.maxZ }, { x: r.minX, z: r.maxZ },
];

/** Closed point-in-convex-polygon test (either winding). */
export function inConvex(poly: Polygon, p: Point): boolean {
  const turn = Math.sign(signedArea(poly));
  return poly.every((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    return turn * ((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x)) >= -1e-9;
  });
}
