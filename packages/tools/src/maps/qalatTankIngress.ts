/** U-151: the exact screened service spur; the bridge above remains U-140. */
import { type BoxSpec } from '@sandline/shared';
import source from './qalat-tank-ingress.json' with { type: 'json' };
import { rectPolygon, sweep, type Point, type Polygon } from './planStrata.ts';
import { ribbonPieces } from './roadSightLines.ts';

export const TANK_INGRESS = source;
const SIDES = 512;
export function tankIngressFloors(): readonly Polygon[] {
  const radius = TANK_INGRESS.apronDiameter / 2 / Math.cos(Math.PI / SIDES);
  return [rectPolygon(TANK_INGRESS.motorPool),
    ...ribbonPieces(TANK_INGRESS.spine, TANK_INGRESS.carriagewayWidth),
    ...TANK_INGRESS.spine.filter((p) => TANK_INGRESS.apronNodes.includes(p.id)).map((p) =>
      Array.from({ length: SIDES }, (_, i) => ({
        x: p.x + radius * Math.cos(2 * Math.PI * i / SIDES), z: p.z + radius * Math.sin(2 * Math.PI * i / SIDES),
      })))];
}
const floors = tankIngressFloors();
export function onTankIngressFloor(p: Point, margin = 0): boolean {
  return floors.some((poly) => {
    const span = sweep(poly, p.z - margin, p.z + margin);
    return span !== null && p.x >= span[0] - margin && p.x <= span[1] + margin;
  });
}
export function buildTankIngressShelter(): BoxSpec[] {
  const p = TANK_INGRESS.motorPool;
  return [{ id: 'X0-rock-canopy', x: (p.minX + p.maxX) / 2, y: p.undersideY,
    z: (p.minZ + p.maxZ) / 2, w: p.maxX - p.minX, h: p.thicknessM, d: p.maxZ - p.minZ },
  // Key the exact pool canopy into T-N across the compiler's tiny skin setback.
  { id: 'X0-canopy-T-N-key', x: p.minX, y: p.undersideY,
    z: (p.minZ + p.maxZ) / 2, w: 1, h: p.thicknessM, d: p.maxZ - p.minZ },
  ...TANK_INGRESS.returns];
}
