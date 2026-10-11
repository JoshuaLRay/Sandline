/** U-161: authored combat shoulders and landmarks on U-159's bent road.
 * Runtime worlds only accept axis-aligned boxes. A rotated footprint is filled
 * by conservative fine box rows: its ideal polygon is wholly solid, and its
 * envelope grows by less than one row's diagonal. Collision and art therefore
 * share the same footprint without stealing a diagonal bounding rectangle.
 */
import type { BoxSpec } from '@sandline/shared';
import source from './qalat-road-combat.json' with { type: 'json' };
import supports from './qalat-road-supports.json' with { type: 'json' };
import { rectPolygon, sweep, type Point, type Polygon } from './planStrata.ts';

export const ROAD_COMBAT = source;
type Footprint = { x: number; z: number; length: number; depth: number; orientation: string; segment: readonly string[];
  polygon?: readonly (readonly number[])[] };
type Solid = { id: string; y: number; height: number; polygon: Polygon };

/** Explicit local axis, rather than an ambiguous nearest-node tangent. */
export function combatAxis(item: Footprint): Point {
  const a = supports.spine.find((p) => p.id === item.segment[0])!;
  const b = supports.spine.find((p) => p.id === item.segment[1])!;
  const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
  return item.orientation === 'across-road' ? { x: -dz / length, z: dx / length } : { x: dx / length, z: dz / length };
}

export function combatFootprint(item: Footprint): Polygon {
  if (item.polygon) return item.polygon.map(([x, z]) => ({ x: x!, z: z! }));
  const a = combatAxis(item);
  return [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([along, across]) => ({
    x: item.x + a.x * along! * item.length / 2 - a.z * across! * item.depth / 2,
    z: item.z + a.z * along! * item.length / 2 + a.x * across! * item.depth / 2,
  }));
}

const rectangle = (id: string, minX: number, maxX: number, minZ: number, maxZ: number, y: number, height: number): Solid =>
  ({ id, y, height, polygon: rectPolygon({ minX, maxX, minZ, maxZ }) });

function combatSolids(): Solid[] {
  const solids: Solid[] = [...ROAD_COMBAT.cover, ...ROAD_COMBAT.screens].map((c) => ({
    id: `road-combat-${c.id}`, y: c.y, height: c.height, polygon: combatFootprint(c),
  }));
  const office = ROAD_COMBAT.tollOffice, t = office.wallM, h = office.ceilingY - office.floorY;
  const { minX: x0, maxX: x1, minZ: z0, maxZ: z1, floorY: y } = office;
  solids.push(
    rectangle('road-combat-toll-office-west', x0 - t, x0, z0, z1, y, h),
    rectangle('road-combat-toll-office-south', x0 - t, x1 + t, z0 - t, z0, y, h),
    rectangle('road-combat-toll-office-north', x0 - t, x1 + t, z1, z1 + t, y, h),
    rectangle('road-combat-toll-office-east-south', x1, x1 + t, z0, office.doorMinZ, y, h),
    rectangle('road-combat-toll-office-east-north', x1, x1 + t, office.doorMaxZ, z1, y, h),
    rectangle('road-combat-toll-office-door-lintel', x1, x1 + t, office.doorMinZ, office.doorMaxZ,
      office.doorTopY, office.ceilingY - office.doorTopY),
    rectangle('road-combat-toll-office-roof', x0 - t, x1 + t, z0 - t, z1 + t,
      office.ceilingY, office.roofTopY - office.ceilingY),
  );
  const { trunkRadiusM, trunkHeightM, circleSides } = ROAD_COMBAT.orchard;
  const radius = trunkRadiusM / Math.cos(Math.PI / circleSides);
  for (const tree of ROAD_COMBAT.orchard.trees) solids.push({ id: `road-combat-${tree.id}`, y: tree.y, height: trunkHeightM,
    polygon: Array.from({ length: circleSides }, (_, i) => ({ x: tree.x + radius * Math.cos(2 * Math.PI * i / circleSides),
      z: tree.z + radius * Math.sin(2 * Math.PI * i / circleSides) })) });
  for (const f of ROAD_COMBAT.facades) {
    const a = combatAxis(f), n = { x: -a.z, z: a.x };
    const add = (part: string, along: number, across: number, length: number, depth: number, bottom: number, height: number) => {
      solids.push({ id: `road-combat-${f.id}-${part}`, y: bottom, height,
        polygon: combatFootprint({ ...f, x: f.x + a.x * along + n.x * across, z: f.z + a.z * along + n.z * across, length, depth }) });
    };
    // Both portals face east toward the west leg. The closed panel is one
    // metre behind the jamb fronts, on the existing shoulder, with no opening
    // through the escarpment and no new through passage.
    const recessCentre = -(f.depth - f.recessDepthM) / 2;
    add('south-jamb', -(f.length - f.jambM) / 2, recessCentre, f.jambM, f.recessDepthM, f.y, f.recessHeightM);
    add('north-jamb', (f.length - f.jambM) / 2, recessCentre, f.jambM, f.recessDepthM, f.y, f.recessHeightM);
    add('lintel', 0, recessCentre, f.length, f.recessDepthM, f.y + f.recessHeightM, f.height - f.recessHeightM);
    add('closed-panel', 0, f.depth / 2 - .1, f.length, .2, f.y, f.recessHeightM);
  }
  return solids;
}

/** Floors added to the road support and carved from U-160's enclosing rock.
 * Carving includes the office's wall footprint, then those walls close its
 * perimeter. Its 4 m east opening already overlaps the toll apron.
 */
export function combatOpenFloors(): Polygon[] {
  const o = ROAD_COMBAT.tollOffice, t = o.wallM;
  return [rectPolygon({ minX: o.minX - t, maxX: o.maxX + t, minZ: o.minZ - t, maxZ: o.maxZ + t })];
}

export function combatCoverFootprints(): Polygon[] { return ROAD_COMBAT.cover.map(combatFootprint); }

/** Guaranteed interior footprints at standing head height. Upper lintels and
 * the office roof are excluded: their floor-level footprints remain air.
 */
export function combatSightBlockers(): Polygon[] {
  return combatSolids().filter((s) => s.y <= ROAD_COMBAT.floorY && s.height >= 2.2).map((s) => s.polygon);
}
export const combatHighOccluders = combatSightBlockers;

export function combatRegroupFloors(): Polygon[] {
  return ROAD_COMBAT.regroupPads.map((p) => rectPolygon({ minX: p.x - p.w / 2, maxX: p.x + p.w / 2,
    minZ: p.z - p.d / 2, maxZ: p.z + p.d / 2 }));
}

/** Conservative sweep fills every intended footprint, including row seams. */
export function buildRoadCombat(): BoxSpec[] {
  const boxes: BoxSpec[] = [], step = ROAD_COMBAT.stratumM;
  for (const solid of combatSolids()) {
    const lo = Math.min(...solid.polygon.map((p) => p.z)), hi = Math.max(...solid.polygon.map((p) => p.z));
    const rows = Math.ceil((hi - lo) / step), rowM = (hi - lo) / rows;
    let previous: BoxSpec | undefined;
    for (let row = 0; row < rows; row++) {
      const z0 = lo + row * rowM, z1 = row === rows - 1 ? hi : lo + (row + 1) * rowM;
      const span = sweep(solid.polygon, z0, z1)!;
      if (span[1] - span[0] < 1e-10) continue;
      if (previous && Math.abs(previous.x - (span[0] + span[1]) / 2) < 1e-10 && Math.abs(previous.w - (span[1] - span[0])) < 1e-10) {
        previous.d = z1 - (previous.z - previous.d / 2); previous.z = z1 - previous.d / 2;
      } else {
        previous = { id: `${solid.id}-${row}`, x: (span[0] + span[1]) / 2, y: solid.y,
          z: (z0 + z1) / 2, w: span[1] - span[0], h: solid.height, d: z1 - z0 };
        boxes.push(previous);
      }
    }
  }
  return boxes;
}
