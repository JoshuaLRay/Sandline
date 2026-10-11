/** U-161: conservative ordinary-fire proofs, including the physical cover.
 * A clear segment is rotated about its midpoint to the nearest sampled angle,
 * then translated to the nearest sampled offset. This rigid motion preserves
 * length and moves every point by at most reach*sin(stepDeg/4)+stepM/2.
 * Growing the open surface and eye areas, while eroding certified solid cover
 * by that displacement, therefore retains EVERY real clear segment. The
 * longest sampled interval is an upper bound, rather than a sampled verdict.
 * Standing endpoints may additionally exclude the exact controller-square
 * Minkowski sum of a certified solid. Eroding that exclusion by the same
 * displacement retains every mapped valid endpoint; ray interiors stay air.
 */
import type { BoxSpec } from '@sandline/shared';
import { sweep, union, type Interval } from './planStrata.ts';
import type { Disc, Pieces, Point, Polygon, Segment } from './roadSightLines.ts';

export interface CombatSightOptions {
  reachM?: number;
  stepDeg?: number;
  stepM?: number;
  marginM?: number;
  /** U-160's row-swept rock stands back from the exact floor by <0.12 m. */
  surfaceExpansionM?: number;
  /** Shared controller footprints are axis-aligned squares of half-size .35 m.
   * This removes invalid actor endpoints only, never clear ray interiors. */
  endpointHalfSizeM?: number;
}
interface Edge { nx: number; nz: number; offset: number }
const prepare = (poly: Polygon): Edge[] => {
  if (poly.length < 3 || poly.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.z))) {
    throw new Error('combat sight requires finite nondegenerate convex polygons');
  }
  const c = { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, z: poly.reduce((s, p) => s + p.z, 0) / poly.length };
  const edges = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length]!, l = Math.hypot(b.x - a.x, b.z - a.z);
    let nx = -(b.z - a.z) / l, nz = (b.x - a.x) / l;
    if (nx * (c.x - a.x) + nz * (c.z - a.z) < 0) { nx = -nx; nz = -nz; }
    return { nx, nz, offset: nx * a.x + nz * a.z };
  }).filter((e) => Number.isFinite(e.nx));
  const area2 = poly.reduce((sum, p, i) => {
    const q = poly[(i + 1) % poly.length]!; return sum + p.x * q.z - q.x * p.z;
  }, 0);
  if (edges.length < 3 || Math.abs(area2) < 1e-8 || edges.some(({ nx, nz, offset }) =>
    poly.some((p) => nx * p.x + nz * p.z < offset - 1e-8))) {
    throw new Error('combat sight requires nondegenerate convex polygons');
  }
  return edges;
};

/** Exact polygon Minkowski sum with the controller's axis-aligned square. */
function squareHull(poly: Polygon, halfSize: number): Polygon {
  const points = poly.flatMap((p) => [-1, 1].flatMap((x) => [-1, 1].map((z) =>
    ({ x: p.x + x * halfSize, z: p.z + z * halfSize })))).sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const half = (ps: Point[]) => {
    const out: Point[] = [];
    for (const p of ps) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) out.pop();
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...half(points), ...half([...points].reverse())];
}

function clip(edges: readonly Edge[], o: Point, d: Point, grow: number): Interval | null {
  let lo = -Infinity, hi = Infinity;
  for (const { nx, nz, offset } of edges) {
    const base = nx * o.x + nz * o.z - offset + grow, rate = nx * d.x + nz * d.z;
    if (Math.abs(rate) < 1e-14) { if (base < 0) return null; continue; }
    const t = -base / rate;
    if (rate > 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
    if (lo > hi) return null;
  }
  return [lo, hi];
}
function discClip(disc: Disc, o: Point, d: Point, grow: number): Interval | null {
  const cx = disc.x - o.x, cz = disc.z - o.z, along = cx * d.x + cz * d.z;
  const h2 = (disc.r + grow) ** 2 - (cx * cx + cz * cz - along * along);
  if (h2 < 0) return null;
  const h = Math.sqrt(h2); return [along - h, along + h];
}
function subtract(open: Interval[], blocked: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [a, b] of open) {
    let start = a;
    for (const [c, e] of blocked) {
      if (e <= start || c >= b) continue;
      if (c > start) out.push([start, c]);
      start = Math.max(start, e);
      if (start >= b) break;
    }
    if (start < b) out.push([start, b]);
  }
  return out;
}
const along = (o: Point, d: Point, a: number, b: number): Segment => ({ length: b - a,
  from: { x: o.x + d.x * a, z: o.z + d.z * a }, to: { x: o.x + d.x * b, z: o.z + d.z * b } });
const ceil = (n: number) => Math.ceil(n * 1000) / 1000;

/** `blockers` must be certified inside actual solids spanning every height
 * from road feet to a standing head. Low walls do not count as tall blockers.
 * An omitted eye disc asks for the longest view anywhere on the road. */
export function conservativeCombatView(surface: Pieces, blockers: readonly Polygon[], area?: Disc,
  options: CombatSightOptions = {}) {
  const { reachM = 400, stepDeg = .1, stepM = .2, marginM = .3, surfaceExpansionM = .12,
    endpointHalfSizeM = 0 } = options;
  const displacementM = reachM * Math.sin(stepDeg * Math.PI / 720) + stepM / 2;
  if (![reachM, stepDeg, stepM, marginM, surfaceExpansionM, endpointHalfSizeM].every(Number.isFinite) ||
    !(stepDeg > 0 && stepDeg <= 180 && stepM > 0 && reachM > 0 && marginM >= 0 && surfaceExpansionM >= 0 && endpointHalfSizeM >= 0)) {
    throw new Error('invalid combat sight proof spacing or margin');
  }
  if (displacementM > marginM) throw new Error(`sampling displacement ${displacementM} exceeds margin ${marginM}`);
  const discs = [...surface.discs, ...(area ? [area] : [])];
  if ((!surface.polygons.length && !surface.discs.length) ||
    discs.some((c) => ![c.x, c.z, c.r].every(Number.isFinite) || c.r < 0)) {
    throw new Error('combat sight requires a nonempty finite surface and finite eye discs');
  }
  const polygons = surface.polygons.map(prepare), solid = blockers.map(prepare);
  const endpointPolygons = endpointHalfSizeM > 0 ? blockers.map((p) => squareHull(p, endpointHalfSizeM)) : [];
  const endpointSolid = endpointPolygons.map(prepare);
  const grow = marginM + surfaceExpansionM;
  const bounds = surface.polygons.flat().concat(surface.discs.flatMap((c) => [
    { x: c.x - c.r, z: c.z - c.r }, { x: c.x - c.r, z: c.z + c.r },
    { x: c.x + c.r, z: c.z - c.r }, { x: c.x + c.r, z: c.z + c.r },
  ]));
  const physicalReachM = Math.hypot(Math.max(...bounds.map((p) => p.x)) - Math.min(...bounds.map((p) => p.x)),
    Math.max(...bounds.map((p) => p.z)) - Math.min(...bounds.map((p) => p.z))) + 2 * surfaceExpansionM;
  if (physicalReachM > reachM) throw new Error(`physical surface reach ${physicalReachM} exceeds certified ${reachM} m reach`);
  let best: Segment = { length: 0, from: area ?? bounds[0]!, to: area ?? bounds[0]! }, lines = 0;
  for (let k = 0; k * stepDeg < 180; k++) {
    const a = k * stepDeg * Math.PI / 180, d = { x: Math.cos(a), z: Math.sin(a) }, n = { x: -d.z, z: d.x };
    // Most lines miss a small cover piece. Projection rejection is exact and
    // avoids traversing every trunk's 32 edges on every global-road line.
    const candidates = solid.map((edges, i) => {
      const u = blockers[i]!.map((p) => p.x * n.x + p.z * n.z);
      return { edges, lo: Math.min(...u), hi: Math.max(...u) };
    });
    const endpointCandidates = endpointSolid.map((edges, i) => {
      const u = endpointPolygons[i]!.map((p) => p.x * n.x + p.z * n.z);
      return { edges, lo: Math.min(...u), hi: Math.max(...u) };
    });
    const centre = area ? area.x * n.x + area.z * n.z : 0;
    const projections = area ? [] : bounds.map((p) => p.x * n.x + p.z * n.z);
    const lo = area ? centre - area.r - marginM : Math.min(...projections) - grow;
    const hi = area ? centre + area.r + marginM : Math.max(...projections) + grow;
    for (let offset = Math.floor(lo / stepM) * stepM; offset <= hi + 1e-12; offset += stepM) {
      const o = { x: n.x * offset, z: n.z * offset }, chord = area ? discClip(area, o, d, marginM) : null;
      if (area && !chord) continue;
      const spans = union([
        ...polygons.map((p) => clip(p, o, d, grow)), ...surface.discs.map((c) => discClip(c, o, d, grow)),
      ].filter((s): s is Interval => s !== null));
      const blocked = union(candidates.filter((p) => offset >= p.lo && offset <= p.hi)
        .map((p) => clip(p.edges, o, d, -marginM)).filter((s): s is Interval => s !== null));
      lines++;
      let invalidEndpoints: Interval[] | undefined;
      for (const [s, e] of subtract(spans, blocked)) {
        if (chord && (e < chord[0] || s > chord[1])) continue;
        const potential = chord ? Math.max(e - Math.max(s, chord[0]), Math.min(e, chord[1]) - s) : e - s;
        if (potential <= best.length) continue;
        invalidEndpoints ??= union(endpointCandidates.filter((p) => offset >= p.lo && offset <= p.hi)
          .map((p) => clip(p.edges, o, d, -marginM)).filter((v): v is Interval => v !== null));
        const valid = subtract([[s, e]], invalidEndpoints);
        if (!valid.length) continue;
        const first = valid[0]![0], last = valid[valid.length - 1]![1];
        for (const [a, b] of valid) {
          if (chord && (b < chord[0] || a > chord[1])) continue;
          const from = chord ? Math.max(a, chord[0]) : a, to = chord ? Math.min(b, chord[1]) : b;
          if (last - from > best.length) best = along(o, d, from, last);
          if (chord && to - first > best.length) {
            const v = along(o, d, first, to); best = { length: v.length, from: v.to, to: v.from };
          }
        }
      }
    }
  }
  if (best.length > reachM) throw new Error(`${best.length} m view exceeds certified ${reachM} m reach`);
  return { upperBoundM: ceil(best.length), witness: best, sampledLines: lines, displacementM: ceil(displacementM),
    marginM, surfaceExpansionM, endpointHalfSizeM, stepDeg, stepM, reachM };
}

/** Exact containment of each inner occluder in the UNION of actual high boxes.
 * Split at every box/polygon z boundary; on each complete band the swept
 * polygon interval must lie inside the boxes present for the whole band.
 * This verifies stepped rotated proxies without eroding strips separately. */
export function certifySightBlockers(blockers: readonly Polygon[], boxes: readonly BoxSpec[], floorY = 8, headHeightM = 1.8) {
  const high = boxes.filter((b) => b.y <= floorY + 1e-9 && b.y + b.h >= floorY + headHeightM - 1e-9);
  let bands = 0;
  for (const [i, p] of blockers.entries()) {
    const minZ = Math.min(...p.map((v) => v.z)), maxZ = Math.max(...p.map((v) => v.z));
    const candidates = high.filter((b) => b.z + b.d / 2 >= minZ && b.z - b.d / 2 <= maxZ);
    const levels = [...new Set([minZ, maxZ, ...p.map((v) => v.z), ...candidates.flatMap((b) => [b.z - b.d / 2, b.z + b.d / 2])
      .filter((z) => z > minZ && z < maxZ)])].sort((a, b) => a - b);
    for (let n = 1; n < levels.length; n++) {
      const z0 = levels[n - 1]!, z1 = levels[n]!;
      if (z1 - z0 < 1e-10) continue;
      const need = sweep(p, z0, z1);
      if (!need) continue;
      const have = union(candidates.filter((b) => b.z - b.d / 2 <= z0 + 1e-9 && b.z + b.d / 2 >= z1 - 1e-9)
        .map((b) => [b.x - b.w / 2, b.x + b.w / 2]));
      if (!have.some(([a, b]) => a <= need[0] + 1e-8 && b >= need[1] - 1e-8)) {
        throw new Error(`sight blocker ${i} lacks actual high solid at z${z0}..${z1}`);
      }
      bands++;
    }
  }
  return { occluders: blockers.length, checkedBands: bands, floorY, headHeightM };
}

export function combatSightReport(surface: Pieces, areas: readonly (Disc & { id: string })[], blockers: readonly Polygon[],
  { includeWholeRoadView = true }: { includeWholeRoadView?: boolean } = {}) {
  const options = { marginM: .14, stepDeg: .05, stepM: .1, endpointHalfSizeM: .35 };
  const views = areas.map((area) => [area.id, conservativeCombatView(surface, blockers, area, options)] as const);
  return { method: 'rigid line-family superset; expanded surface and whole apron eyes; eroded certified high solids; exact controller-square endpoint exclusion',
    ordinaryEyeDomain: areas.map(({ id, x, z, r }) => ({ id, x, z, radiusM: r })),
    maxOrdinaryLaneM: 90, longestFightViews: Object.fromEntries(views),
    endpointDomain: 'whole road and office; all valid controller-square standing endpoints; ray interiors unchanged',
    ...(includeWholeRoadView ? { longestRoadView: conservativeCombatView(surface, blockers, undefined, options) } : {}) };
}
