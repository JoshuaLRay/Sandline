/** U-110: supported vehicle feet and full body clearance on the intended storey. */
import type { EnemyVehicle } from './enemies.ts';
import type { DrivePoint } from './vehicle.ts';
import { blockedAt, supportUnder, type WorldBox } from './world.ts';
import { POSITION } from '../net/quantize.ts';

export const VEHICLE_STEP_M = 0.45;
export const VEHICLE_CLEARANCE_M = 2.4;
const FLOOR_TOLERANCE_M = 0.05;

/** Null means a ledge, an unsupported layer or an obstruction; never project onto an overhead deck. */
export function vehicleSupport(
  at: { x: number; y: number; z: number },
  forward: { x: number; z: number },
  vehicle: EnemyVehicle,
  boxes: readonly WorldBox[],
  groundY = 0,
  tolerance = FLOOR_TOLERANCE_M,
): number | null {
  const half = vehicle.hull.radius + 0.1;
  const reach = Math.abs(vehicle.hull.to[2] - vehicle.hull.from[2]) / 2;
  const height = Math.max(
    VEHICLE_CLEARANCE_M,
    ...[vehicle.hull, vehicle.turret].map(
      (p) => Math.max(p.from[1], p.to[1]) + p.radius,
    ),
  );
  const y = supportUnder(at.x, at.z, 0, at.y + tolerance, boxes, groundY);
  if (Math.abs(y - at.y) > tolerance) return null;
  for (const along of [0, reach, -reach]) {
    const x = at.x + forward.x * along;
    const z = at.z + forward.z * along;
    if (blockedAt(x, z, half, y, tolerance, height, boxes)) return null;
  }
  // Support the entire conservative footprint, including the front/rear and both track edges.
  for (const along of [0, reach + half, -reach - half])
    for (const side of [-half, 0, half]) {
      const x = at.x + forward.x * along - forward.z * side;
      const z = at.z + forward.z * along + forward.x * side;
      if (
        Math.abs(supportUnder(x, z, 0, at.y + tolerance, boxes, groundY) - y) >
        tolerance
      )
        return null;
    }
  return y;
}

/** Inherit omitted heights, retaining the old y=0 contract; sample between endpoints as well as at them. */
export function validateVehiclePath(
  from: DrivePoint,
  path: readonly DrivePoint[],
  vehicle: EnemyVehicle,
  boxes: readonly WorldBox[],
  where: string,
  initialForward?: { x: number; z: number },
): void {
  // Legacy paths were checked only at their centre/endpoints. Preserve that authoring contract.
  if (from.y === undefined && !path.some((p) => p.y !== undefined)) {
    for (const p of [from, ...path])
      if (
        blockedAt(
          p.x,
          p.z,
          vehicle.hull.radius + 0.1,
          0,
          VEHICLE_STEP_M,
          VEHICLE_CLEARANCE_M,
          boxes,
        )
      )
        throw new Error(`${where}.path: vehicle hull does not fit`);
    return;
  }
  let previous = { x: from.x, z: from.z, y: from.y ?? 0 };
  if (
    initialForward &&
    vehicleSupport(previous, initialForward, vehicle, boxes) === null
  )
    throw new Error(
      `${where}: vehicle spawn support or hull/turret clearance fails`,
    );
  for (const [i, raw] of path.entries()) {
    const point = { x: raw.x, z: raw.z, y: raw.y ?? previous.y };
    for (const p of [previous, point])
      if (
        Object.values(p).some(
          (v) => !Number.isFinite(v) || v < POSITION.min || v > POSITION.max,
        )
      )
        throw new Error(`${where}.path[${i}]: outside wire bounds`);
    const dx = point.x - previous.x;
    const dz = point.z - previous.z;
    const length = Math.sqrt(dx * dx + dz * dz);
    if (length < 1e-6 && Math.abs(point.y - previous.y) > FLOOR_TOLERANCE_M)
      throw new Error(`${where}.path[${i}]: vertical-only vehicle path`);
    const forward =
      length > 1e-6 ? { x: dx / length, z: dz / length } : { x: 0, z: 1 };
    const count = Math.max(1, Math.ceil(length / 0.5));
    for (let j = 0; j <= count; j++) {
      const t = j / count;
      const at = {
        x: previous.x + dx * t,
        y: previous.y + (point.y - previous.y) * t,
        z: previous.z + dz * t,
      };
      if (
        vehicleSupport(
          at,
          forward,
          vehicle,
          boxes,
          0,
          j === 0 || j === count ? FLOOR_TOLERANCE_M : VEHICLE_STEP_M,
        ) === null
      )
        throw new Error(
          `${where}.path[${i}]: vehicle support or hull/turret clearance fails at (${at.x}, ${at.y}, ${at.z})`,
        );
    }
    previous = point;
  }
}
