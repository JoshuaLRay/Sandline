/** U-152: D0's enclosed return alcove, joined to the existing approach court.
 * The source gives clear interior coordinates; 0.6 m walls sit outside them.
 * Floor reservations remove the insertion rock beneath the complete shell,
 * then the normal support compiler supplies the floor at y8.
 */
import type { BoxSpec } from '@sandline/shared';
import source from './qalat-return-shelters.json' with { type: 'json' };
import { rectPolygon, type Polygon } from './planStrata.ts';

export const RETURN_SHELTERS = source;

export function returnShelterFloors(): readonly Polygon[] {
  const s = RETURN_SHELTERS.store, t = s.wallM;
  return [rectPolygon({ minX: s.minX - t, maxX: s.maxX + t, minZ: s.minZ - t, maxZ: s.maxZ + t }),
    rectPolygon(s.connector)];
}

export function buildReturnShelters(): BoxSpec[] {
  const s = RETURN_SHELTERS.store, t = s.wallM, h = s.ceilingY - s.floorY;
  const box = (part: string, minX: number, maxX: number, minZ: number, maxZ: number,
    y = s.floorY, height = h): BoxSpec => ({
    id: `${s.id}-${part}`, x: (minX + maxX) / 2, y, z: (minZ + maxZ) / 2,
    w: maxX - minX, h: height, d: maxZ - minZ,
  });
  return [
    box('east', s.maxX, s.maxX + t, s.minZ, s.maxZ),
    box('south', s.minX - t, s.maxX + t, s.minZ - t, s.minZ),
    box('north', s.minX - t, s.maxX + t, s.maxZ, s.maxZ + t),
    box('west-south', s.minX - t, s.minX, s.minZ, s.doorMinZ),
    box('west-north', s.minX - t, s.minX, s.doorMaxZ, s.maxZ),
    box('door-lintel', s.minX - t, s.minX, s.doorMinZ, s.doorMaxZ,
      s.doorTopY, s.ceilingY - s.doorTopY),
    box('roof', s.minX - t, s.maxX + t, s.minZ - t, s.maxZ + t,
      s.ceilingY, s.roofTopY - s.ceilingY),
  ];
}
