/**
 * A tank's driving (U-067): follow an authored path at a set speed, turning at a limited rate and never reversing.
 *
 * It is an enemy on rails (owner, 2026-09-30), not a rigid body: no wheels, no physics, only a heading that turns
 * toward the next waypoint and a position that goes forward along it. The session asks `canMove` about each step, so
 * a wall, a script's blocker or a soldier in the way holds it where it is; it waits, and goes on when the way is clear.
 *
 * Determinism (ADR-014): table trigonometry and the four arithmetic operators only. The steering works from the cross
 * and dot of its heading with the direction to the waypoint, so it needs no arctangent, and it turns in whole table
 * units so the same path gives the same drive on every engine.
 */
import { ANGLE_MASK, ANGLE_UNITS, type BinAngle, WIRE_ANGLE_UNITS } from '../math/angles.ts';
import { cos, sin } from '../math/trig.ts';

export interface DrivePoint {
  x: number;
  z: number;
}

/** The numbers a tank drives by (`enemies.json` `vehicle`). */
export interface DriveConfig {
  speedMps: number;
  turnDegPerSec: number;
  /** A waypoint is reached inside this distance, m. */
  arriveM: number;
}

/** Where a drive stands: going, at the end of its path, or held by something in the way. */
export type DrivePhase = 'driving' | 'arrived' | 'blocked';

export interface VehicleDrive {
  path: readonly DrivePoint[];
  /** The waypoint it is heading for; `path.length` once it has reached the last. */
  next: number;
  /** Hull heading in table units, kept fractional so a slow turn is not lost to rounding. */
  heading: number;
  phase: DrivePhase;
}

/** Keep it to a road: a path longer than this is a mistake in the data. */
export const MAX_DRIVE_POINTS = 64;

/** A drive that starts at `path[0]`'s direction of travel: it begins facing the wire yaw given (1024 to a turn). */
export function createDrive(path: readonly DrivePoint[], yawWire: number): VehicleDrive {
  if (path.length === 0 || path.length > MAX_DRIVE_POINTS) throw new RangeError(`a drive path has 1–${MAX_DRIVE_POINTS} points, got ${path.length}`);
  for (const p of path) if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) throw new RangeError('a drive path point is not finite');
  return { path: path.map((p) => ({ x: p.x, z: p.z })), next: 0, heading: ((yawWire & (WIRE_ANGLE_UNITS - 1)) * ANGLE_UNITS) / WIRE_ANGLE_UNITS, phase: 'driving' };
}

/** The hull's heading as a wire yaw (1024 to a turn), for the entity's replicated facing. */
export function driveYawWire(drive: VehicleDrive): number {
  return Math.round((drive.heading * WIRE_ANGLE_UNITS) / ANGLE_UNITS) & (WIRE_ANGLE_UNITS - 1);
}

/** The unit vector the hull points along: (sin, cos) of its heading, as a yaw's forward everywhere else. */
export function driveForward(drive: VehicleDrive): DrivePoint {
  const a = Math.round(drive.heading) & ANGLE_MASK;
  return { x: sin(a as BinAngle), z: cos(a as BinAngle) };
}

/** A heading within this of the waypoint's bearing (sin of the angle) drives forward; wider than this it turns first. */
const DRIVE_ALIGNED = 0.35;
/** Inside this (sin of the angle) it is pointing at the waypoint and stops turning, so it does not hunt about it. */
const DEADBAND = 0.02;

/**
 * One tick of driving. Returns the new place; mutates `drive` (its heading, waypoint and phase).
 * `canMove(x, z, forward)` says whether the hull may stand there facing that way; false holds the tank in place
 * (`blocked`) and it tries again next tick.
 */
export function stepDrive(
  at: DrivePoint,
  drive: VehicleDrive,
  config: DriveConfig,
  dt: number,
  canMove: (x: number, z: number, forward: DrivePoint) => boolean,
): DrivePoint {
  if (drive.next >= drive.path.length) {
    drive.phase = 'arrived';
    return at;
  }
  // Reach the waypoint (and any the hull has already passed) before steering for the next.
  while (drive.next < drive.path.length) {
    const p = drive.path[drive.next]!;
    if ((p.x - at.x) ** 2 + (p.z - at.z) ** 2 > config.arriveM * config.arriveM) break;
    drive.next++;
  }
  if (drive.next >= drive.path.length) {
    drive.phase = 'arrived';
    return at;
  }
  const target = drive.path[drive.next]!;
  const dx = target.x - at.x;
  const dz = target.z - at.z;
  const distance = Math.sqrt(dx * dx + dz * dz);
  const wantX = dx / distance;
  const wantZ = dz / distance;

  // Turn toward the waypoint by at most this tick's share of the turn rate, the short way round.
  const f = driveForward(drive);
  // Yaw grows from +Z toward +X, so the heading turns up when the waypoint is on that side: cross < 0.
  const cross = f.x * wantZ - f.z * wantX;
  const dot = f.x * wantX + f.z * wantZ;
  const step = (config.turnDegPerSec / 360) * ANGLE_UNITS * dt;
  if (Math.abs(cross) > DEADBAND || dot < 0) {
    const up = cross < 0 || (cross === 0 && dot < 0);
    drive.heading = (drive.heading + (up ? step : -step) + ANGLE_UNITS) % ANGLE_UNITS;
  }

  // Forward only, and only once it points near enough at the waypoint: a tank pivots on the spot, it does not reverse.
  const aligned = driveForward(drive);
  const ahead = aligned.x * wantX + aligned.z * wantZ > 0 && Math.abs(aligned.x * wantZ - aligned.z * wantX) < DRIVE_ALIGNED;
  if (!ahead) {
    drive.phase = 'driving';
    return at;
  }
  const go = Math.min(config.speedMps * dt, distance);
  const nx = at.x + aligned.x * go;
  const nz = at.z + aligned.z * go;
  if (!canMove(nx, nz, aligned)) {
    drive.phase = 'blocked';
    return at;
  }
  drive.phase = 'driving';
  return { x: nx, z: nz };
}
