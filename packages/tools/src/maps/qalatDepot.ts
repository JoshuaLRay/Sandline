/** U-170 shells with U-171 covered endpoint stairs, isolated until U-117. */
import { createHash } from 'node:crypto';
import { loadLevel, type BoxSpec } from '@sandline/shared';
import source from './qalat-depot.json' with { type: 'json' };
import { buildRoadSupportLevel } from './qalatRoadSupports.ts';
import { buildDepotStairs, carveDepotStairs, depotEndpointDoors, depotFlights, depotStairFloors } from './qalatDepotStairs.ts';
export { depotEndpointDoors, depotFlightHeight, depotFlights, depotStairFloors, depotStairNodes } from './qalatDepotStairs.ts';
import { convexHull, ribbonPieces } from './roadSightLines.ts';
import { clipConvex, rectPolygon, sweep, union, type Interval, type Point, type Polygon } from './planStrata.ts';

export const DEPOT = source;
const ROW_M = .05;
type Room = typeof DEPOT.rooms[number];
type Door = Point & { id: string; room: string; axis: 'x' | 'z'; normal: number };
type Volume = { polygon: Polygon; ceiling: number };
const roomPolygon = (r: Room) => rectPolygon({ minX: r.x - r.w / 2, maxX: r.x + r.w / 2,
  minZ: r.z - r.d / 2, maxZ: r.z + r.d / 2 });
const room = (id: string) => DEPOT.rooms.find((r) => r.id === id)!;

/** Intersect the listed centreline with the inside wall, without snapping to
 * the nearest grid or widening a diagonal doorway along its room wall. */
function portal(r: Room, toward: Point, id: string): Door {
  const dx = toward.x - r.x, dz = toward.z - r.z;
  const tx = dx === 0 ? Infinity : r.w / 2 / Math.abs(dx);
  const tz = dz === 0 ? Infinity : r.d / 2 / Math.abs(dz);
  const t = Math.min(tx, tz), axis = tx < tz ? 'x' : 'z';
  return { id, room: r.id, x: r.x + dx * t, z: r.z + dz * t,
    axis, normal: Math.sign(axis === 'x' ? dx : dz) };
}
const connections = DEPOT.connectors.map((c) => {
  const a = room(c.from), b = room(c.to);
  return { ...c, a: portal(a, c.via[0]!, `${c.from}-${c.to}-out`),
    b: portal(b, c.via.at(-1)!, `${c.from}-${c.to}-in`) };
});
export function depotDoors(): Door[] { return connections.flatMap((c) => [c.a, c.b]); }

function doorFace(d: Door, depth: number): Point[] {
  return [-1, 1].map((side) => ({
    x: d.x + (d.axis === 'x' ? d.normal * depth : side * DEPOT.corridorWidth / 2),
    z: d.z + (d.axis === 'z' ? d.normal * depth : side * DEPOT.corridorWidth / 2),
  }));
}
const neck = (d: Door) => convexHull([...doorFace(d, 0), ...doorFace(d, DEPOT.wallM)]);
const grow = (p: Polygon, amount: number) => convexHull(p.flatMap((v) => [-amount, amount]
  .flatMap((x) => [-amount, amount].map((z) => ({ x: v.x + x, z: v.z + z })))));
const area = (p: Polygon) => Math.abs(p.reduce((sum, a, i) => {
  const b = p[(i + 1) % p.length]!; return sum + a.x * b.z - b.x * a.z;
}, 0)) / 2;

/** Parallel connectors at B6/B7 graze a room's inside wall. Keep that wall
 * intact except its named doorway; widen the local corridor away from it by
 * the masonry depth so clipping cannot reduce its four-metre clear width. */
function outsideRooms(polygon: Polygon): Polygon[] {
  let pieces = [polygon];
  for (const r of DEPOT.rooms) {
    const x0 = r.x - r.w / 2 - DEPOT.wallM, x1 = r.x + r.w / 2 + DEPOT.wallM;
    const z0 = r.z - r.d / 2 - DEPOT.wallM, z1 = r.z + r.d / 2 + DEPOT.wallM;
    const bounds = rectPolygon({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 });
    pieces = pieces.flatMap((p) => {
      if (area(clipConvex(p, bounds)) < 1e-8) return [p];
      const widened = grow(p, DEPOT.wallM);
      return [
        { minX: -1000, maxX: x0, minZ: -1000, maxZ: 1000 },
        { minX: x1, maxX: 1000, minZ: -1000, maxZ: 1000 },
        { minX: x0, maxX: x1, minZ: -1000, maxZ: z0 },
        { minX: x0, maxX: x1, minZ: z1, maxZ: 1000 },
      ].map((cut) => clipConvex(widened, rectPolygon(cut))).filter((part) => area(part) > 1e-8);
    });
  }
  return pieces;
}

/** Outside the wall the corridor locally bevels from the 4 m portal to its
 * ordinary perpendicular width. Its centreline still meets the exact socket. */
function approach(d: Door, toward: Point) {
  const dx = toward.x - d.x, dz = toward.z - d.z, length = Math.hypot(dx, dz);
  const t = Math.min(4, length / 2) / length;
  const p = { x: d.x + dx * t, z: d.z + dz * t };
  const side = { x: -dz / length * 2, z: dx / length * 2 };
  return { point: p, polygon: convexHull([...doorFace(d, DEPOT.wallM),
    { x: p.x + side.x, z: p.z + side.z }, { x: p.x - side.x, z: p.z - side.z }]) };
}

const volumes: Volume[] = DEPOT.rooms.map((r) => ({ polygon: roomPolygon(r), ceiling: r.ceiling }));
for (const c of connections) {
  const a = approach(c.a, c.via[0]!), b = approach(c.b, c.via.at(-1)!);
  volumes.push(...[neck(c.a), neck(c.b)].map((polygon) => ({ polygon, ceiling: DEPOT.doorHeight })),
    ...[a.polygon, ...ribbonPieces([a.point, ...c.via, b.point], DEPOT.corridorWidth), b.polygon]
      .flatMap(outsideRooms)
      .map((polygon) => ({ polygon, ceiling: DEPOT.corridorCeiling })));
}
const ports: Door[] = DEPOT.stairPorts.map((p) => ({ ...p, axis: p.axis as 'x' | 'z' }));
volumes.push(...ports.map((d) => ({ polygon: neck(d), ceiling: DEPOT.doorHeight })));
export function depotFloors(): readonly Polygon[] { return volumes.map((v) => v.polygon); }

/** Conservative row union of all voids, then its outward 0.6 m masonry ring.
 * All vertex rows are included: exact room/door faces stay exact, diagonal
 * stair-step wall skins expand the free corridor by at most one 5 cm row.
 * A roof's bottom follows the highest overlapping void, never filling it.
 */
export function buildDepotShell(): BoxSpec[] {
  const outer = volumes.map((v) => grow(v.polygon, DEPOT.wallM));
  const all = [...volumes.map((v) => v.polygon), ...outer];
  const minZ = Math.min(...all.flatMap((p) => p.map((v) => v.z))), maxZ = Math.max(...all.flatMap((p) => p.map((v) => v.z)));
  const rows = [...new Set([minZ, maxZ, ...all.flatMap((p) => p.map((v) => v.z)),
    ...Array.from({ length: Math.ceil((maxZ - minZ) / ROW_M) }, (_, i) => Math.min(maxZ, minZ + i * ROW_M))])].sort((a, b) => a - b);
  const boxes: BoxSpec[] = [];
  let previous = new Map<string, BoxSpec>();
  for (let row = 1; row < rows.length; row++) {
    const z0 = rows[row - 1]!, z1 = rows[row]!;
    if (z1 - z0 < 1e-8) continue;
    const spans = volumes.map((v) => ({ span: sweep(v.polygon, z0 + 1e-9, z1 - 1e-9), ceiling: v.ceiling }));
    const edges = union(outer.map((p) => sweep(p, z0 + 1e-9, z1 - 1e-9)).filter((s): s is Interval => s !== null));
    const cuts = [...new Set([...edges.flat(), ...spans.flatMap((v) => v.span ?? [])])].sort((a, b) => a - b);
    const next = new Map<string, BoxSpec>();
    function add(lo: number, hi: number, y: number, top: number, kind: string) {
      if (hi - lo < 1e-8) return;
      const key = `${kind}/${lo}/${hi}/${y}/${top}`, old = previous.get(key);
      if (old) { old.d = z1 - (old.z - old.d / 2); old.z = z1 - old.d / 2; next.set(key, old); }
      else {
        const box = { id: `depot-${kind}-${boxes.length}`, x: (lo + hi) / 2, y, z: (z0 + z1) / 2,
          w: hi - lo, h: top - y, d: z1 - z0 };
        boxes.push(box); next.set(key, box);
      }
    }
    for (let i = 1; i < cuts.length; i++) {
      const lo = cuts[i - 1]!, hi = cuts[i]!, x = (lo + hi) / 2;
      if (!edges.some(([a, b]) => x > a && x < b)) continue;
      const active = spans.filter((v) => v.span && x > v.span[0] && x < v.span[1]);
      const bottom = active.length ? Math.max(...active.map((v) => v.ceiling)) : 0;
      add(lo, hi, bottom, DEPOT.surfaceY, active.length ? 'roof' : 'wall');
      add(lo, hi, -.4, 0, 'floor');
    }
    previous = next;
  }
  for (const d of ports) {
    const points = neck(d), xs = points.map((p) => p.x), zs = points.map((p) => p.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    boxes.push({ id: `depot-cap-${d.id}`, x: (minX + maxX) / 2, y: 0, z: (minZ + maxZ) / 2,
      w: maxX - minX, h: DEPOT.doorHeight, d: maxZ - minZ });
  }
  return carveDepotStairs(boxes);
}

export function buildDepotLevel() {
  const surface = buildRoadSupportLevel();
  return { ...surface, id: DEPOT.id, boxes: [...carveDepotStairs(surface.boxes), ...buildDepotShell(), ...buildDepotStairs()] };
}
export function buildDepotWorld() { return loadLevel(buildDepotLevel()); }
export function depotManifest() {
  const level = buildDepotLevel();
  return { task: 'U-171', parent: 'U-115', kind: 'isolated B1–B9 enclosed shells with covered B0/B10 stairs and exact endpoint connections',
    sourceHash: createHash('sha256').update(JSON.stringify(DEPOT)).digest('hex'),
    levelHash: createHash('sha256').update(JSON.stringify(level)).digest('hex'),
    boxCount: level.boxes.length, shellBoxCount: buildDepotShell().length, rowM: ROW_M,
    rooms: DEPOT.rooms, connectors: DEPOT.connectors, doors: depotDoors(), stairPorts: DEPOT.stairPorts,
    endpoints: DEPOT.endpoints, stairs: DEPOT.stairs, flights: depotFlights(), endpointDoors: depotEndpointDoors(),
    activeCampaign: 'unchanged; activation U-117', humanVerdict: 'whole-mission acceptance U-119',
    unfinished: ['fixed internals: U-172', 'integrated seven-actor/floor-isolation proof: U-173'] };
}
export function depotPlanSvg() {
  const polygons = [...depotFloors(), ...depotStairFloors().map((f) => f.polygon)].map((p) => `<polygon points="${p.map((v) => `${v.x},${-v.z}`).join(' ')}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="1320" viewBox="-58 -392 112 338"><rect x="-58" y="-392" width="112" height="338" fill="#45483d"/><g fill="#d4c2a0" stroke="#786247" stroke-width=".15">${polygons}</g><g font-size="3" font-family="sans-serif" fill="#142b32">${DEPOT.rooms.map((r) => `<text x="${r.x - 3}" y="${-r.z}">${r.id} · ${r.ceiling} m</text>`).join('')}</g></svg>\n`;
}
