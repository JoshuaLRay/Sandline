/** U-163/U-164/U-165: the continuous R0–R9 ridge shelf (§§2.2, 3.2,
 * 6.1–6.2), outside the campaign until U-117. An 8 m stepped shelf with its exact
 * flat landings, cut into the T-E ridge body. Every edge stands against rock at
 * least 2.2 m above the adjacent floor, except at U-167's V1–V3 bay fronts,
 * where a rock lip and canopy frame the view; a recorded temporary cap closes
 * the east gate (U-116). Collision and rendering use the same boxes.
 *
 * Stair recipe (Conflict default for §2.2's "distribute risers evenly"): each
 * segment's risers form flights of ten 0.20 m risers on 0.40 m treads, spaced
 * evenly between the two landing edges; the equal flat runs before, between and
 * after flights are the rest landings and must be at least 2 m.
 */
import type { BoxSpec } from '@sandline/shared';
import source from './qalat-ridge.json' with { type: 'json' };
import { insertionFloors } from './qalatInsertion.ts';
import { VIEW_FANS, capUnder, rockEastBound } from './qalatRoadTerrain.ts';
import { clipConvex, rectPolygon, sweep, union, type Interval, type Point, type Polygon } from './planStrata.ts';
import { convexHull, ribbonPieces } from './roadSightLines.ts';
import { crossingCarve, crossingFloorSpans } from './qalatC12.ts';

export const RIDGE = source;
type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
type Node = typeof RIDGE.spine[number];
// 5 cm rows keep every rasterized edge and riser line within §15's 0.05 m.
const ROWS_PER_M = 20;
const MASS_ROWS_PER_M = 2;
const EDGE_M = .005;
// A row that only touches a polygon along its boundary line carries none of it.
const TOUCH_M = 1e-7;
// The road rock's own row expansion (≤ two skin widths) stays inside the ring.
const CARVE_MARGIN_M = 2 * EDGE_M;
const FAN_CELL_M = 1;
const MASS = { ...RIDGE.mass, polygon: RIDGE.mass.polygon.map(([x, z]) => ({ x: x!, z: z! })) };

// Ring reach plus a coarse row: the frame covers every ring cell beside it.
const FRAME_REACH_M = 1.6;
/** U-167 (§§3.2, 6.2): each bay's 8×8 m floor west of its feet anchor, the
 * lip strip on its westernmost edge and the frame zone in which the lip,
 * canopy and side returns replace the ordinary 2.2 m barrier ring. */
export const BAYS = RIDGE.bays.list.map((b) => {
  const { edgeBackM, halfLengthM, eastM, lipDepthM } = RIDGE.bays;
  const floor = { minX: b.x - edgeBackM, maxX: b.x + eastM, minZ: b.z - halfLengthM, maxZ: b.z + halfLengthM };
  let minZ = floor.minZ;
  const strata = b.strata.map((s) => { const out = { ...s, minZ }; minZ = s.maxZ; return out; });
  if (minZ !== floor.maxZ) throw new Error(`${b.id}: lip strata end at z${minZ}, not z${floor.maxZ}`);
  // The frame spans every row where this bay's fan hulls reach the barrier
  // ring west of the landing, plus a coarse row and the ring's reach.
  const near = VIEW_FANS.filter((f) => f.eye.x === b.x && f.eye.z === b.z)
    .flatMap((f) => clipConvex(f.hull, rectPolygon({ minX: floor.minX - FRAME_REACH_M, maxX: b.x, minZ: -1e4, maxZ: 1e4 })));
  const frame = { minX: floor.minX - FRAME_REACH_M, maxX: b.x,
    minZ: Math.min(floor.minZ, ...near.map((p) => p.z)) - FRAME_REACH_M, maxZ: Math.max(floor.maxZ, ...near.map((p) => p.z)) + FRAME_REACH_M };
  return { ...b, floor, frame, lipMaxX: floor.minX + lipDepthM, strata };
});
const frameOf = (r: Rect) => BAYS.find((b) => r.minX < b.frame.maxX && r.maxX > b.frame.minX && r.minZ < b.frame.maxZ && r.maxZ > b.frame.minZ);
/** The ridge's view-fan cap (§6.2): rock stays 0.3 m under the lowest ray
 * surface over the cell. Exact for the same reason as `fanRayFloor`; unlike
 * the road's guard it accepts rock east of a bay's eye-1 m line, which only
 * the bay frames and the oblique V3→X5 fan's ridge-side hull reach. */
function ridgeFanCap(r: Rect): number {
  let min = Infinity;
  const cell = rectPolygon({ minX: r.minX - 1e-6, maxX: r.maxX + 1e-6, minZ: r.minZ - 1e-6, maxZ: r.maxZ + 1e-6 });
  for (const fan of VIEW_FANS) {
    const inside = clipConvex(cell, fan.hull);
    if (inside.length) for (const s of fan.sectors) for (const v of clipConvex(inside, s.wedge)) min = Math.min(min, s.height(v));
  }
  return capUnder(min);
}

/** One segment's stair layout along its centreline parameter t (metres from the lower-index node). */
export interface Flight {
  from: string; to: string; length: number; t0: number; t1: number;
  risers: number[]; restLandingM: number; fromY: number; toY: number;
}
interface Floor { id: string; polygon: Polygon; height: (p: Point) => number; cuts: (z: number) => number[] }

const flat = (id: string, polygon: Polygon, y: number): Floor => ({ id, polygon, height: () => y, cuts: () => [] });
const landing = (id: string) => RIDGE.landings.find((l) => l.id === id);
const pieces = ribbonPieces([RIDGE.approach, ...RIDGE.spine], RIDGE.shelfWidth);
const ribbons = pieces.slice(1, RIDGE.spine.length);
// ribbonPieces' bevel i joins ribbon i to i+1, i.e. sits at spine node i.
const bevelAt = (i: number) => pieces[RIDGE.spine.length + i];

/** Flat floors that a stair at node i must not cut into. R0 continues the
 * insertion's flat y8 ridge mouth. */
function flatZones(i: number): Polygon[] {
  const node = RIDGE.spine[i]!, l = landing(node.id), bevel = bevelAt(i);
  return [...(l ? [rectPolygon(l)] : []), ...(bevel ? [bevel] : []), ...(i === 0 ? insertionFloors() : [])];
}

function layout(i: number): Flight {
  const a = RIDGE.spine[i]!, b = RIDGE.spine[i + 1]!, ribbon = ribbons[i]!;
  const length = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / length, uz = (b.z - a.z) / length;
  const along = (p: Point) => (p.x - a.x) * ux + (p.z - a.z) * uz;
  const reach = (zones: Polygon[]) => zones.map((z) => clipConvex(z, ribbon).map(along)).filter((t) => t.length);
  const t0 = Math.max(...reach(flatZones(i)).flat()), t1 = Math.min(...reach(flatZones(i + 1)).flat());
  const n = RIDGE.risers[i]!, rise = b.y - a.y;
  if (Math.abs(Math.abs(rise) - n * RIDGE.riserM) > 1e-9 || n % RIDGE.flightRisers) throw new Error(`${a.id}→${b.id}: ${n} risers cannot climb ${rise} m`);
  // Bridge approaches override R7's north pad extent, retaining its old
  // south edge and R6→R7 stairs. Twenty 0.30 m treads plus a 2 m landing.
  if (a.id === 'R7' || a.id === 'R7b') {
    const start = a.id === 'R7' ? 0 : RIDGE.bridge.maxZ - a.z;
    return { from: a.id, to: b.id, length, t0: start, t1: start + RIDGE.bridge.approachRunM,
      risers: Array.from({ length: n }, (_, k) => start + (k + 1) * RIDGE.bridge.approachTreadM),
      restLandingM: 2, fromY: a.y, toY: b.y };
  }
  const flights = n / RIDGE.flightRisers, run = (RIDGE.flightRisers - 1) * RIDGE.treadM;
  const gap = flights ? (t1 - t0 - flights * run) / (flights + 1) : t1 - t0;
  if (flights && gap < RIDGE.restLandingM) throw new Error(`${a.id}→${b.id}: rest landings ${gap} m < ${RIDGE.restLandingM} m`);
  // Conflict default: keep the entire R8→R9 cross-section y12 until its
  // first riser clears J2/J3 road pads plus skin, then fit the ordinary
  // ten-riser flights with >=2 m rests. Full road clearance takes precedence
  // over equal rest spacing; every lower stair foundation is off the lane.
  const firstGap = a.id === 'R8' ? Math.max(gap,
    (RIDGE.bridge.finalStairFirstMinZ - a.z + Math.abs(ux) * RIDGE.shelfWidth / 2) / uz - t0) : gap;
  const laterGap = flights ? (t1 - t0 - flights * run - firstGap) / flights : gap;
  if (flights && laterGap < RIDGE.restLandingM) throw new Error(`${a.id}→${b.id}: clearance leaves ${laterGap} m rests`);
  const risers = Array.from({ length: n }, (_, k) => {
    const f = Math.floor(k / RIDGE.flightRisers), j = k % RIDGE.flightRisers;
    return t0 + firstGap + f * laterGap + f * run + j * RIDGE.treadM;
  });
  return { from: a.id, to: b.id, length, t0, t1, risers, restLandingM: Math.min(firstGap, laterGap), fromY: a.y, toY: b.y };
}
export const FLIGHTS = RIDGE.spine.slice(0, -1).map((_, i) => layout(i));

/** Designed floor height along a segment: the count of risers at or before t. */
export function flightHeight(f: Flight, t: number): number {
  const climbed = f.risers.filter((r) => r <= t + 1e-9).length;
  return f.fromY + Math.sign(f.toY - f.fromY) * RIDGE.riserM * climbed;
}

function stair(i: number): Floor {
  const a: Node = RIDGE.spine[i]!, b: Node = RIDGE.spine[i + 1]!, f = FLIGHTS[i]!;
  const ux = (b.x - a.x) / f.length, uz = (b.z - a.z) / f.length;
  return { id: `${a.id}-${b.id}`, polygon: ribbons[i]!,
    height: (p) => flightHeight(f, (p.x - a.x) * ux + (p.z - a.z) * uz),
    // Where each riser line crosses the row's centre line.
    cuts: (z) => Math.abs(ux) < 1e-9 ? [] : f.risers.map((r) => a.x + (r - (z - a.z) * uz) / ux) };
}

function floors(): Floor[] {
  const apron = RIDGE.furniture.routeApron;
  return [
    ...RIDGE.spine.slice(0, -1).map((_, i) => stair(i)),
    ...RIDGE.spine.flatMap((n, i) => { const b = bevelAt(i); return b ? [flat(`${n.id}-bevel`, b, n.y)] : []; }),
    ...RIDGE.landings.map((l) => flat(l.id, rectPolygon(l), RIDGE.spine.find((n) => n.id === l.id)!.y)),
    // Dead-end inland furniture recesses join the existing pads. The named
    // spine, stair ribbons and landing elevations remain unchanged.
    ...RIDGE.furniture.recesses.map((r) => flat(`furniture-${r.id}`, rectPolygon(r), r.y)),
    // U-167: each bay adds the 0.8 m strip west of its landing; the rest of
    // its 8×8 m floor is the landing itself.
    ...BAYS.map((b) => flat(`bay-${b.id}`, rectPolygon(b.floor), b.y)),
    // The exact R6 wall narrows the inner corner. A bounded outer bevel on
    // the existing y26 rest keeps eight metres clear beside the survey
    // post's broken southwest return. Its extra area lies after the final
    // incoming riser and before the first outgoing one; every stair stays.
    ...ribbonPieces(apron.spine, apron.widthM).map((polygon, i) => flat(`${apron.id}-${i}`, polygon, apron.y)),
  ];
}
const FLOORS = floors();
/** Plan polygons of the whole shelf: carved out of the insertion rock. */
export function ridgeFloors(): readonly Polygon[] { return FLOORS.map((f) => f.polygon); }
/** The shelf grown by the barrier ring (Minkowski sum with a square; every
 * floor piece is convex): the road rock north of z300 stands back by this
 * much and the ring fills the gap, so no road-rock row seam opens a slot. */
export function ridgeCarve(): readonly Polygon[] {
  const e = RIDGE.mass.ringM;
  return FLOORS.map((f) => convexHull(f.polygon.flatMap((p) => [-e, e].flatMap((dx) => [-e, e].map((dz) => ({ x: p.x + dx, z: p.z + dz }))))));
}

/** Constant-height pieces of one row, highest shelf wins where pieces overlap. */
export function ridgeFloorSpans(z0: number, z1: number): { lo: number; hi: number; y: number }[] {
  const zm = (z0 + z1) / 2, raw: { lo: number; hi: number; y: number }[] = [];
  for (const f of FLOORS) {
    const s = sweep(f.polygon, z0 + TOUCH_M, z1 - TOUCH_M);
    if (!s) continue;
    const lo = s[0] - EDGE_M, hi = s[1] + EDGE_M;
    const xs = [lo, ...f.cuts(zm).filter((x) => x > lo && x < hi).sort((p, q) => p - q), hi];
    for (let k = 1; k < xs.length; k++) raw.push({ lo: xs[k - 1]!, hi: xs[k]!, y: f.height({ x: (xs[k - 1]! + xs[k]!) / 2, z: zm }) });
  }
  const xs = [...new Set(raw.flatMap((r) => [r.lo, r.hi]))].sort((p, q) => p - q), out: { lo: number; hi: number; y: number }[] = [];
  for (let k = 1; k < xs.length; k++) {
    const lo = xs[k - 1]!, hi = xs[k]!, y = Math.max(...raw.filter((r) => r.lo <= lo && r.hi >= hi).map((r) => r.y));
    if (y === -Infinity) continue;
    const last = out.at(-1);
    if (last && last.hi === lo && last.y === y) last.hi = hi; else out.push({ lo, hi, y });
  }
  // A lower terminal stair replaces only overlapping ridge columns. Once
  // it reaches the node elevation the original landing stays intact.
  const mouths = crossingFloorSpans(z0, z1);
  return out.flatMap(({ lo, hi, y }) => subtract(lo, hi, union(mouths.filter((m) => m.y < y - 1e-9)
    .map((m): Interval => [m.lo, m.hi]))).map(([lo, hi]) => ({ lo, hi, y })));
}

/** Merges equal pieces of consecutive rows into one box. */
function strata(name: string) {
  const boxes: BoxSpec[] = [];
  let previous = new Map<string, BoxSpec>(), next = new Map<string, BoxSpec>();
  return {
    boxes,
    add(id: string, lo: number, hi: number, z0: number, z1: number, bottom: number, top: number) {
      const key = `${id},${lo},${hi},${bottom},${top}`, old = previous.get(key);
      // Preserve accepted bare R0–R7 rows. Bridge/descent and newly
      // furnished rows need a sub-micron weld: a centre/size round trip
      // must not open a point-query seam between two full-height supports.
      const furnished = [...RIDGE.furniture.recesses, ...BAYS.map((b) => b.floor)].some((r) => z0 >= r.minZ && z0 < r.maxZ && lo < r.maxX && hi > r.minX);
      const weld = z0 >= 322 || furnished ? TOUCH_M : 0;
      if (old) { old.d = z1 + weld - (old.z - old.d / 2); old.z = z1 + weld - old.d / 2; next.set(key, old); return; }
      const box = { id: `${id}-${name}-${boxes.length}`, x: (lo + hi) / 2, y: bottom, z: (z0 + z1) / 2, w: hi - lo, h: top - bottom, d: z1 - z0 + 2 * weld };
      boxes.push(box); next.set(key, box);
    },
    row() { previous = next; next = new Map(); },
  };
}

/** Split spans at the given x cut points. */
function cutAt(spans: Interval[], cuts: number[]): Interval[] {
  return spans.flatMap(([a, b]) => {
    const xs = [a, ...[...new Set(cuts.filter((x) => x > a + 1e-9 && x < b - 1e-9))].sort((p, q) => p - q), b];
    return xs.slice(1).map((x, i) => [xs[i]!, x] as Interval);
  });
}
/** The parts of [lo, hi] outside every open span. */
function subtract(lo: number, hi: number, open: Interval[]): Interval[] {
  const out: Interval[] = [];
  let x = lo;
  for (const [a, b] of open) {
    if (b <= x) continue;
    if (a >= hi) break;
    if (a > x) out.push([x, a]);
    x = Math.max(x, b);
  }
  if (x < hi) out.push([x, hi]);
  return out.filter(([a, b]) => b - a > 1e-9);
}
const within = (r: Rect, c: Rect) => r.minX >= c.minX - 1e-9 && r.maxX <= c.maxX + 1e-9 && r.minZ >= c.minZ - 1e-9 && r.maxZ <= c.maxZ + 1e-9;
const groundCaps = RIDGE.temporaryCaps;
const capAt = (r: Rect) => groundCaps.find((c) => within(r, c));
const capCuts = (z0: number, z1: number) => groundCaps.filter((c) => c.minZ < z1 && c.maxZ > z0).flatMap((c) => [c.minX, c.maxX]);

/** §3.2 T-E crest, interpolated between its anchors and held beyond them. */
export function ridgeCrest(z: number): number {
  const c = MASS.crest;
  if (z <= c[0]![0]!) return c[0]![1]!;
  for (let i = 1; i < c.length; i++) {
    const [z0, y0] = c[i - 1]! as [number, number], [z1, y1] = c[i]! as [number, number];
    if (z <= z1) return y0 + (y1 - y0) * (z - z0) / (z1 - z0);
  }
  return c.at(-1)![1]!;
}

const insideInsertion = (x: number, z1: number) => x <= RIDGE.insertionBounds.maxX + 1e-9 && z1 <= RIDGE.insertionBounds.maxZ + 1e-9;

/** Outward walls preserve the spec's clear inside bounds. Both west faces
 * are wholly open; the hut has no roof and the survey post has only two
 * separated broken beams above standing/camera clearance. */
export function buildRidgeFurniture(): BoxSpec[] {
  const { wallM: t, wallHeightM: h, shells, cover, sacks, beams } = RIDGE.furniture;
  return [
    ...shells.flatMap((s): BoxSpec[] => [
      { id: `ridge-${s.id}-south`, x: (s.minX + s.southWestBreakM + s.maxX + t) / 2, y: s.y, z: s.minZ - t / 2, w: s.maxX - s.minX - s.southWestBreakM + t, h, d: t },
      { id: `ridge-${s.id}-north`, x: (s.minX + s.maxX + t) / 2, y: s.y, z: s.maxZ + t / 2, w: s.maxX - s.minX + t, h, d: t },
      { id: `ridge-${s.id}-east`, x: s.maxX + t / 2, y: s.y, z: (s.minZ + s.maxZ) / 2, w: t, h, d: s.maxZ - s.minZ },
    ]),
    ...cover.map((c) => ({ ...c, id: `ridge-cover-${c.id}` })),
    ...sacks.zs.map((z, i) => ({ id: `ridge-hut-sack-${i + 1}`, x: sacks.x, y: sacks.y, z, w: sacks.w, h: sacks.h, d: sacks.d })),
    ...beams.map((b) => ({ ...b, id: `ridge-survey-beam-${b.id}` })),
  ];
}

/** All ridge boxes: shelf floors (columns, or slabs where they overhang an
 * existing y8 floor), the T-E body around them and the temporary caps.
 * `ground` is every built y8 walking floor (road, X ingress, D0 store). */
export function buildRidge(ground: readonly Polygon[]): BoxSpec[] {
  const crossings = crossingCarve();
  const zs = FLOORS.flatMap((f) => f.polygon.map((p) => p.z));
  const first = Math.floor(Math.min(...zs) * ROWS_PER_M) - 1, last = Math.ceil(Math.max(...zs) * ROWS_PER_M) + 1;
  const floor = strata('shelf'), index = new Map<number, { lo: number; hi: number; z0: number; z1: number; y: number }[]>();
  for (let row = first; row < last; row++) {
    const z0 = row / ROWS_PER_M, z1 = (row + 1) / ROWS_PER_M;
    const below = union(ground.map((p) => sweep(p, z0 - EDGE_M, z1 + EDGE_M)).filter((s): s is Interval => s !== null)
      .map(([a, b]) => [a - EDGE_M, b + EDGE_M]));
    for (const { lo, hi, y } of ridgeFloorSpans(z0, z1)) {
      const band = index.get(Math.floor(z0)) ?? [];
      band.push({ lo, hi, z0, z1, y }); index.set(Math.floor(z0), band);
      const cuts = [...below.flat(), ...(z1 <= RIDGE.insertionBounds.maxZ + 1e-9 ? [RIDGE.insertionBounds.maxX] : [])];
      for (const [a, b] of cutAt([[lo, hi]], cuts)) {
        const x = (a + b) / 2;
        if (below.some(([p, q]) => x >= p && x <= q)) {
          // Overhanging a road or apron: a slab high enough to leave it clear.
          const minimum = z0 >= 322 ? RIDGE.bridge.minTurretUndersideY : RIDGE.minSlabUndersideY;
          if (y - RIDGE.slabM < minimum - 1e-9) throw new Error(`ridge floor y${y} overhangs a y8 floor at x${x} z${z0}`);
          // A single exact y14..16 box builds the flat structural bridge deck.
          if (!(z0 >= RIDGE.bridge.minZ && z1 <= RIDGE.bridge.maxZ && y === RIDGE.bridge.deckY))
            floor.add('ridge-slab', a, b, z0, z1, y - RIDGE.slabM, y);
        } else if (insideInsertion(x, z1)) {
          if (y > RIDGE.approach.y + 1e-9) floor.add('ridge-floor', a, b, z0, z1, RIDGE.approach.y, y);
        } else floor.add('ridge-floor', a, b, z0, z1, RIDGE.bottomY, y);
      }
    }
    floor.row();
  }
  const near = (r: Rect, reach: number) => {
    let y = -Infinity;
    for (let band = Math.floor(r.minZ - reach); band <= Math.floor(r.maxZ + reach); band++)
      for (const p of index.get(band) ?? [])
        if (p.hi >= r.minX - reach && p.lo <= r.maxX + reach && p.z1 >= r.minZ - reach && p.z0 <= r.maxZ + reach) y = Math.max(y, p.y);
    return y;
  };

  // T-E body. Coarse rows hold the mass at its crest; fine rows hold a ring
  // within ringM of the shelf at barrier height, so the coarse rows' standoff
  // never leaves a slot beside a floor. North of the body's z300 the road rock
  // already fills T-E; there it stands back by the carved ring (ridgeCarve) and
  // only the ring is built, never over a y8 floor.
  const { ringM } = MASS, coarse = strata('mass'), ring = strata('ring');
  const reach = ringM + CARVE_MARGIN_M;
  const fanSpans = (z0: number, z1: number) => VIEW_FANS.map((f) => sweep(f.hull, z0, z1)).filter((s): s is Interval => s !== null);
  const barrier = (r: Rect, body: boolean) => {
    const floorY = near(r, reach + 1 / MASS_ROWS_PER_M);
    const cap = capAt(r);
    if (cap) {
      if (cap.top < floorY + RIDGE.barrierM - 1e-9) throw new Error(`${cap.id} below the barrier beside a y${floorY} floor`);
      return { id: `ridge-cap-${cap.id}`, top: cap.top, bottom: cap.bottomY };
    }
    const top = Math.max(body ? ridgeCrest((r.minZ + r.maxZ) / 2) : -Infinity, floorY + RIDGE.barrierM);
    if (ridgeFanCap(r) < top) throw new Error(`View fan needs ridge rock below the y${top} barrier at x${r.minX}..${r.maxX} z${r.minZ}..${r.maxZ}`);
    return { id: 'ridge-rock', top, bottom: RIDGE.bottomY };
  };
  const lastRow = Math.ceil((Math.max(...zs) + reach) * MASS_ROWS_PER_M);
  for (let row = MASS.minZ * MASS_ROWS_PER_M; row < lastRow; row++) {
    // mass.maxZ (z300) is where the road terrain's eastBound starts filling T-E itself.
    const Z0 = row / MASS_ROWS_PER_M, Z1 = (row + 1) / MASS_ROWS_PER_M, inBody = Z1 <= MASS.maxZ + 1e-9;
    const body = inBody ? sweep(MASS.polygon, Z0, Z1) : null;
    if (inBody && !body) { coarse.row(); continue; }
    const west = !body ? -Infinity : Z1 <= RIDGE.insertionBounds.maxZ ? Math.max(RIDGE.insertionBounds.maxX, body[0]) : rockEastBound(ground, Z0, Z1);
    const east = body ? body[1] : Infinity;
    const ridgeOpen = FLOORS.map((f) => sweep(f.polygon, Z0 - reach, Z1 + reach)).filter((s): s is Interval => s !== null)
      .map(([a, b]): Interval => [a - reach, b + reach]);
    const open = union([...ridgeOpen,
      ...crossings.map((p) => sweep(p, Z0 - CARVE_MARGIN_M, Z1 + CARVE_MARGIN_M)).filter((s): s is Interval => s !== null)]);
    const fans = fanSpans(Z0, Z1);
    if (body) for (const [lo, hi] of cutAt(subtract(west, east, open), [...capCuts(Z0, Z1), ...fans.flat()])) {
      const shaped = fans.some(([a, b]) => lo <= b + 1e-6 && hi >= a - 1e-6);
      const cells = shaped ? Math.ceil((hi - lo) / FAN_CELL_M - 1e-9) : 1;
      for (let i = 0; i < cells; i++) {
        const a = lo + (hi - lo) * i / cells, b = i === cells - 1 ? hi : lo + (hi - lo) * (i + 1) / cells;
        const r = { minX: a, maxX: b, minZ: Z0, maxZ: Z1 }, cap = capAt(r);
        const top = cap ? cap.top : Math.min(ridgeCrest((Z0 + Z1) / 2), ridgeFanCap(r));
        if (top > RIDGE.bottomY + 1e-9) coarse.add(cap ? `ridge-cap-${cap.id}` : 'ridge-rock', a, b, Z0, Z1, cap?.bottomY ?? RIDGE.bottomY, top);
      }
    }
    coarse.row();
    for (let fine = 0; fine < ROWS_PER_M / MASS_ROWS_PER_M; fine++) {
      const k = row * ROWS_PER_M / MASS_ROWS_PER_M + fine, z0 = k / ROWS_PER_M, z1 = (k + 1) / ROWS_PER_M;
      const below = union(ground.map((p) => sweep(p, z0 - EDGE_M, z1 + EDGE_M)).filter((s): s is Interval => s !== null)
        .map(([a, b]): Interval => [a - EDGE_M, b + EDGE_M]));
      // The R7 inland recess reaches over a road apron before z322. That
      // apron must stay open below, while its raised recess still needs a
      // hanging outer barrier. Retain the older ground exclusion elsewhere.
      const furnitureRing = union(RIDGE.furniture.recesses.map((r) => sweep(rectPolygon(r), z0 - reach, z1 + reach))
        .filter((s): s is Interval => s !== null).map(([a, b]): Interval => [a - reach, b + reach]));
      const excludedGround = z0 < 322 ? below.flatMap(([a, b]) => subtract(a, b, furnitureRing)) : [];
      const shelf = union([...FLOORS.map((f) => sweep(f.polygon, z0 + TOUCH_M, z1 - TOUCH_M)).filter((s): s is Interval => s !== null)
        .map(([a, b]): Interval => [a - EDGE_M, b + EDGE_M]), ...excludedGround]);
      const crossingCuts = crossings.map((p) => sweep(p, z0 - CARVE_MARGIN_M, z1 + CARVE_MARGIN_M)).filter((s): s is Interval => s !== null);
      const spans = union(ridgeOpen).flatMap(([a, b]) => subtract(Math.max(a, west), Math.min(b, east), union([...shelf, ...crossingCuts])));
      const frameCuts = BAYS.flatMap((b) => [b.floor.minX, b.x]);
      for (const [lo, hi] of cutAt(spans, [...capCuts(z0, z1), ...frameCuts, ...below.flat()])) {
        const r = { minX: lo, maxX: hi, minZ: z0, maxZ: z1 }, bay = frameOf(r);
        if (bay) {
          // U-167: west of the bay floor the hillside stays under the fan;
          // beside the bay strip a full-height side return closes the frame.
          const ordinary = Math.max(inBody ? ridgeCrest((z0 + z1) / 2) : -Infinity, bay.y + RIDGE.barrierM);
          const west = lo < bay.floor.minX - 1e-9;
          const top = west ? Math.min(ordinary, ridgeFanCap(r)) : Math.max(ordinary, bay.y + RIDGE.bays.frameTopM);
          if (top > RIDGE.bottomY + 1e-9) ring.add(west ? 'ridge-rock' : `ridge-bay-${bay.id}-return`, lo, hi, z0, z1, RIDGE.bottomY, top);
          continue;
        }
        const { id, top, bottom } = barrier(r, inBody);
        const overRoad = below.some(([a, b]) => (lo + hi) / 2 >= a && (lo + hi) / 2 <= b);
        const hangingBottom = Math.max(RIDGE.bridge.minTurretUndersideY, near({ minX: lo, maxX: hi, minZ: z0, maxZ: z1 }, .06) - RIDGE.slabM);
        if (top > bottom + 1e-9) ring.add(overRoad ? 'ridge-parapet' : id, lo, hi, z0, z1, overRoad ? hangingBottom : bottom, top);
      }
      ring.row();
    }
  }
  const { bridge: b } = RIDGE;
  const deck = { id: 'ridge-bridge-deck', x: (b.minX + b.maxX) / 2, y: b.undersideY, z: (b.minZ + b.maxZ) / 2,
    w: b.maxX - b.minX, h: b.deckY - b.undersideY, d: b.maxZ - b.minZ };
  const gate = RIDGE.temporaryCaps.find((c) => c.id === 'east-gate')!;
  const gateCap = { id: 'ridge-cap-east-gate', x: (gate.minX + gate.maxX) / 2, y: gate.bottomY, z: (gate.minZ + gate.maxZ) / 2,
    w: gate.maxX - gate.minX, h: gate.top - gate.bottomY, d: gate.maxZ - gate.minZ };
  return [...floor.boxes, deck, ...coarse.boxes, ...ring.boxes, gateCap, ...buildRidgeFurniture(), ...buildBayFrames(), ...buildRidgeFins()];
}

/** §6.2's lip on each bay's westernmost strip, the canopy's low edge over
 * only that strip and its high underside behind it, all on the bay floor.
 * Every lip stratum leaves exactly the same opening below its canopy. */
export function buildBayFrames(): BoxSpec[] {
  const { canopyHighM, frameTopM } = RIDGE.bays;
  const box = (id: string, minX: number, maxX: number, minZ: number, maxZ: number, y0: number, y1: number): BoxSpec =>
    ({ id, x: (minX + maxX) / 2, y: y0, z: (minZ + maxZ) / 2, w: maxX - minX, h: y1 - y0, d: maxZ - minZ });
  return BAYS.flatMap((b) => [
    ...b.strata.flatMap((s, i) => {
      // An optional lower outer ledge lies wholly beyond the inner lip, which
      // stays above the controller's step height wherever a body can reach.
      const split = 'outer' in s ? b.floor.minX + s.outer.depthM : b.floor.minX;
      return [
        box(`ridge-bay-${b.id}-lip-${i}`, split, b.lipMaxX, s.minZ, s.maxZ, b.y, b.y + s.lipM),
        box(`ridge-bay-${b.id}-canopy-${i}`, split, b.lipMaxX, s.minZ, s.maxZ, b.y + s.canopyM, b.y + frameTopM),
        ...'outer' in s ? [
          box(`ridge-bay-${b.id}-ledge-${i}`, b.floor.minX, split, s.minZ, s.maxZ, b.y, b.y + s.outer.lipM),
          box(`ridge-bay-${b.id}-ledge-canopy-${i}`, b.floor.minX, split, s.minZ, s.maxZ, b.y + s.outer.canopyM, b.y + frameTopM),
        ] : [],
      ];
    }),
    box(`ridge-bay-${b.id}-canopy`, b.lipMaxX, b.x, b.floor.minZ, b.floor.maxZ, b.y + canopyHighM, b.y + frameTopM),
  ]);
}

/** §6.2's blind-spot fin F3, solid from the ridge bottom; F1/F2 stand in the road rock. */
export function buildRidgeFins(): BoxSpec[] {
  return RIDGE.fins.map((f) => ({ id: `ridge-fin-${f.id}`, x: (f.minX + f.maxX) / 2, y: f.bottomY, z: (f.minZ + f.maxZ) / 2,
    w: f.maxX - f.minX, h: f.top - f.bottomY, d: f.maxZ - f.minZ }));
}

/** Screening proofs count permanent solids only. The temporary east-gate cap
 * closes the unbuilt outpost approach until U-116 replaces it. */
export const isTemporaryRidgeCap = (id: string) => id.startsWith('ridge-cap-');

/** Clearance of every listed bay ray over the permanent ridge rock, the
 * temporary ridge caps it crosses, and the least distance between the ray
 * and its bay's lip/canopy/return frame, which is exempt from the fan cap
 * but must leave the whole ray open. */
export function ridgeRayClearances(boxes: readonly BoxSpec[]) {
  const rock = boxes.filter((b) => b.id.startsWith('ridge-rock') || b.id.startsWith('ridge-cap-'));
  const frames = boxes.filter((b) => b.id.startsWith('ridge-bay-'));
  return VIEW_FANS.flatMap((fan) => fan.rays.map((ray) => {
    const dx = ray.to.x - fan.eye.x, dz = ray.to.z - fan.eye.z;
    let clearanceM = Infinity;
    const caps = new Set<string>();
    for (const b of rock) {
      let t0 = 0, t1 = 1;
      for (const [o, d, lo, hi] of [[fan.eye.x, dx, b.x - b.w / 2, b.x + b.w / 2], [fan.eye.z, dz, b.z - b.d / 2, b.z + b.d / 2]] as const) {
        if (Math.abs(d) < 1e-12) { if (o < lo || o > hi) t1 = -1; continue; }
        const a = (lo - o) / d, c = (hi - o) / d;
        t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c));
      }
      if (t1 < t0) continue;
      // Each ray descends toward its target: lowest where it leaves the box.
      const height = fan.eye.y + (ray.to.y - fan.eye.y) * t1, entry = fan.eye.y + (ray.to.y - fan.eye.y) * t0;
      const cap = RIDGE.temporaryCaps.find((c) => b.id.startsWith(`ridge-cap-${c.id}-`) || b.id === `ridge-cap-${c.id}`);
      if (cap) { if (b.y + b.h > height && b.y < entry) caps.add(cap.id); continue; }
      clearanceM = Math.min(clearanceM, height - (b.y + b.h));
    }
    // Vertical gap between the ray and each frame box it passes over or under.
    let frameGapM = Infinity;
    for (const b of frames) {
      let t0 = 0, t1 = 1;
      for (const [o, d, lo, hi] of [[fan.eye.x, dx, b.x - b.w / 2, b.x + b.w / 2], [fan.eye.z, dz, b.z - b.d / 2, b.z + b.d / 2]] as const) {
        if (Math.abs(d) < 1e-12) { if (o < lo || o > hi) t1 = -1; continue; }
        const a = (lo - o) / d, c = (hi - o) / d;
        t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c));
      }
      if (t1 < t0) continue;
      const enter = fan.eye.y + (ray.to.y - fan.eye.y) * t0, leave = fan.eye.y + (ray.to.y - fan.eye.y) * t1;
      frameGapM = Math.min(frameGapM, Math.max(Math.min(enter, leave) - (b.y + b.h), b.y - Math.max(enter, leave)));
    }
    return { bay: fan.id, target: ray.id, clearanceM: clearanceM === Infinity ? null : Math.round(clearanceM * 1000) / 1000,
      frameGapM: frameGapM === Infinity ? null : Math.round(frameGapM * 1000) / 1000, blockedOnlyByTemporaryCaps: [...caps] };
  }));
}

export function ridgeManifest(boxes: readonly BoxSpec[]) {
  const ridge = boxes.filter((b) => b.id.startsWith('ridge-'));
  const count = (prefix: string) => ridge.filter((b) => b.id.startsWith(prefix)).length;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const { $comment: _, ...data } = RIDGE;
  return { ...data, rowM: 1 / ROWS_PER_M, massRowM: 1 / MASS_ROWS_PER_M, edgeExpansionM: EDGE_M,
    flights: FLIGHTS.map((f) => ({ from: f.from, to: f.to, fromY: f.fromY, toY: f.toY, lengthM: r(f.length),
      stairStartM: r(f.t0), stairEndM: r(f.t1), risers: f.risers.length, restLandingM: r(f.restLandingM),
      firstRiserM: f.risers.length ? r(f.risers[0]!) : null, lastRiserM: f.risers.length ? r(f.risers.at(-1)!) : null })),
    boxes: { floor: count('ridge-floor'), slab: count('ridge-slab'), bridge: count('ridge-bridge'), parapet: count('ridge-parapet'), rock: count('ridge-rock'), caps: count('ridge-cap-'),
      bayFrames: count('ridge-bay-'),
      cover: count('ridge-cover-'), hut: count('ridge-hut-'), survey: count('ridge-survey-') },
    rays: ridgeRayClearances(boxes) };
}
