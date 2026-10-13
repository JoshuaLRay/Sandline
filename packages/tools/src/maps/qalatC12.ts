/** U-168: the two exposed, reversible §6.3 stairs. Collision and rendering
 * share these strata; their raised floors never become y8 road aprons. */
import type { BoxSpec } from '@sandline/shared';
import source from './qalat-c12.json' with { type: 'json' };
import { convexHull, ribbonPieces } from './roadSightLines.ts';
import { clipConvex, inConvex, rectPolygon, sweep, union, type Interval, type Point, type Polygon } from './planStrata.ts';
import { VIEW_FANS, capUnder } from './qalatRoadTerrain.ts';

export const C12 = source;
const ROWS_PER_M = 20, EDGE_M = .005, TOUCH_M = 1e-7;
// The road and ridge mass rows (0.5 m, ±0.01 m) are the coarsest rows that
// carve `crossingCarve`. The barrier fills each whole carved row: no seam.
const CARVE_ROWS_PER_M = 2, CARVE_MARGIN_M = 2 * EDGE_M;
// Every floor this close sets the barrier height: a carved row plus the band.
const NEAR_M = 1.1;
// A fan slot piece is split until its listed rays stay this far under the canopy.
const SLOT_CLEAR_M = .05, SLOT_MIN_PIECE_M = .02;
type Span = { lo: number; hi: number; y: number };
type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
type Node = typeof C12.stairs[number]['spine'][number];
export interface CrossingFlight {
  crossing: string; from: string; to: string; length: number; t0: number; t1: number;
  risers: number[]; treadM: number; restLandingM: number; fromY: number; toY: number;
}
interface Floor { id: string; polygon: Polygon; height: (p: Point) => number; cuts: (z: number) => number[] }
const landing = (n: Node): Polygon => rectPolygon({ minX: n.x - C12.landingM / 2,
  maxX: n.x + C12.landingM / 2, minZ: n.z - C12.landingM / 2, maxZ: n.z + C12.landingM / 2 });
const flat = (id: string, polygon: Polygon, y: number): Floor => ({ id, polygon, height: () => y, cuts: () => [] });

/** Waypoint pads provide the terminal rests. Between them the ten-riser
 * flights use nine tread intervals, with at least two level metres between
 * the last riser of one flight and the first riser of the next. Reject an
 * impossible run rather than overlap a waypoint pad or silently shrink it. */
export function crossingFlights(): CrossingFlight[] {
  return C12.stairs.flatMap((s) => s.spine.slice(1).map((b, i) => {
    const a = s.spine[i]!, length = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / length, uz = (b.z - a.z) / length;
    const reach = C12.landingM / 2 * (Math.abs(ux) + Math.abs(uz));
    const t0 = reach, t1 = length - reach, n = s.risers[i]!;
    const treadM = C12.compactTreads.find((c) => c.crossing === s.id && c.from === a.id && c.to === b.id)?.treadM ?? C12.treadM;
    if (Math.abs(b.y - a.y - n * C12.riserM) > 1e-9 || n % C12.flightRisers)
      throw new Error(`${s.id} ${a.id}→${b.id}: ${n} risers cannot climb ${b.y - a.y} m`);
    const flights = n / C12.flightRisers, run = (C12.flightRisers - 1) * treadM;
    const restLandingM = flights > 1 ? C12.restLandingM : t1 - t0;
    if (flights > 1 && t1 - t0 < flights * run + (flights - 1) * restLandingM - 1e-9)
      throw new Error(`${s.id} ${a.id}→${b.id}: ${t1 - t0} m run cannot fit ${n} risers on ${treadM} m treads plus ${C12.restLandingM} m rests`);
    const risers = Array.from({ length: n }, (_, k) => t0 + Math.floor(k / C12.flightRisers) * (run + restLandingM) + k % C12.flightRisers * treadM);
    return { crossing: s.id, from: a.id, to: b.id, length, t0, t1, risers, treadM, restLandingM, fromY: a.y, toY: b.y };
  }));
}

export function crossingHeight(f: CrossingFlight, t: number): number {
  return f.fromY + C12.riserM * f.risers.filter((r) => r <= t + 1e-9).length;
}

/** The floor footprint is independent of the stair recipe validation. */
let cachedPolygons: readonly Polygon[] | undefined;
export function crossingFloors(): readonly Polygon[] {
  return cachedPolygons ??= C12.stairs.flatMap((s) => [...ribbonPieces(s.spine, C12.widthM), ...s.spine.map(landing)]);
}
export function onCrossingFloor(p: Point, margin = 0): boolean {
  return crossingFloors().some((poly) => margin >= 0
    ? inConvex(convexHull(poly.flatMap((v) => [-margin, margin].flatMap((dx) => [-margin, margin].map((dz) => ({ x: v.x + dx, z: v.z + dz }))))), p)
    : [-margin, margin].flatMap((dx) => [-margin, margin].map((dz) => ({ x: p.x + dx, z: p.z + dz }))).every((v) => inConvex(poly, v)));
}
/** Leave room for the barrier band; the road and ridge rock stand back by this much. */
export function crossingCarve(): readonly Polygon[] {
  const e = C12.barrierWidthM + EDGE_M * 2;
  return crossingFloors().map((poly) => convexHull(poly.flatMap((v) => [-e, e].flatMap((dx) => [-e, e].map((dz) => ({ x: v.x + dx, z: v.z + dz }))))));
}

let cachedFloors: Floor[] | undefined;
function floors(): Floor[] {
  if (cachedFloors) return cachedFloors;
  const flights = crossingFlights();
  return cachedFloors = C12.stairs.flatMap((s) => {
    const pieces = ribbonPieces(s.spine, C12.widthM);
    return [...s.spine.slice(1).map((b, i): Floor => {
      const a = s.spine[i]!, f = flights.find((f) => f.crossing === s.id && f.from === a.id)!;
      const ux = (b.x - a.x) / f.length, uz = (b.z - a.z) / f.length;
      return { id: `${s.id}-${a.id}-${b.id}`, polygon: pieces[i]!,
        height: (p) => crossingHeight(f, (p.x - a.x) * ux + (p.z - a.z) * uz),
        cuts: (z) => Math.abs(ux) < 1e-9 ? [] : f.risers.map((r) => a.x + (r - (z - a.z) * uz) / ux) };
    }), ...s.spine.map((n) => flat(`${s.id}-${n.id}-landing`, landing(n), n.y)),
    ...pieces.slice(s.spine.length - 1).map((poly, i) => flat(`${s.id}-bevel-${i}`, poly, s.spine[i + 1]!.y))];
  });
}

/** Constant-height spans weld the rasterized riser lines and waypoint pads.
 * Highest floor wins only between pieces of this same crossing. */
export function crossingFloorSpans(z0: number, z1: number): { lo: number; hi: number; y: number }[] {
  const zm = (z0 + z1) / 2, raw: { lo: number; hi: number; y: number }[] = [];
  for (const f of floors()) {
    const span = sweep(f.polygon, z0 + TOUCH_M, z1 - TOUCH_M);
    if (!span) continue;
    const lo = span[0] - EDGE_M, hi = span[1] + EDGE_M;
    const xs = [lo, ...f.cuts(zm).filter((x) => x > lo && x < hi).sort((a, b) => a - b), hi];
    for (let i = 1; i < xs.length; i++) raw.push({ lo: xs[i - 1]!, hi: xs[i]!, y: f.height({ x: (xs[i - 1]! + xs[i]!) / 2, z: zm }) });
  }
  const xs = [...new Set(raw.flatMap((r) => [r.lo, r.hi]))].sort((a, b) => a - b), out: typeof raw = [];
  for (let i = 1; i < xs.length; i++) {
    const lo = xs[i - 1]!, hi = xs[i]!, y = Math.max(...raw.filter((r) => r.lo <= lo && r.hi >= hi).map((r) => r.y));
    if (y === -Infinity) continue;
    const previous = out.at(-1);
    if (previous?.hi === lo && previous.y === y) previous.hi = hi; else out.push({ lo, hi, y });
  }
  return out;
}

/** Terminal stair cuts replace only the overlapping ridge floor columns;
 * the full-height part of the stair welds back into its existing node pad. */
export function crossingMouthSpans(z0: number, z1: number): Interval[] {
  return union(crossingFloorSpans(z0, z1).map(({ lo, hi }) => [lo, hi]));
}

const nearest = (poly: readonly Point[], p: Point): Point => {
  if (inConvex(poly, p)) return p;
  let best = poly[0]!, distance = Infinity;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length]!, dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
    const q = { x: a.x + dx * t, z: a.z + dz * t }, d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < distance) { distance = d; best = q; }
  });
  return best;
};

/** Lowest and highest §6.2 ray surface over a plan cell (±Infinity outside
 * every fan). The surface descends away from each eye: planar sectors are
 * extreme at clip vertices, and a ray-following sector peaks nearest the eye. */
export function crossingFanRange(r: Rect): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  const cell = rectPolygon({ minX: r.minX - 1e-6, maxX: r.maxX + 1e-6, minZ: r.minZ - 1e-6, maxZ: r.maxZ + 1e-6 });
  for (const fan of VIEW_FANS) {
    const inside = clipConvex(cell, fan.hull);
    if (!inside.length) continue;
    for (const s of fan.sectors) {
      const piece = clipConvex(inside, s.wedge);
      if (!piece.length) continue;
      for (const v of [...piece, nearest(piece, fan.eye)]) { const h = s.height(v); min = Math.min(min, h); max = Math.max(max, h); }
    }
  }
  return { min, max };
}

interface Piece { lo: number; hi: number; bottom: number; top: number; kind: 'crossing-rock' | 'crossing-lip' | 'crossing-canopy' }
/** One barrier interval: plain rock outside the fans; inside one, a lip
 * 0.3 m under the lowest listed ray and a canopy above a 0.7 m slot that
 * passes every listed ray (split until it does) but no controller stance. */
function barrier(lo: number, hi: number, z0: number, z1: number, floor: number): Piece[] {
  const top = floor + C12.barrierM, range = crossingFanRange({ minX: lo, maxX: hi, minZ: z0, maxZ: z1 });
  const cap = capUnder(range.min);
  if (cap >= top) return [{ lo, hi, bottom: C12.bottomY, top, kind: 'crossing-rock' }];
  if (range.max > cap + C12.fanSlotM - SLOT_CLEAR_M) {
    if (hi - lo < SLOT_MIN_PIECE_M) throw new Error(`C12 fan slot at x${lo} z${z0}: ray ${range.max} above ${cap} + ${C12.fanSlotM}`);
    const mid = (lo + hi) / 2;
    return [...barrier(lo, mid, z0, z1, floor), ...barrier(mid, hi, z0, z1, floor)];
  }
  // Whether or not a body can step onto the lip, the canopy leaves less
  // than the 0.8 m prone height above it and above any lower floor beside it.
  return [{ lo, hi, bottom: C12.bottomY, top: cap, kind: 'crossing-lip' },
    { lo, hi, bottom: cap + C12.fanSlotM, top: Math.max(top, cap + C12.fanSlotM + C12.fanCanopyMinM), kind: 'crossing-canopy' }];
}

/** Floors, then the barrier band. `ridgeSpans` gives the adjoining ridge
 * floor heights: a barrier stands 2.2 m above the higher side. */
export function buildCrossings(ground: readonly Polygon[] = [], ridge: readonly Polygon[] = [],
  ridgeSpans: (z0: number, z1: number) => Span[] = () => []): BoxSpec[] {
  // Validate before emitting any partial geometry.
  crossingFlights();
  const outer = crossingCarve(), zs = outer.flatMap((p) => p.map((v) => v.z));
  const first = Math.floor(Math.min(...zs) * CARVE_ROWS_PER_M) * ROWS_PER_M / CARVE_ROWS_PER_M;
  const last = Math.ceil(Math.max(...zs) * CARVE_ROWS_PER_M) * ROWS_PER_M / CARVE_ROWS_PER_M;
  const reach = Math.ceil(NEAR_M * ROWS_PER_M), heights = new Map<number, Span[]>(), crossingRows = new Map<number, Span[]>();
  const rowSpans = (row: number) => {
    let spans = crossingRows.get(row);
    if (!spans) crossingRows.set(row, spans = crossingFloorSpans(row / ROWS_PER_M, (row + 1) / ROWS_PER_M));
    return spans;
  };
  const near = (row: number) => {
    let spans = heights.get(row);
    if (!spans) heights.set(row, spans = [...rowSpans(row), ...ridgeSpans(row / ROWS_PER_M, (row + 1) / ROWS_PER_M)]);
    return spans;
  };
  const boxes: BoxSpec[] = [];
  const span = (polys: readonly Polygon[], z0: number, z1: number) => union(polys.map((p) => sweep(p, z0, z1)).filter((s): s is Interval => s !== null));
  const subtract = (a: number, b: number, cuts: Interval[]): Interval[] => {
    const out: Interval[] = []; let x = a;
    for (const [lo, hi] of cuts) { if (lo > x) out.push([x, Math.min(lo, b)]); x = Math.max(x, hi); if (x >= b) break; }
    if (x < b) out.push([x, b]);
    return out.filter(([lo, hi]) => hi > lo + 1e-9);
  };
  let previous = new Map<string, BoxSpec>();
  for (let row = first; row < last; row++) {
    const z0 = row / ROWS_PER_M, z1 = (row + 1) / ROWS_PER_M, next = new Map<string, BoxSpec>();
    const extend = (key: string, piece: { lo: number; hi: number; bottom: number; top: number }, id: string) => {
      const old = previous.get(key);
      if (old) { old.d = z1 + TOUCH_M - (old.z - old.d / 2); old.z = z1 + TOUCH_M - old.d / 2; next.set(key, old); return; }
      const box = { id: `${id}-${boxes.length}`, x: (piece.lo + piece.hi) / 2, y: piece.bottom, z: (z0 + z1) / 2,
        w: piece.hi - piece.lo, h: piece.top - piece.bottom, d: z1 - z0 + 2 * TOUCH_M };
      boxes.push(box); next.set(key, box);
    };
    const rowFloors = rowSpans(row);
    for (const { lo, hi, y } of rowFloors) extend(`floor,${lo},${hi},${y}`, { lo, hi, bottom: C12.bottomY, top: y }, 'crossing-floor');
    const exclusions = union([...rowFloors.map(({ lo, hi }): Interval => [lo, hi]),
      ...span(ground, z0 - EDGE_M, z1 + EDGE_M), ...span(ridge, z0 - EDGE_M, z1 + EDGE_M)]);
    const Z0 = Math.floor(z0 * CARVE_ROWS_PER_M + 1e-9) / CARVE_ROWS_PER_M, Z1 = Z0 + 1 / CARVE_ROWS_PER_M;
    const fill = union(span(outer, Z0 - CARVE_MARGIN_M, Z1 + CARVE_MARGIN_M).map(([a, b]): Interval => [a - 2 * EDGE_M, b + 2 * EDGE_M]));
    const floors = Array.from({ length: 2 * reach + 1 }, (_, k) => near(row - reach + k)).flat();
    for (const [a, b] of fill.flatMap(([a, b]) => subtract(a, b, exclusions))) {
      const floor = Math.max(...floors.filter((f) => f.hi >= a - NEAR_M && f.lo <= b + NEAR_M).map((f) => f.y));
      if (!Number.isFinite(floor)) throw new Error(`C12 barrier at x${a}..${b} z${z0} has no adjoining floor`);
      for (const p of barrier(a, b, z0, z1, floor)) extend(`${p.kind},${p.lo},${p.hi},${p.bottom},${p.top}`, p, p.kind);
    }
    previous = next;
  }
  return boxes;
}

export function crossingManifest(boxes: readonly BoxSpec[]) {
  const { $comment: _, ...data } = C12;
  return { ...data, rowM: 1 / ROWS_PER_M,
    flights: crossingFlights().map((f) => ({ ...f, risers: f.risers.length, firstRiserM: f.risers[0] ?? null, lastRiserM: f.risers.at(-1) ?? null })),
    boxes: Object.fromEntries(['floor', 'rock', 'lip', 'canopy'].map((k) => [k, boxes.filter((b) => b.id.startsWith(`crossing-${k}-`)).length])) };
}
