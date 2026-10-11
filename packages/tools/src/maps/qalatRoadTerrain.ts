/** U-160, first leaf of U-150: the rock that closes every edge of the bent
 * road. Between the accepted insertion (z84) and the south gate everything
 * off the walking surface is solid from y5.5, so future basement rooms below
 * stay open, to at least 2.2 m above the road and then to its side's crest:
 * the T-W escarpment on the left (travelling north), the T-C inside-corner
 * spurs and the T-E foot on the right. Ridge view fans (§6.2) cap the rock
 * 0.3 m below each bay's listed target rays; temporary caps stand where later
 * leaves open the road. Collision and rendering use the same boxes.
 */
import { DEFAULT_MUZZLE_RIG, type BoxSpec } from '@sandline/shared';
import source from './qalat-road-terrain.json' with { type: 'json' };
import { convexHull } from './roadSightLines.ts';
import {
  clipConvex, inConvex, rectPolygon, sweep, union, type Interval, type Point, type Polygon,
} from './planStrata.ts';

export const ROAD_TERRAIN = source;
type Spine = readonly { id: string; x: number; z: number }[];
type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
// Fine rows hug the diagonal road edges: the rock stands back from the exact
// surface by at most one row plus the skin (0.11 m), too narrow for a foot.
const SKIN_ROWS_PER_M = 10;
const MASS_ROWS_PER_M = 2;
const FAN_CELL_M = 1;
const EDGE_M = .005;
const QUANTUM_M = .05;
const HULL_SIDES = 16;

export const SKIN_TOP = ROAD_TERRAIN.floorY + ROAD_TERRAIN.edgeMinHeightM;
const polygon = (points: readonly (readonly number[])[]): Polygon => points.map(([x, z]) => ({ x: x!, z: z! }));
export const TERRAIN_SPURS = ROAD_TERRAIN.spurs.map((s) => ({ ...s, polygon: polygon(s.polygon) }));
const EAST_EDGE = polygon(ROAD_TERRAIN.eastEdge);

/** Which side of the road a plan point lies on, travelling from the insertion
 * to the gate. At a bend both segments sharing the nearest vertex agree. */
export function roadSide(p: Point, spine: Spine): 'left' | 'right' {
  let best = Infinity, side: 'left' | 'right' = 'left';
  for (let i = 1; i < spine.length; i++) {
    const a = spine[i - 1]!, b = spine[i]!, dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
    if (d < best - 1e-9) { best = d; side = dx * (p.z - a.z) - dz * (p.x - a.x) > 0 ? 'left' : 'right'; }
  }
  return side;
}

/** §6.2 view fan of one ridge bay: the convex hull of the bay's west-edge
 * endpoints and its targets, expanded 1 m (circumscribed, so a superset), and
 * the ray surface over it. Between adjacent target rays the surface is the
 * plane through the standing eye and both targets' feet; outside the outermost
 * rays it follows the nearer ray at the same plan distance from the eye. */
export interface ViewFan {
  id: string;
  eye: { x: number; y: number; z: number };
  hull: Polygon;
  rays: { id: string; to: Point; length: number }[];
  sectors: { wedge: Polygon; height: (p: Point) => number }[];
}

function viewFan(bay: typeof ROAD_TERRAIN.viewFans.bays[number]): ViewFan {
  const { expandM, bayEdgeBackM, bayHalfLengthM } = ROAD_TERRAIN.viewFans, floorY = ROAD_TERRAIN.floorY;
  const eye = { ...bay.anchor, y: bay.anchor.y + DEFAULT_MUZZLE_RIG.eyeHeight };
  const corners = [{ x: eye.x - bayEdgeBackM, z: eye.z - bayHalfLengthM }, { x: eye.x - bayEdgeBackM, z: eye.z + bayHalfLengthM }, ...bay.targets];
  const grow = expandM / Math.cos(Math.PI / HULL_SIDES);
  const hull = convexHull(corners.flatMap((c) => Array.from({ length: HULL_SIDES }, (_, i) => ({
    x: c.x + grow * Math.cos(2 * Math.PI * i / HULL_SIDES), z: c.z + grow * Math.sin(2 * Math.PI * i / HULL_SIDES),
  }))));
  // Angles are measured from due west (the bays face west): south negative.
  const angle = (p: Point) => Math.atan2(p.z - eye.z, eye.x - p.x);
  const dir = (a: number) => ({ x: eye.x - 1000 * Math.cos(a), z: eye.z + 1000 * Math.sin(a) });
  const rays = bay.targets.map((t) => ({ id: t.id, to: { x: t.x, z: t.z }, length: Math.hypot(t.x - eye.x, t.z - eye.z), angle: angle(t) }))
    .sort((a, b) => a.angle - b.angle);
  const along = (r: typeof rays[number]) => (p: Point) => eye.y + (floorY - eye.y) * Math.hypot(p.x - eye.x, p.z - eye.z) / r.length;
  const plane = (r: typeof rays[number], s: typeof rays[number]) => {
    const u = [r.to.x - eye.x, floorY - eye.y, r.to.z - eye.z], v = [s.to.x - eye.x, floorY - eye.y, s.to.z - eye.z];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    return (p: Point) => eye.y - (n[0]! * (p.x - eye.x) + n[2]! * (p.z - eye.z)) / n[1]!;
  };
  const first = rays[0]!, last = rays.at(-1)!;
  const sectors = [
    { wedge: [eye, dir(-Math.PI / 2), dir(first.angle)], height: along(first) },
    ...rays.slice(1).map((r, i) => ({ wedge: [eye, dir(rays[i]!.angle), dir(r.angle)], height: plane(rays[i]!, r) })),
    { wedge: [eye, dir(last.angle), dir(Math.PI / 2)], height: along(last) },
  ];
  return { id: bay.id, eye, hull, rays: rays.map(({ id, to, length }) => ({ id, to, length })), sectors };
}
export const VIEW_FANS = ROAD_TERRAIN.viewFans.bays.map(viewFan);

/** Lowest listed ray surface over a plan rectangle, or Infinity outside every
 * fan. Exact: each surface piece is planar or concave over a convex clip, so
 * its minimum is at a vertex of that clip. */
export function fanRayFloor(r: Rect): number {
  let min = Infinity;
  for (const fan of VIEW_FANS) {
    // Closed sets: a rectangle touching the fan only along an edge is capped too.
    const inside = clipConvex(rectPolygon({ minX: r.minX - 1e-6, maxX: r.maxX + 1e-6, minZ: r.minZ - 1e-6, maxZ: r.maxZ + 1e-6 }), fan.hull);
    if (!inside.length) continue;
    if (r.maxX > fan.eye.x - 1) throw new Error(`${fan.id}: rock at x${r.maxX} reaches the bay`);
    for (const s of fan.sectors) for (const v of clipConvex(inside, s.wedge)) min = Math.min(min, s.height(v));
  }
  return min;
}

/** The rock top the view fans allow over a rectangle (Infinity if none). */
export function fanCap(r: Rect): number {
  const floor = fanRayFloor(r);
  return floor === Infinity ? floor : Math.floor((floor - ROAD_TERRAIN.viewFans.rayClearanceM - 1e-6) / QUANTUM_M) * QUANTUM_M;
}

const within = (r: Rect, c: Rect) => r.minX >= c.minX && r.maxX <= c.maxX && r.minZ >= c.minZ && r.maxZ <= c.maxZ;
export const temporaryCapAt = (r: Rect) => ROAD_TERRAIN.temporaryCaps.find((c) => within(r, c));

function eastBound(z0: number, z1: number, open: Interval[]): number {
  const edge = sweep([...EAST_EDGE, { x: -1e4, z: EAST_EDGE.at(-1)!.z }, { x: -1e4, z: EAST_EDGE[0]!.z }], z0, z1);
  return Math.max(edge ? edge[1] : -Infinity, ...open.map((s) => s[1] + ROAD_TERRAIN.eastBandM));
}

/** Rock intervals of one row: the complement of the conservatively swept,
 * skin-expanded walking surface and the standing pads, between the west
 * bound and the T-E foot. */
function rockSpans(floors: readonly Polygon[], z0: number, z1: number): Interval[] {
  const pads = ROAD_TERRAIN.standingPads.filter((p) => p.minZ < z1 && p.maxZ > z0).map((p) => [p.minX, p.maxX] as Interval);
  const open = union([...floors.map((p) => sweep(p, z0 - EDGE_M, z1 + EDGE_M)).filter((s): s is Interval => s !== null)
    .map(([a, b]) => [a - EDGE_M, b + EDGE_M] as Interval), ...pads]);
  const east = eastBound(z0, z1, open), out: Interval[] = [];
  let x = ROAD_TERRAIN.minX;
  for (const [a, b] of open) {
    if (a > x) out.push([x, Math.min(a, east)]);
    x = Math.max(x, b);
  }
  if (x < east) out.push([x, east]);
  return out.filter(([a, b]) => b - a > 1e-9);
}

/** Split spans at the given x cut points. */
function cutAt(spans: Interval[], cuts: number[]): Interval[] {
  return spans.flatMap(([a, b]) => {
    const xs = [a, ...cuts.filter((x) => x > a + 1e-9 && x < b - 1e-9).sort((p, q) => p - q), b];
    return xs.slice(1).map((x, i) => [xs[i]!, x] as Interval);
  });
}

const capCuts = (z0: number, z1: number) => ROAD_TERRAIN.temporaryCaps
  .filter((c) => c.minZ < z1 && c.maxZ > z0).flatMap((c) => [c.minX, c.maxX]);

/** Crest of the rock at a plan point, before any view-fan cap. */
function crest(r: Rect, spine: Spine): number {
  const cap = temporaryCapAt(r);
  if (cap) return cap.top;
  const fin = ROAD_TERRAIN.fins.find((f) => within(r, f));
  if (fin) return fin.top;
  const mid = { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 };
  const spur = TERRAIN_SPURS.find((s) => inConvex(s.polygon, mid));
  return spur ? spur.top : ROAD_TERRAIN.sideTops[roadSide(mid, spine)];
}

/** Merges equal spans in consecutive rows into one box. */
function strata(prefix: string, rows: number, rowZ: (row: number) => number, bottom: number,
  pieces: (z0: number, z1: number) => { lo: number; hi: number; top: number; id: string }[]): BoxSpec[] {
  const boxes: BoxSpec[] = [];
  let previous = new Map<string, BoxSpec>();
  for (let row = 0; row < rows; row++) {
    const z0 = rowZ(row), z1 = rowZ(row + 1), next = new Map<string, BoxSpec>();
    for (const { lo, hi, top, id } of pieces(z0, z1)) {
      const key = `${id},${lo},${hi},${top}`, old = previous.get(key);
      if (old) { old.d = z1 - (old.z - old.d / 2); old.z = z1 - old.d / 2; next.set(key, old); continue; }
      const box = { id: `${id}-${prefix}-${boxes.length}`, x: (lo + hi) / 2, y: bottom, z: (z0 + z1) / 2, w: hi - lo, h: top - bottom, d: z1 - z0 };
      boxes.push(box); next.set(key, box);
    }
    previous = next;
  }
  return boxes;
}

/** All U-160 rock for the given walking surface (the bent road's floors). */
export function buildRoadTerrain(floors: readonly Polygon[], spine: Spine): BoxSpec[] {
  const { minZ, maxZ, bottomY } = ROAD_TERRAIN;
  const kind = (r: Rect) => temporaryCapAt(r) ? `road-cap-${temporaryCapAt(r)!.id}` : 'road-rock';
  // Skin: y5.5 to 2.2 m above the road in fine rows, cut only where a
  // temporary cap starts. The fans must allow it everywhere else.
  const skin = strata('skin', (maxZ - minZ) * SKIN_ROWS_PER_M, (r) => (minZ * SKIN_ROWS_PER_M + r) / SKIN_ROWS_PER_M, bottomY,
    (z0, z1) => cutAt(rockSpans(floors, z0, z1), capCuts(z0, z1)).map(([lo, hi]) => {
      const r = { minX: lo, maxX: hi, minZ: z0, maxZ: z1 };
      if (!temporaryCapAt(r) && fanCap(r) < SKIN_TOP) {
        throw new Error(`View fan needs rock below the ${SKIN_TOP} m edge at x${lo}..${hi} z${z0}..${z1}`);
      }
      return { lo, hi, top: SKIN_TOP, id: kind(r) };
    }));
  // Mass: from the skin to the crest in coarse rows, cut at every zone
  // boundary and into 1 m cells wherever a view fan shapes the surface.
  const zones = [...TERRAIN_SPURS.map((s) => s.polygon), ...VIEW_FANS.map((f) => f.hull)];
  const mass = strata('mass', (maxZ - minZ) * MASS_ROWS_PER_M, (r) => (minZ * MASS_ROWS_PER_M + r) / MASS_ROWS_PER_M, SKIN_TOP,
    (z0, z1) => {
      const fins = ROAD_TERRAIN.fins.filter((f) => f.minZ < z1 && f.maxZ > z0).flatMap((f) => [f.minX, f.maxX]);
      const zoneCuts = zones.map((p) => sweep(p, z0, z1)).filter((s): s is Interval => s !== null);
      const fanSpans = VIEW_FANS.map((f) => sweep(f.hull, z0, z1)).filter((s): s is Interval => s !== null);
      return cutAt(rockSpans(floors, z0, z1), [...capCuts(z0, z1), ...fins, ...zoneCuts.flat()]).flatMap(([lo, hi]) => {
        const shaped = fanSpans.some(([a, b]) => lo < b && hi > a);
        const cells = shaped ? Math.ceil((hi - lo) / FAN_CELL_M - 1e-9) : 1;
        return Array.from({ length: cells }, (_, i) => {
          const a = lo + (hi - lo) * i / cells, b = i === cells - 1 ? hi : lo + (hi - lo) * (i + 1) / cells;
          const r = { minX: a, maxX: b, minZ: z0, maxZ: z1 };
          const top = temporaryCapAt(r) ? crest(r, spine) : Math.min(crest(r, spine), fanCap(r));
          return { lo: a, hi: b, top, id: kind(r) };
        });
      }).filter((p) => p.top > SKIN_TOP + 1e-9);
    });
  return [...skin, ...mass];
}

/** Exact clearance of every listed bay ray (standing eye to target feet) over
 * the generated rock, and the temporary caps it crosses. Each ray descends
 * toward its target, so over a box it is lowest where it leaves the box. */
export function rayClearances(boxes: readonly BoxSpec[]) {
  const rock = boxes.filter((b) => b.id.startsWith('road-rock') || b.id.startsWith('road-cap-'));
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
      const height = fan.eye.y + (ROAD_TERRAIN.floorY - fan.eye.y) * t1;
      const cap = ROAD_TERRAIN.temporaryCaps.find((c) => b.id.startsWith(`road-cap-${c.id}-`));
      if (cap) { if (b.y + b.h > height) caps.add(cap.id); continue; }
      clearanceM = Math.min(clearanceM, height - (b.y + b.h));
    }
    return { bay: fan.id, target: ray.id, to: ray.to, lengthM: Math.round(ray.length * 100) / 100,
      clearanceM: Math.round(clearanceM * 1000) / 1000, blockedOnlyByTemporaryCaps: [...caps] };
  }));
}

export function roadTerrainManifest(boxes: readonly BoxSpec[]) {
  const rock = boxes.filter((b) => b.id.startsWith('road-rock') || b.id.startsWith('road-cap-'));
  const { $comment: _, ...data } = ROAD_TERRAIN;
  return { ...data, skinTopY: SKIN_TOP, skinRowM: 1 / SKIN_ROWS_PER_M, massRowM: 1 / MASS_ROWS_PER_M, fanCellM: FAN_CELL_M,
    eyeHeightM: DEFAULT_MUZZLE_RIG.eyeHeight, rockBoxes: rock.length,
    temporaryCapBoxes: rock.filter((b) => b.id.startsWith('road-cap-')).length,
    rays: rayClearances(boxes) };
}
