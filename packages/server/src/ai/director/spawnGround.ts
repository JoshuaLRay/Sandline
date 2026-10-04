import { supportUnder, type WorldBox } from '@sandline/shared';
import type { Vec3 } from './spawner.ts';

/** Existing horizontal spawn-to-nav tolerance; also bounds authored floor projection. */
export const SPAWN_ON_MESH_M = 0.3;
const SUPPORT_TOLERANCE_M = 0.05;

/** Preserve a named floor, while retaining automatic highest-surface projection for old content. */
export function spawnGround(
  point: Vec3,
  authoredY: number | undefined,
  boxes: readonly WorldBox[],
  config: { groundY: number; radius: number },
  nearest?: (p: Vec3) => { point: Vec3 } | null,
): Vec3 | null {
  if (authoredY === undefined && !nearest) return point;
  const y = supportUnder(point.x, point.z, config.radius, authoredY === undefined ? Infinity : authoredY + SUPPORT_TOLERANCE_M, boxes, config.groundY);
  if (authoredY !== undefined && Math.abs(y - authoredY) > SUPPORT_TOLERANCE_M) return null;
  if (!nearest) return { ...point, y };
  const hit = nearest({ ...point, y });
  if (!hit) return null;
  const off = Math.sqrt((hit.point.x - point.x) ** 2 + (hit.point.z - point.z) ** 2);
  if (off > SPAWN_ON_MESH_M || (authoredY !== undefined && Math.abs(hit.point.y - authoredY) > SPAWN_ON_MESH_M)) return null;
  return { x: point.x, y: hit.point.y, z: point.z };
}
