import { describe, expect, it } from 'vitest';
import { blockedAt, supportUnder, type WorldBox } from '@sandline/shared';
import { buildRoadSupportWorld } from './qalatRoadSupports.ts';
import { convexHull, type Point, type Polygon } from './roadSightLines.ts';

// Independent §6.1/6.2 transcription. These are clearance witnesses inside
// the same shelf, not new nodes, stairs or routes.
const R3 = [
  { x: 64, z: 128 }, { x: 78.4, z: 164 }, { x: 78.5, z: 174 },
  { x: 80 + 14 * 11 / 42, z: 179 }, { x: 94, z: 210 },
];
const R6 = [
  { x: 86, z: 248 }, { x: 86 - 14 * 27.5 / 38, z: 275.5 },
  { x: 71.5, z: 281.9 }, { x: 71.5, z: 290 }, { x: 71.5, z: 295 }, { x: 70, z: 322 },
];
const OLD_NODES = [
  { x: 62, z: 68 }, { x: 78, z: 96 }, { x: 64, z: 128 }, { x: 80, z: 168 },
  { x: 94, z: 210 }, { x: 86, z: 248 }, { x: 72, z: 286 }, { x: 70, z: 322 },
];
const EPS = 1e-7;
type Span = [number, number];
const rect = (minX: number, maxX: number, minZ: number, maxZ: number): Polygon =>
  [{ x: minX, z: minZ }, { x: maxX, z: minZ }, { x: maxX, z: maxZ }, { x: minX, z: maxZ }];

/** Width is perpendicular to each local direction, including diagonal turns. */
function lane(points: Point[]): Polygon[] {
  const ribbons = points.slice(1).map((b, i) => {
    const a = points[i]!, l = Math.hypot(b.x - a.x, b.z - a.z);
    const nx = -(b.z - a.z) / l * 4, nz = (b.x - a.x) / l * 4;
    return [{ x: a.x + nx, z: a.z + nz }, { x: b.x + nx, z: b.z + nz },
      { x: b.x - nx, z: b.z - nz }, { x: a.x - nx, z: a.z - nz }];
  });
  return [...ribbons, ...ribbons.slice(1).map((r, i) =>
    convexHull([ribbons[i]![1]!, ribbons[i]![2]!, r[0]!, r[3]!]))];
}
const oldFloor = [...lane(OLD_NODES),
  rect(72, 84, 90, 102), rect(58, 70, 122, 134), rect(74, 86, 158, 182),
  rect(88, 100, 204, 216), rect(80, 92, 242, 254), rect(66, 78, 280, 292), rect(66, 74, 320, 322)];

function spanAt(poly: Polygon, z: number): Span | undefined {
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    if (z < Math.min(a.z, b.z) - EPS || z > Math.max(a.z, b.z) + EPS) continue;
    if (Math.abs(a.z - b.z) < EPS) xs.push(a.x, b.x);
    else xs.push(a.x + (b.x - a.x) * (z - a.z) / (b.z - a.z));
  }
  return xs.length ? [Math.min(...xs), Math.max(...xs)] : undefined;
}
function merged(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of spans.sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1);
    if (last && s[0] <= last[1] + EPS) last[1] = Math.max(last[1], s[1]); else out.push([...s]);
  }
  return out;
}
function gaps(span: Span, covering: Span[]): Span[] {
  let x = span[0];
  const out: Span[] = [];
  for (const [lo, hi] of covering) {
    if (lo > x + EPS) out.push([x, Math.min(lo, span[1])]);
    x = Math.max(x, hi);
    if (x >= span[1] - EPS) return out;
  }
  if (x < span[1] - EPS) out.push([x, span[1]]);
  return out;
}

/** Endpoints are affine between vertices/edge crossings. Testing both ends
 * and the midpoint of every resulting band covers the whole polygon union. */
function stations(polys: Polygon[]): number[] {
  const edges = polys.flatMap((p) => p.map((a, i) => [a, p[(i + 1) % p.length]!] as const));
  const zs = polys.flatMap((p) => p.map((v) => v.z));
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const [a, b] = edges[i]!, [c, d] = edges[j]!;
    const rx = b.x - a.x, rz = b.z - a.z, sx = d.x - c.x, sz = d.z - c.z;
    const den = rx * sz - rz * sx;
    if (Math.abs(den) < EPS) continue;
    const t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / den;
    const u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) zs.push(a.z + t * rz);
  }
  const sorted = [...new Set(zs)].sort((a, b) => a - b);
  return [...sorted, ...sorted.slice(1).map((z, i) => (z + sorted[i]!) / 2)];
}
function missing(polys: Polygon[], support: Polygon[]): Point[] {
  const out: Point[] = [];
  for (const z of stations([...polys, ...support])) {
    const cover = merged(support.flatMap((p) => { const s = spanAt(p, z); return s ? [s] : []; }));
    for (const p of polys) {
      const s = spanAt(p, z);
      if (s) for (const [lo, hi] of gaps(s, cover)) out.push({ x: lo, z }, { x: hi, z });
    }
  }
  return out;
}

const world = buildRoadSupportWorld();
describe('U-165 continuous eight-metre clearance past ridge furnishings', () => {
  it('joins both unchanged R3 stair ribbons through the original flat combat shelf at full width', () => {
    expect(missing(lane(R3), oldFloor)).toEqual([]);
    const incoming = R3[1]!, outgoing = R3.at(-2)!;
    expect((incoming.x - 64) * 40 - (incoming.z - 128) * 16).toBeCloseTo(0, 9);
    expect((outgoing.x - 80) * 42 - (outgoing.z - 168) * 14).toBeCloseTo(0, 9);
  });

  it('needs a bounded R6 rest bevel and preserves all original riser lines on both sides', () => {
    const local = lane(R6.slice(1, -1)), added = missing(local, oldFloor);
    // Negative control: a wide west strip on the pad alone is insufficient.
    expect(added.length).toBeGreaterThan(0);
    const incomingLength = Math.hypot(14, 38), outgoingLength = Math.hypot(2, 36);
    for (const p of [...added, ...local.flat()]) {
      const incoming = ((p.x - 86) * -14 + (p.z - 248) * 38) / incomingLength;
      const outgoing = ((p.x - 72) * -2 + (p.z - 286) * 36) / outgoingLength;
      expect(incoming).toBeGreaterThan(26.829845357133184); // Existing last R5→R6 riser.
      expect(outgoing).toBeLessThan(10.432783753431398); // Existing first R6→R7 riser.
    }
    expect(missing(lane(R6), [...oldFloor, ...local])).toEqual([]);
    // Preserve the complete §6.2 F3 footprint, including its northeast tip.
    // U-141 may finish its prescribed y36 silhouette without narrowing this lane.
    const fin = rect(66, 72, 260, 274), full = lane(R6);
    for (const z of stations([...full, fin])) {
      const f = spanAt(fin, z);
      if (!f) continue;
      for (const p of full) {
        const s = spanAt(p, z);
        if (s) expect(Math.min(s[1], f[1]) - Math.max(s[0], f[0])).toBeLessThanOrEqual(EPS);
      }
    }
  });

  it('supports every point of both full-width lanes in the built world with standing clearance', () => {
    let bands = 0, actors = 0;
    // Include the full bevel at each join to the existing diagonal stair ribbon.
    const r3 = [{ x: 64 + 16 * 35 / 40, z: 163 }, ...R3.slice(1, -1), { x: 80 + 14 * 12 / 42, z: 180 }];
    const r6 = [{ x: 86 - 14 * 26.5 / 38, z: 274.5 }, ...R6.slice(1, -1), { x: 72 - 2 * 10 / 36, z: 296 }];
    for (const points of [r3, r6]) {
      const polys = lane(points), minX = Math.min(...polys.flat().map((p) => p.x)), maxX = Math.max(...polys.flat().map((p) => p.x));
      const minZ = Math.min(...polys.flat().map((p) => p.z)), maxZ = Math.max(...polys.flat().map((p) => p.z));
      const boxes = world.boxes.filter((b) => b.maxX >= minX && b.minX <= maxX && b.maxZ >= minZ && b.minZ <= maxZ);
      const floors = boxes.filter((b) => Math.abs(b.maxY - 26) < EPS);
      const blockers = boxes.filter((b) => b.minY < 27.8 && b.maxY > 26 + EPS);
      const base = [...new Set([...polys.flat().map((p) => p.z), ...boxes.flatMap((b) => [b.minZ, b.maxZ])])]
        .filter((z) => z >= minZ && z <= maxZ).sort((a, b) => a - b);
      // Every possible lane-edge/box-edge endpoint ordering change is included.
      const zs = [...base];
      for (const p of polys) for (let k = 0; k < p.length; k++) {
        const a = p[k]!, b = p[(k + 1) % p.length]!;
        if (Math.abs(a.x - b.x) < EPS) continue;
        for (const box of boxes) for (const x of [box.minX, box.maxX]) {
          const t = (x - a.x) / (b.x - a.x), z = a.z + t * (b.z - a.z);
          if (t > 0 && t < 1 && z >= box.minZ && z <= box.maxZ) zs.push(z);
        }
      }
      const sorted = [...new Set(zs)].sort((a, b) => a - b);
      let failure: string | undefined;
      for (const z of [...sorted, ...sorted.slice(1).map((v, i) => (v + sorted[i]!) / 2)]) {
        const cover = merged(floors.filter((b) => b.minZ <= z + EPS && b.maxZ >= z - EPS).map((b): Span => [b.minX, b.maxX]));
        const walls = blockers.filter((b) => b.minZ < z - EPS && b.maxZ > z + EPS);
        for (const p of polys) {
          const s = spanAt(p, z);
          if (!s || s[1] - s[0] <= EPS) continue;
          if (gaps(s, cover).length) failure ??= `unsupported width at z${z}: ${JSON.stringify(s)}`;
          if (walls.some((b) => Math.min(s[1], b.maxX) - Math.max(s[0], b.minX) > EPS))
            failure ??= `standing obstruction at z${z}: ${JSON.stringify(s)}`;
          bands++;
        }
      }
      expect(failure).toBeUndefined();
      // Ordinary standing body checks across each diagonal and its transition.
      for (let k = 1; k < points.length; k++) {
        const a = points[k - 1]!, b = points[k]!, l = Math.hypot(b.x - a.x, b.z - a.z);
        const ux = (b.x - a.x) / l, uz = (b.z - a.z) / l;
        for (let t = .4; t <= l - .4; t += .2) for (let off = -3.4; off <= 3.4 + EPS; off += .4) {
          const x = a.x + ux * t - uz * off, z = a.z + uz * t + ux * off;
          const near: WorldBox[] = boxes.filter((q) => q.maxX > x - .35 && q.minX < x + .35 && q.maxZ > z - .35 && q.minZ < z + .35);
          expect(supportUnder(x, z, .35, 26.1, near, 0)).toBe(26);
          expect(blockedAt(x, z, .35, 26, .45, 1.8, near), `body ${x}/${z}`).toBe(false);
          actors++;
        }
      }
    }
    expect(bands).toBeGreaterThan(1_000);
    expect(actors).toBeGreaterThan(2_000);
    console.log('U-165 full-width clearance', JSON.stringify({ bands, actors }));
  }, 60_000);
});
