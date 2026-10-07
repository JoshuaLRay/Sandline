/** U-138: a buildable southern section of the U-107 replacement, outside the
 * campaign registry until U-117. Collision and review rendering use one build.
 * Axis-aligned rock strata conservatively carve the exact beveled ribbons;
 * the largest boundary expansion is < 0.05 m, without stealing clear width.
 */
import { createHash } from 'node:crypto';
import { loadLevel, type BoxSpec } from '@sandline/shared';
import source from './qalat-insertion.json' with { type: 'json' };

export const INSERTION = source;
type Point = { x: number; z: number };
type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
type Interval = [number, number];
type Polygon = readonly Point[];
const STRATUM_M = .0125;
const EDGE_M = .005;
const rectPolygon = (r: Rect): Polygon => [
  { x: r.minX, z: r.minZ }, { x: r.maxX, z: r.minZ },
  { x: r.maxX, z: r.maxZ }, { x: r.minX, z: r.maxZ },
];

function segment(a: Point, b: Point, width: number): Polygon {
  const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
  if (length === 0 || width <= 0) throw new Error('Invalid authoring ribbon');
  const x = -dz / length * width / 2, z = dx / length * width / 2;
  return [{ x: a.x + x, z: a.z + z }, { x: b.x + x, z: b.z + z },
    { x: b.x - x, z: b.z - z }, { x: a.x - x, z: a.z - z }];
}

/** Convex bevel of the two segment ends; never adds a full-width square corner. */
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

export function insertionFloors(source = INSERTION): readonly Polygon[] {
  const { spine, ribbonWidth, continuations, pocket, court } = source;
  const ribbons = spine.slice(1).map((p, i) => segment(spine[i]!, p, ribbonWidth));
  const bevels = spine.slice(1, -1).map((_, i) => hull([
    ribbons[i]![1]!, ribbons[i]![2]!, ribbons[i + 1]![0]!, ribbons[i + 1]![3]!,
  ]));
  return [rectPolygon(pocket), rectPolygon(court), ...ribbons, ...bevels,
    ...continuations.map((p) => segment(spine.at(-1)!, p, p.width)),
    // Future joins need standing room at the exact node, not a nav endpoint
    // clipped by an unfinished continuation's temporary rock cap.
    ...continuations.map((p) => rectPolygon({ minX: p.x - 2, maxX: p.x + 2, minZ: p.z - 2, maxZ: p.z + 2 }))];
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

/** Bounds over the entire stratum, including vertices inside it (not midpoint sampling). */
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

/** Closed exact design footprint; used by verification and later leaves. */
export function onInsertionFloor(p: Point, margin = 0): boolean {
  return insertionFloors().some((poly) => {
    const span = scan(poly, p.z);
    return span !== null && p.x >= span[0] - margin && p.x <= span[1] + margin;
  });
}

export function buildInsertionLevel(source = INSERTION) {
  const { bounds, floorY, masses, overhang, rockCores } = source;
  const floors = insertionFloors(source);
  const massPolys = masses.map((m) => ({ ...m, polygon: m.polygon.map(([x, z]) => ({ x: x!, z: z! })) }));
  const boxes: BoxSpec[] = [{ id: 'insertion-foundation', x: (bounds.minX + bounds.maxX) / 2, y: 0, z: (bounds.minZ + bounds.maxZ) / 2,
    w: bounds.maxX - bounds.minX, d: bounds.maxZ - bounds.minZ, h: floorY }];
  function strata(step: number, bottom: number, heights: boolean) {
    let previous = new Map<string, BoxSpec>();
    const rows = Math.round((bounds.maxZ - bounds.minZ) / step);
    for (let row = 0; row < rows; row++) {
      const z0 = bounds.minZ + row * step, z1 = bounds.minZ + (row + 1) * step;
      // A small skin on both axes preserves the clear ribbon even where a
      // tiny square footprint straddles two rows on a shallow diagonal.
      const open = union(floors.map((p) => sweep(p, z0 - EDGE_M, z1 + EDGE_M)).filter((s): s is Interval => s !== null)
        .map(([a, b]) => [a - EDGE_M, b + EDGE_M]));
      const upper = heights ? massPolys.map((m) => ({ ...m, span: sweep(m.polygon, z0, z1) })) : [];
      const cuts = [...new Set([bounds.minX, bounds.maxX, ...open.flat(), ...upper.flatMap((m) => m.span ?? [])])]
        .filter((x) => x >= bounds.minX && x <= bounds.maxX).sort((a, b) => a - b);
      const next = new Map<string, BoxSpec>();
      for (let i = 1; i < cuts.length; i++) {
        const lo = cuts[i - 1]!, hi = cuts[i]!, x = (lo + hi) / 2;
        const walk = open.some(([a, b]) => x >= a && x <= b);
        if (walk) continue;
        // Fine carving at walking edges; coarse rock strata only above y26.
        // The surrounding backing geology never exposes a flat route bypass.
        const top = Math.max(26, ...upper.filter((m) => m.span && x >= m.span[0] && x <= m.span[1]).map((m) => m.top));
        if (top <= bottom) continue;
        const key = `${lo},${hi},${top}`;
        const old = previous.get(key);
        if (old) { old.d = z1 - (old.z - old.d / 2); old.z = z1 - old.d / 2; next.set(key, old); }
        else {
          const box = { id: `rock-${boxes.length}`, x, y: bottom, z: (z0 + z1) / 2, w: hi - lo, h: top - bottom, d: z1 - z0 };
          boxes.push(box); next.set(key, box);
        }
      }
      previous = next;
    }
  }
  strata(STRATUM_M, floorY, false);
  strata(.5, 26, true);
  return {
    id: source.id, format: 1,
    // The isolated section has finite backing terrain. U-117 supplies the
    // approved full-map technical bounds (220 x 520) on production activation.
    floor: { halfWidth: Math.max(Math.abs(bounds.minX), Math.abs(bounds.maxX)),
      halfDepth: Math.max(Math.abs(bounds.minZ), Math.abs(bounds.maxZ)) },
    squadStarts: source.squadStarts,
    boxes: [...boxes, ...rockCores, overhang], pieces: [],
  };
}

export function buildInsertionWorld() { return loadLevel(buildInsertionLevel()); }

export function insertionManifest() {
  const level = buildInsertionLevel();
  return {
    task: 'U-138', kind: 'isolated construction whitebox', activeCampaign: 'unchanged; activation belongs to U-117',
    sourceHash: createHash('sha256').update(JSON.stringify(INSERTION)).digest('hex'),
    levelHash: createHash('sha256').update(JSON.stringify(level)).digest('hex'),
    boxCount: level.boxes.length, stratumM: STRATUM_M, edgeExpansionM: EDGE_M,
    floorY: INSERTION.floorY, spine: INSERTION.spine, continuations: INSERTION.continuations,
    squadStarts: INSERTION.squadStarts, ownerQualityVerdict: 'pending',
  };
}

export function insertionPlanSvg(): string {
  const p = (n: number) => n.toFixed(2);
  const polygons = insertionFloors().map((poly) => `<polygon points="${poly.map((v) => `${p(v.x)},${p(-v.z)}`).join(' ')}"/>`).join('\n');
  const labels = INSERTION.spine.map((s) => `<circle cx="${s.x}" cy="${-s.z}" r="1"/><text x="${s.x + 2}" y="${-s.z - 2}">${s.id} · y8</text>`).join('\n');
  const masses = INSERTION.masses.map((m) => `<polygon points="${m.polygon.map(([x, z]) => `${x},${-z!}`).join(' ')}" fill="#66685f"/>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="900" viewBox="-76 -98 152 142">
<rect x="-76" y="-98" width="152" height="142" fill="#afb0a1"/>
${masses}<g fill="#d8ccb6">${polygons}</g>
<rect x="-8" y="-12" width="26" height="30" fill="#69736d" opacity=".45"/>
<g fill="#162e35" font-family="sans-serif" font-size="2.5">${labels}
<text x="-69" y="-89" font-size="3.5">U-138 · Juniper Hollow construction plan · north ↑</text>
<text x="-69" y="38">y8 floors · 8 m insertion ribbons · y13 overhang underside · owner quality pending</text>
<text x="-69" y="-83">Isolated replacement section; campaign activation remains U-117.</text></g>
</svg>\n`;
}
