/** U-168: the two exposed, reversible §6.3 stairs. Collision and rendering
 * share these strata; their raised floors never become y8 road aprons. */
import type { BoxSpec } from '@sandline/shared';
import source from './qalat-c12.json' with { type: 'json' };
import { convexHull, ribbonPieces } from './roadSightLines.ts';
import { inConvex, rectPolygon, sweep, union, type Interval, type Point, type Polygon } from './planStrata.ts';

export const C12 = source;
const ROWS_PER_M = 20, EDGE_M = .005, TOUCH_M = 1e-7;
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
    const t0 = reach, t1 = length - reach, n = s.risers[i]!, treadM = C12.treadM;
    if (Math.abs(b.y - a.y - n * C12.riserM) > 1e-9 || n % C12.flightRisers)
      throw new Error(`${s.id} ${a.id}→${b.id}: ${n} risers cannot climb ${b.y - a.y} m`);
    const flights = n / C12.flightRisers, run = (C12.flightRisers - 1) * treadM;
    const restLandingM = flights > 1 ? (t1 - t0 - flights * run) / (flights - 1) : t1 - t0;
    if (flights > 1 && restLandingM < C12.restLandingM - 1e-9)
      throw new Error(`${s.id} ${a.id}→${b.id}: ${t1 - t0} m run cannot fit ${n} risers on ${treadM} m treads plus ${C12.restLandingM} m rests`);
    const risers = Array.from({ length: n }, (_, k) => t0 + Math.floor(k / C12.flightRisers) * (run + restLandingM) + k % C12.flightRisers * treadM);
    return { crossing: s.id, from: a.id, to: b.id, length, t0, t1, risers, treadM, restLandingM, fromY: a.y, toY: b.y };
  }));
}

export function crossingHeight(f: CrossingFlight, t: number): number {
  return f.fromY + C12.riserM * f.risers.filter((r) => r <= t + 1e-9).length;
}

/** The floor footprint is independent of the stair recipe validation. */
export function crossingFloors(): readonly Polygon[] {
  return C12.stairs.flatMap((s) => [...ribbonPieces(s.spine, C12.widthM), ...s.spine.map(landing)]);
}
export function onCrossingFloor(p: Point, margin = 0): boolean {
  return crossingFloors().some((poly) => margin >= 0
    ? inConvex(convexHull(poly.flatMap((v) => [-margin, margin].flatMap((dx) => [-margin, margin].map((dz) => ({ x: v.x + dx, z: v.z + dz }))))), p)
    : [-margin, margin].flatMap((dx) => [-margin, margin].map((dz) => ({ x: p.x + dx, z: p.z + dz }))).every((v) => inConvex(poly, v)));
}
/** Leave room for the outward cheek and its adjoining unwalkable rock. */
export function crossingCarve(): readonly Polygon[] {
  const e = C12.cheekWidthM + EDGE_M * 2;
  return crossingFloors().map((poly) => convexHull(poly.flatMap((v) => [-e, e].flatMap((dx) => [-e, e].map((dz) => ({ x: v.x + dx, z: v.z + dz }))))));
}

function floors(): Floor[] {
  const flights = crossingFlights();
  return C12.stairs.flatMap((s) => {
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

export function buildCrossings(): BoxSpec[] {
  // Validate before emitting any partial geometry.
  crossingFlights();
  const polys = crossingFloors(), zs = polys.flatMap((p) => p.map((v) => v.z));
  const first = Math.floor(Math.min(...zs) * ROWS_PER_M), last = Math.ceil(Math.max(...zs) * ROWS_PER_M);
  const boxes: BoxSpec[] = [];
  let previous = new Map<string, BoxSpec>();
  for (let row = first; row < last; row++) {
    const z0 = row / ROWS_PER_M, z1 = (row + 1) / ROWS_PER_M, next = new Map<string, BoxSpec>();
    for (const { lo, hi, y } of crossingFloorSpans(z0, z1)) {
      const key = `${lo},${hi},${y}`, old = previous.get(key);
      if (old) { old.d = z1 + TOUCH_M - (old.z - old.d / 2); old.z = z1 + TOUCH_M - old.d / 2; next.set(key, old); continue; }
      const box = { id: `crossing-floor-${boxes.length}`, x: (lo + hi) / 2, y: C12.bottomY,
        z: (z0 + z1) / 2, w: hi - lo, h: y - C12.bottomY, d: z1 - z0 + 2 * TOUCH_M };
      boxes.push(box); next.set(key, box);
    }
    previous = next;
  }
  return boxes;
}
