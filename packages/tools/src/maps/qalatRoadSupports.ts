/** U-149: continuous approved road support, outside the campaign until U-117.
 * Only the accepted insertion's north road cap is opened. New structural slabs
 * start at y5.5: no full-map foundation may fill future basement rooms.
 */
import { createHash } from 'node:crypto';
import { loadLevel, type BoxSpec } from '@sandline/shared';
import source from './qalat-road-supports.json' with { type: 'json' };
import { INSERTION, buildInsertionLevel } from './qalatInsertion.ts';

export const ROAD_SUPPORTS = source;
type Point = { x: number; z: number };
type Polygon = readonly Point[];
type Interval = [number, number];
const STRATUM_M = .025;
const EDGE_M = .005;
const CIRCLE_SIDES = 512;

function segment(a: Point, b: Point, width: number): Polygon {
  const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
  const x = -dz / length * width / 2, z = dx / length * width / 2;
  return [{ x: a.x + x, z: a.z + z }, { x: b.x + x, z: b.z + z },
    { x: b.x - x, z: b.z - z }, { x: a.x - x, z: a.z - z }];
}

function hull(points: readonly Point[]): Polygon {
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

/** The larger aprons contain every changing-tangent join, including its bevel. */
export function roadSupportFloors(): readonly Polygon[] {
  const { spine, ribbonWidth, apronNodes, apronDiameter } = ROAD_SUPPORTS;
  const ribbons = spine.slice(1).map((p, i) => segment(spine[i]!, p, ribbonWidth));
  const bevels = spine.slice(1, -1).map((_, i) => hull([
    ribbons[i]![1]!, ribbons[i]![2]!, ribbons[i + 1]![0]!, ribbons[i + 1]![3]!,
  ]));
  // Circumscribed polygon keeps all points on the specified 18 m radius
  // supported. Its <0.0004 m expansion is included in the construction tolerance.
  const radius = apronDiameter / 2 / Math.cos(Math.PI / CIRCLE_SIDES);
  const aprons = spine.filter((p) => apronNodes.includes(p.id)).map((p) =>
    Array.from({ length: CIRCLE_SIDES }, (_, i) => ({
      x: p.x + radius * Math.cos(2 * Math.PI * i / CIRCLE_SIDES),
      z: p.z + radius * Math.sin(2 * Math.PI * i / CIRCLE_SIDES),
    })));
  return [...ribbons, ...bevels, ...aprons];
}

function scan(polygon: Polygon, z: number): Interval | null {
  const xs: number[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
    if (z < Math.min(a.z, b.z) || z > Math.max(a.z, b.z)) continue;
    if (a.z === b.z) { if (z === a.z) xs.push(a.x, b.x); }
    else xs.push(a.x + (b.x - a.x) * (z - a.z) / (b.z - a.z));
  }
  return xs.length ? [Math.min(...xs), Math.max(...xs)] : null;
}

function sweep(p: Polygon, z0: number, z1: number): Interval | null {
  const spans = [z0, z1, ...p.filter((v) => v.z > z0 && v.z < z1).map((v) => v.z)]
    .map((z) => scan(p, z)).filter((s): s is Interval => s !== null);
  return spans.length ? [Math.min(...spans.map((s) => s[0])), Math.max(...spans.map((s) => s[1]))] : null;
}

function union(spans: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const s of spans.sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1);
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else out.push([...s]);
  }
  return out;
}

const floors = roadSupportFloors();
export function onRoadSupportFloor(p: Point, margin = 0): boolean {
  return floors.some((poly) => {
    const span = scan(poly, p.z);
    return span !== null && p.x >= span[0] - margin && p.x <= span[1] + margin;
  });
}

export function buildRoadSupportLevel() {
  const roadMouth = ROAD_SUPPORTS.spine[1]!;
  const insertion = buildInsertionLevel({ ...INSERTION,
    continuations: INSERTION.continuations.map((p) => p.id === 'road' ? { ...p, x: roadMouth.x, z: roadMouth.z } : p),
  }, floors);
  const boxes: BoxSpec[] = [];
  const minZ = Math.min(...floors.flatMap((p) => p.map((v) => v.z)));
  const maxZ = Math.max(...floors.flatMap((p) => p.map((v) => v.z)));
  let previous = new Map<string, BoxSpec>();
  for (let row = 0; row < Math.ceil((maxZ - minZ) / STRATUM_M); row++) {
    const z0 = minZ + row * STRATUM_M, z1 = Math.min(maxZ, minZ + (row + 1) * STRATUM_M);
    // Conservative bounds across the whole row, not midpoint sampling. The
    // skin supports required perpendicular shoulder probes through row seams.
    const spans = union(floors.map((p) => sweep(p, z0 - EDGE_M, z1 + EDGE_M))
      .filter((s): s is Interval => s !== null).map(([a, b]) => [a - EDGE_M, b + EDGE_M]));
    const next = new Map<string, BoxSpec>();
    for (const [lo, hi] of spans) {
      const key = `${lo},${hi}`, old = previous.get(key);
      if (old) { old.d = z1 - (old.z - old.d / 2); old.z = z1 - old.d / 2; next.set(key, old); }
      else {
        const b = { id: `road-support-${boxes.length}`, x: (lo + hi) / 2, y: ROAD_SUPPORTS.supportBottomY,
          z: (z0 + z1) / 2, w: hi - lo, h: ROAD_SUPPORTS.floorY - ROAD_SUPPORTS.supportBottomY, d: z1 - z0 };
        boxes.push(b); next.set(key, b);
      }
    }
    previous = next;
  }
  return { ...insertion, id: ROAD_SUPPORTS.id, floor: { halfWidth: 80, halfDepth: 370 },
    boxes: [...insertion.boxes, ...boxes] };
}

export function buildRoadSupportWorld() { return loadLevel(buildRoadSupportLevel()); }

export function roadSupportManifest() {
  const level = buildRoadSupportLevel();
  return { task: 'U-149', parent: 'U-139', kind: 'isolated road support whitebox',
    activeCampaign: 'unchanged; activation belongs to U-117',
    sourceHash: createHash('sha256').update(JSON.stringify({ insertion: INSERTION, road: ROAD_SUPPORTS })).digest('hex'),
    levelHash: createHash('sha256').update(JSON.stringify(level)).digest('hex'), boxCount: level.boxes.length,
    stratumM: STRATUM_M, edgeExpansionM: EDGE_M, circleSides: CIRCLE_SIDES,
    floorY: ROAD_SUPPORTS.floorY, supportBottomY: ROAD_SUPPORTS.supportBottomY,
    ribbonWidth: ROAD_SUPPORTS.ribbonWidth, carriagewayWidth: ROAD_SUPPORTS.carriagewayWidth,
    shoulderWidth: ROAD_SUPPORTS.shoulderWidth, apronDiameter: ROAD_SUPPORTS.apronDiameter,
    spine: ROAD_SUPPORTS.spine, apronNodes: ROAD_SUPPORTS.apronNodes,
    reservedBridge: ROAD_SUPPORTS.reservedBridge, reservedVault: ROAD_SUPPORTS.reservedVault,
    ownerQualityVerdict: 'pending',
    unfinished: ['road fight geology/cover/shells: U-150', 'X ingress/tank sweep: U-151',
      'return shelters/blast protection: U-152', 'ridge/bridge: U-140', 'basement: U-115'],
  };
}

export function roadSupportPlanSvg(): string {
  const p = (n: number) => n.toFixed(3);
  const polygons = floors.map((poly) => `<polygon points="${poly.map((v) => `${p(v.x)},${p(-v.z)}`).join(' ')}"/>`).join('\n');
  const labels = ROAD_SUPPORTS.spine.map((s) => `<circle cx="${s.x}" cy="${-s.z}" r="1"/><text x="${s.x + 2}" y="${-s.z - 2}">${s.id} · y8</text>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="1400" viewBox="-40 -376 125 330">
<rect x="-40" y="-376" width="125" height="330" fill="#b7c6ca"/>
<g fill="#d8ccb6" stroke="#766a54" stroke-width=".1">${polygons}</g>
<rect x="16" y="-288" width="28" height="36" fill="none" stroke="#5b6d86" stroke-dasharray="1 1"/>
<rect x="66" y="-342" width="8" height="12" fill="none" stroke="#5b6d86" stroke-dasharray="1 1"/>
<g fill="#162e35" font-family="sans-serif" font-size="2.5">${labels}
<text x="-35" y="-369" font-size="3.5">U-149 · road support plan · north ↑</text>
<text x="-35" y="-363">20 m ribbon / 12 m carriageway / 36 m turning aprons</text>
<text x="-35" y="-358">Dashed: future B6 vault and ridge bridge; reserved.</text>
<text x="-35" y="-50">Isolated whitebox; fight geometry and tank ingress unfinished.</text></g>
</svg>\n`;
}
