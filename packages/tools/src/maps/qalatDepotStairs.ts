/** U-171: exact covered endpoint stairs. Only these named three-dimensional
 * voids replace existing surface/depot solids; all other boxes retain their
 * original IDs and dimensions. Flight rectangles take priority at turn joins,
 * so a flat landing cannot erase an adjoining tread. */
import type { BoxSpec } from '@sandline/shared';
import source from './qalat-depot.json' with { type: 'json' };
import { convexHull } from './roadSightLines.ts';
import { rectPolygon, sweep, union, type Interval, type Point, type Polygon } from './planStrata.ts';

const D = source, ROW_M = .05, TOUCH = 1e-7;
type Node = typeof D.stairs.systems[number]['nodes'][number];
export interface DepotStairFloor { id: string; polygon: Polygon; y: number; ceiling: number; flight?: string }
export interface DepotFlight { id: string; from: Node; to: Node; risers: number[]; length: number }
const rectangle = (x0: number, x1: number, z0: number, z1: number) => rectPolygon({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 });
const grow = (p: Polygon, m: number) => convexHull(p.flatMap((v) => [-m, m].flatMap((x) => [-m, m].map((z) => ({ x: v.x + x, z: v.z + z })))));
const bounds = (p: Polygon) => ({ minX: Math.min(...p.map((v) => v.x)), maxX: Math.max(...p.map((v) => v.x)), minZ: Math.min(...p.map((v) => v.z)), maxZ: Math.max(...p.map((v) => v.z)) });

export function depotStairNodes(): Node[] { return D.stairs.systems.flatMap((s) => s.nodes); }
export function depotFlights(): DepotFlight[] {
  return D.stairs.systems.flatMap((s) => s.nodes.slice(1).flatMap((b, i) => {
    const a = s.nodes[i]!;
    if (a.y === b.y) return [];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (Math.abs(b.y - a.y) !== 20 * D.stairs.riser || length !== 20 * D.stairs.tread + D.stairs.rest)
      throw new Error(`${s.id}: invalid twenty-riser flight ${a.id}→${b.id}`);
    // The first upper/lower tread starts at the exact node. Ten risers reach
    // the central rest at t4; the second ten start at t6 and finish at t9.6.
    const risers = Array.from({ length: 20 }, (_, n) => n < 10 ? (n + 1) * D.stairs.tread : D.stairs.rest + n * D.stairs.tread);
    return [{ id: `${s.id}-${a.id}-${b.id}`, from: a, to: b, length, risers }];
  }));
}
export function depotFlightHeight(f: DepotFlight, t: number): number {
  return f.from.y + Math.sign(f.to.y - f.from.y) * D.stairs.riser * f.risers.filter((r) => r <= t + 1e-9).length;
}

/** Covered porch socket is the exact wall intersection, not its centre. */
export function depotEndpointDoors() {
  return [{ id: 'B0-east', room: 'B0', x: 10, y: 8, z: 68, axis: 'x', normal: 1, width: 4, headroom: 3.2 },
    { id: 'B10-west', room: 'B10', x: 4, y: 8, z: 375 + 1 / 3, axis: 'x', normal: -1, width: 4, headroom: 3.2 }];
}

let cached: DepotStairFloor[] | undefined;
export function depotStairFloors(): readonly DepotStairFloor[] {
  if (cached) return cached;
  const pieces: DepotStairFloor[] = [{ id: 'B0-room', polygon: rectangle(-14, 10, 58, 78), y: 8, ceiling: 12 },
    { id: 'B0-east-door', polygon: rectangle(10, 12, 66, 70), y: 8, ceiling: 11.2 },
    { id: 'B0-lower-door', polygon: rectangle(4, 8, 94, 98), y: 0, ceiling: 3.2 },
    { id: 'B10-porch', polygon: rectangle(4, 12, 370, 378), y: 8, ceiling: Infinity }];
  for (const f of depotFlights()) {
    const direction = Math.sign(f.to.z - f.from.z), cuts = [0, ...f.risers, f.length];
    for (let k = 1; k < cuts.length; k++) {
      const a = cuts[k - 1]!, b = cuts[k]!;
      const y = depotFlightHeight(f, (a + b) / 2);
      pieces.push({ id: `${f.id}-tread-${k}`, flight: f.id,
        polygon: rectangle(f.from.x - 2, f.from.x + 2, Math.min(f.from.z + direction * a, f.from.z + direction * b), Math.max(f.from.z + direction * a, f.from.z + direction * b)),
        y, ceiling: y + D.stairs.headroom });
    }
  }
  pieces.push({ id: 'B0-switchback', polygon: rectangle(-4, 10, 84, 88), y: 4, ceiling: 7.2 },
    { id: 'B10-switchback', polygon: rectangle(-10, 4, 384, 388), y: 4, ceiling: 7.2 });
  const door = depotEndpointDoors()[1]!, a = { x: 2, z: 376 };
  // Locally bevel the perpendicular-width ribbon into its four-metre wall
  // socket, preserving both jambs and the porch's exact eight-metre bounds.
  const side = 2 / Math.sqrt(10), end = [{ x: door.x, z: door.z - 2 }, { x: door.x, z: door.z + 2 }];
  const bevel = convexHull([{ x: a.x - side, z: a.z - 3 * side }, { x: a.x + side, z: a.z + 3 * side }, ...end]);
  pieces.push({ id: 'B10-covered-mouth', polygon: bevel, y: 8, ceiling: 11.2 });
  return cached = pieces;
}

function rowFloors(z0: number, z1: number) {
  const raw = depotStairFloors().map((f) => ({ ...f, span: sweep(f.polygon, z0 + TOUCH, z1 - TOUCH) })).filter((f) => f.span);
  const xs = [...new Set(raw.flatMap((f) => f.span!))].sort((a, b) => a - b);
  return xs.slice(1).flatMap((hi, i) => {
    const lo = xs[i]!, x = (lo + hi) / 2, active = raw.filter((f) => x > f.span![0] && x < f.span![1]);
    if (!active.length) return [];
    const flight = active.find((f) => f.flight), y = flight?.y ?? Math.max(...active.map((f) => f.y));
    const ceiling = Math.max(...active.map((f) => f.ceiling));
    return [{ lo, hi, y, ceiling }];
  });
}
const rows = () => {
  const zs = depotStairFloors().flatMap((f) => f.polygon.map((v) => v.z));
  const a = Math.min(...zs) - D.wallM, b = Math.max(...zs) + D.wallM;
  return [...new Set([a, b, ...zs, ...zs.flatMap((z) => [z - D.wallM, z + D.wallM]),
    ...Array.from({ length: Math.ceil((b - a) / ROW_M) }, (_, i) => Math.min(b, a + i * ROW_M))])].sort((x, y) => x - y);
};

interface Cut { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number }
function carveBox(box: BoxSpec, cut: Cut): BoxSpec[] {
  const a = { minX: box.x - box.w / 2, maxX: box.x + box.w / 2, minZ: box.z - box.d / 2, maxZ: box.z + box.d / 2, minY: box.y, maxY: box.y + box.h };
  const b = { minX: Math.max(a.minX, cut.minX), maxX: Math.min(a.maxX, cut.maxX), minZ: Math.max(a.minZ, cut.minZ), maxZ: Math.min(a.maxZ, cut.maxZ), minY: Math.max(a.minY, cut.minY), maxY: Math.min(a.maxY, cut.maxY) };
  if (b.maxX - b.minX < 1e-9 || b.maxZ - b.minZ < 1e-9 || b.maxY - b.minY < 1e-9) return [box];
  const parts = [{ ...a, maxX: b.minX }, { ...a, minX: b.maxX },
    { ...a, minX: b.minX, maxX: b.maxX, maxZ: b.minZ }, { ...a, minX: b.minX, maxX: b.maxX, minZ: b.maxZ },
    { ...b, minY: a.minY, maxY: b.minY }, { ...b, minY: b.maxY, maxY: a.maxY }];
  return parts.filter((p) => p.maxX - p.minX > 1e-9 && p.maxZ - p.minZ > 1e-9 && p.maxY - p.minY > 1e-9).map((p, i) => ({ ...box,
    id: `${box.id}-depot-cut-${i}`, x: (p.minX + p.maxX) / 2, y: p.minY, z: (p.minZ + p.maxZ) / 2,
    w: p.maxX - p.minX, h: p.maxY - p.minY, d: p.maxZ - p.minZ }));
}

/** Carve the actual tread-to-ceiling void, keeping backing earth below it and
 * roof material above it. The two U-170 ports are the only caps removed. */
export function carveDepotStairs(boxes: readonly BoxSpec[]): BoxSpec[] {
  const cuts: Cut[] = [];
  const zs = rows();
  for (let k = 1; k < zs.length; k++) {
    const z0 = zs[k - 1]!, z1 = zs[k]!;
    for (const f of rowFloors(z0, z1)) cuts.push({ minX: f.lo, maxX: f.hi, minZ: z0, maxZ: z1, minY: f.y, maxY: f.ceiling });
  }
  // Merge row cuts before applying them to large foundation slabs.
  const merged: Cut[] = [], current = new Map<string, Cut>();
  for (const c of cuts) {
    const key = `${c.minX}/${c.maxX}/${c.minY}/${c.maxY}`, old = current.get(key);
    if (old && Math.abs(old.maxZ - c.minZ) < 1e-8) old.maxZ = c.maxZ;
    else { const fresh = { ...c }; merged.push(fresh); current.set(key, fresh); }
  }
  return boxes.filter((b) => b.id !== 'depot-cap-B1-stair' && b.id !== 'depot-cap-B9-stair').flatMap((b) => {
    let pieces = [b];
    for (const c of merged) pieces = pieces.flatMap((p) => carveBox(p, c));
    return pieces;
  });
}

export function buildDepotStairs(): BoxSpec[] {
  const floors = depotStairFloors(), outer = floors.map((f) => grow(f.polygon, D.wallM)), zs = rows();
  const boxes: BoxSpec[] = [];
  let previous = new Map<string, BoxSpec>();
  for (let k = 1; k < zs.length; k++) {
    const z0 = zs[k - 1]!, z1 = zs[k]!, spans = rowFloors(z0, z1), next = new Map<string, BoxSpec>();
    function add(kind: string, lo: number, hi: number, bottom: number, top: number) {
      if (hi - lo < 1e-9 || top - bottom < 1e-9) return;
      const key = `${kind}/${lo}/${hi}/${bottom}/${top}`, old = previous.get(key);
      if (old && Math.abs(old.z + old.d / 2 - z0) < 1e-8) { old.d = z1 - (old.z - old.d / 2); old.z = z1 - old.d / 2; next.set(key, old); }
      else { const box = { id: `depot-stair-${kind}-${boxes.length}`, x: (lo + hi) / 2, y: bottom, z: (z0 + z1) / 2, w: hi - lo, h: top - bottom, d: z1 - z0 }; boxes.push(box); next.set(key, box); }
    }
    for (const f of spans) { add('floor', f.lo, f.hi, -.4, f.y); if (Number.isFinite(f.ceiling)) add('roof', f.lo, f.hi, f.ceiling, Math.max(D.surfaceY, f.ceiling + D.stairs.roofM)); }
    const ring = union(outer.map((p) => sweep(p, z0 + TOUCH, z1 - TOUCH)).filter((s): s is Interval => s !== null));
    for (const [a, b] of ring) {
      const cuts = [...new Set([a, b, ...spans.flatMap((f) => [Math.max(a, f.lo), Math.min(b, f.hi)]).filter((x) => x > a && x < b)])].sort((x, y) => x - y);
      for (let j = 1; j < cuts.length; j++) {
        const lo = cuts[j - 1]!, hi = cuts[j]!, x = (lo + hi) / 2;
        if (spans.some((f) => x > f.lo && x < f.hi)) continue;
        const near = floors.filter((f, i) => { const s = sweep(outer[i]!, z0 + TOUCH, z1 - TOUCH); return s && x > s[0] && x < s[1]; });
        const ceiling = Math.max(...near.map((f) => Number.isFinite(f.ceiling) ? f.ceiling : 11.2));
        add('wall', lo, hi, -.4, Math.max(D.surfaceY, ceiling + D.stairs.roofM));
      }
    }
    previous = next;
  }
  // Covered cheek walls remain unbroken beside the entire flight, including
  // the B0 well inside the vestibule. Only the axial landing mouths are open.
  for (const f of depotFlights()) {
    const top = Math.max(f.from.y, f.to.y) + D.stairs.headroom + D.stairs.roofM;
    for (const side of [-1, 1]) boxes.push({ id: `depot-stair-balustrade-${f.id}-${side}`, x: f.from.x + side * (2 + D.wallM / 2), y: -.4,
      z: (f.from.z + f.to.z) / 2, w: D.wallM, d: f.length, h: top + .4 });
  }
  // Existing B1/B9 masonry supplies the lower landing's outer envelope.
  // Remove helper wall/roof overlap inside their preserved room dimensions.
  return boxes.flatMap((b) => {
    let pieces = [b];
    pieces = pieces.flatMap((p) => carveBox(p, { minX: 12, maxX: 16, minZ: 65, maxZ: 71, minY: 8, maxY: 11.2 }));
    for (const r of D.rooms) pieces = pieces.flatMap((p) => carveBox(p, { ...bounds(rectangle(r.x - r.w / 2, r.x + r.w / 2, r.z - r.d / 2, r.z + r.d / 2)), minY: 0, maxY: r.ceiling }));
    return pieces;
  });
}
