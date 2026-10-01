/**
 * U-067: a tank drives its path at the set speed, turns at a limited rate, never reverses, stops at the end, and
 * waits where something is in the way. Constants are declared here, not read from the data, so tuning the row can
 * never quietly change what this proves.
 */
import { describe, expect, it } from 'vitest';
import { WIRE_ANGLE_UNITS } from '../math/angles.ts';
import { type DriveConfig, type DrivePoint, MAX_DRIVE_POINTS, type VehicleDrive, createDrive, driveYawWire, stepDrive, withdrawDrive } from './vehicle.ts';

const DT = 1 / 30;
const CONFIG: DriveConfig = { speedMps: 1.6, turnDegPerSec: 30, arriveM: 1.5 };
const open = () => true;

/** Drive until `stop` or `max` ticks; the places it stood. */
function run(start: DrivePoint, drive: VehicleDrive, max: number, canMove: (x: number, z: number) => boolean = open, stop: () => boolean = () => drive.phase === 'arrived'): DrivePoint[] {
  const trail: DrivePoint[] = [start];
  let at = start;
  for (let i = 0; i < max && !stop(); i++) {
    at = stepDrive(at, drive, CONFIG, DT, canMove);
    trail.push(at);
  }
  return trail;
}

describe('a tank\'s drive (U-067)', () => {
  it('needs a path of a few points, all finite', () => {
    expect(() => createDrive([], 0)).toThrow(/points/);
    expect(() => createDrive(Array.from({ length: MAX_DRIVE_POINTS + 1 }, () => ({ x: 0, z: 0 })), 0)).toThrow(/points/);
    expect(() => createDrive([{ x: Number.NaN, z: 0 }], 0)).toThrow(/finite/);
    expect(driveYawWire(createDrive([{ x: 0, z: 9 }], 300))).toBe(300);
  });

  it('drives straight down its path at the set speed and stops at the end', () => {
    const drive = createDrive([{ x: 0, z: 30 }], 0);
    const trail = run({ x: 0, z: 0 }, drive, 2000);
    const at = trail.at(-1)!;
    expect(drive.phase).toBe('arrived');
    expect(Math.sqrt((at.x) ** 2 + (at.z - 30) ** 2)).toBeLessThanOrEqual(CONFIG.arriveM + 0.06);
    // A steady 1.6 m/s while it goes.
    const step = Math.sqrt((trail[11]!.x - trail[10]!.x) ** 2 + (trail[11]!.z - trail[10]!.z) ** 2);
    expect(step).toBeCloseTo(CONFIG.speedMps * DT, 6);
    // Standing at the end, it stays there.
    expect(run(at, drive, 50, open, () => false).every((p) => p.x === at.x && p.z === at.z)).toBe(true);
  });

  it('turns at a limited rate, in place, and then goes; it never reverses', () => {
    // Facing +z, the road goes off to the right (+x): a quarter turn at 30 degrees a second.
    const drive = createDrive([{ x: 40, z: 0 }], 0);
    const trail = run({ x: 0, z: 0 }, drive, 1200);
    // It pivoted before moving: the first positions are the start.
    const moved = trail.findIndex((p) => p.x !== 0 || p.z !== 0);
    expect(moved).toBeGreaterThan(0.4 * 30);
    // Never a step backwards along where it faced (-z) nor back toward where it had been.
    for (let i = 1; i < trail.length; i++) {
      expect(trail[i]!.x).toBeGreaterThanOrEqual(trail[i - 1]!.x - 1e-9);
      expect(trail[i]!.z).toBeGreaterThanOrEqual(-0.5);
    }
    expect(drive.phase).toBe('arrived');
  });

  it('turns no faster than its rate', () => {
    const drive = createDrive([{ x: 40, z: 0 }], 0);
    let at: DrivePoint = { x: 0, z: 0 };
    let last = drive.heading;
    const limit = (CONFIG.turnDegPerSec / 360) * 4096 * DT + 1e-9;
    for (let i = 0; i < 200; i++) {
      at = stepDrive(at, drive, CONFIG, DT, open);
      const turn = Math.min(Math.abs(drive.heading - last), 4096 - Math.abs(drive.heading - last));
      expect(turn).toBeLessThanOrEqual(limit);
      last = drive.heading;
    }
    // A quarter turn right: 1024 table units, 256 wire units.
    expect(driveYawWire(drive)).toBeGreaterThan(WIRE_ANGLE_UNITS * 0.2);
    expect(driveYawWire(drive)).toBeLessThan(WIRE_ANGLE_UNITS * 0.3);
  });

  it('turns the short way for a waypoint behind it, and does not back up to it', () => {
    const drive = createDrive([{ x: 0, z: -40 }], 0);
    const trail = run({ x: 0, z: 0 }, drive, 900);
    for (const p of trail.slice(0, 60)) expect(p.z).toBeGreaterThanOrEqual(-0.01);
    expect(trail.at(-1)!.z).toBeLessThan(-30);
  });

  it('follows a path through its waypoints in order', () => {
    const drive = createDrive([{ x: 0, z: 10 }, { x: 0, z: 20 }, { x: 10, z: 20 }], 0);
    const trail = run({ x: 0, z: 0 }, drive, 3000);
    expect(drive.phase).toBe('arrived');
    expect(drive.next).toBe(3);
    const end = trail.at(-1)!;
    expect(Math.sqrt((end.x - 10) ** 2 + (end.z - 20) ** 2)).toBeLessThanOrEqual(CONFIG.arriveM + 0.06);
    expect(trail.some((p) => Math.abs(p.z - 20) < 1.6 && p.x < 1)).toBe(true);
  });

  it('waits where the way is blocked and goes on when it clears', () => {
    const drive = createDrive([{ x: 0, z: 30 }], 0);
    let wall = true;
    const canMove = (_x: number, z: number) => !(wall && z > 10);
    const held = run({ x: 0, z: 0 }, drive, 600, canMove, () => false);
    const stuck = held.at(-1)!;
    expect(drive.phase).toBe('blocked');
    expect(stuck.z).toBeLessThanOrEqual(10);
    expect(stuck.z).toBeGreaterThan(9);
    // Still there a second later.
    const later = run(stuck, drive, 30, canMove, () => false).at(-1)!;
    expect(later).toEqual(stuck);
    wall = false;
    const after = run(later, drive, 2000, canMove);
    expect(drive.phase).toBe('arrived');
    expect(after.at(-1)!.z).toBeGreaterThan(25);
  });

  it('is the same drive every time', () => {
    const a = run({ x: 0, z: 0 }, createDrive([{ x: 12, z: 18 }, { x: -6, z: 40 }], 100), 3000);
    const b = run({ x: 0, z: 0 }, createDrive([{ x: 12, z: 18 }, { x: -6, z: 40 }], 100), 3000);
    expect(b).toEqual(a);
  });
});

describe('a tank withdrawing (U-069)', () => {
  const ROAD = [{ x: 0, z: 10 }, { x: 0, z: 20 }, { x: 10, z: 20 }];

  it('goes back by the waypoints it passed, last first, then to where it started', () => {
    const drive = createDrive(ROAD, 0, { x: 0, z: -5 });
    const trail = run({ x: 0, z: -5 }, drive, 3000, open, () => drive.next >= 2);
    const at = trail.at(-1)!;
    withdrawDrive(drive);
    expect(drive.withdrawing).toBe(true);
    expect(drive.path).toEqual([{ x: 0, z: 20 }, { x: 0, z: 10 }, { x: 0, z: -5 }]);
    run(at, drive, 6000);
    expect(drive.phase).toBe('arrived');
  });

  it('a tank that has not moved leaves by its start alone, and one with no start is simply done', () => {
    const fresh = createDrive(ROAD, 0, { x: 3, z: 4 });
    withdrawDrive(fresh);
    expect(fresh.path).toEqual([{ x: 3, z: 4 }]);
    const none = createDrive(ROAD, 0);
    withdrawDrive(none);
    expect(none.path).toEqual([]);
    expect(none.phase).toBe('arrived');
  });

  it('is idempotent: a second call does not turn it round again', () => {
    const drive = createDrive(ROAD, 0, { x: 0, z: -5 });
    drive.next = 3;
    withdrawDrive(drive);
    const once = JSON.stringify(drive);
    withdrawDrive(drive);
    expect(JSON.stringify(drive)).toBe(once);
    expect(drive.path).toHaveLength(4);
  });
});
