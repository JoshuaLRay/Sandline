import { describe, expect, it } from 'vitest';
import { boxFrom, getEnemy } from '@sandline/shared';
import { buildRoadSupportWorld, tankReturnRoute } from './qalatRoadSupports.ts';
import { certifyTankRoute, measureTankTravel, TANK_BODY_HEIGHT_M, TANK_SWEEP_RADIUS_M } from './qalatTankSweep.ts';

const road = boxFrom({ id: 'road', x: 0, y: 5.5, z: 5, w: 40, h: 2.5, d: 50 }, 'cover');
const route = [{ x: 0, y: 8, z: 0 }, { x: 0, y: 8, z: 10 }];

describe('U-151 continuous full rotating tank construction certificate', () => {
  it('encloses the real shared capsules, every yaw and the larger controller track corners', () => {
    const proof = certifyTankRoute([road], route);
    expect(proof.capsuleRadiusM).toBeCloseTo(2.9, 8);
    expect(TANK_SWEEP_RADIUS_M).toBeGreaterThan(Math.hypot(3, 1.4) - 1e-8);
    expect(TANK_BODY_HEIGHT_M).toBeCloseTo(3.2, 8);
    expect(proof).toMatchObject({ allHullAndTurretYaws: true, endpointsAndStops: true, lengthM: 10, floorY: 8 });
  });

  it('detects a needle obstacle between route partitions, including a side-facing hull at a stop', () => {
    const needle = boxFrom({ id: 'needle', x: 2.8, y: 8, z: 5.123456, w: .00001, h: .01, d: .00001 }, 'cover');
    expect(() => certifyTankRoute([road, needle], route)).toThrow(/needle/);
    expect(() => certifyTankRoute([road, { ...needle, minZ: -.00001, maxZ: .00001 }], route)).toThrow(/needle/);
  });

  it('checks full track support across every slab boundary, including submillimetre floor cuts', () => {
    const gap = 6.123456;
    expect(() => certifyTankRoute([{ ...road, maxZ: gap }, { ...road, minZ: gap + .00001 }], route)).toThrow(/unsupported/);
    expect(() => certifyTankRoute([{ ...road, maxX: 3 }], route)).toThrow(/unsupported/);
    expect(() => certifyTankRoute([road], route.map((p) => ({ ...p, y: 0 })))).toThrow(/y8/);
  });

  it('tests turret clearance beneath the exact reserved bridge without constructing it', () => {
    const bridge = boxFrom({ id: 'future-bridge', x: 70, y: 14, z: 336, w: 8, h: 2, d: 12 }, 'cover');
    const floor = { ...road, minX: 50, maxX: 90, minZ: 310, maxZ: 360 };
    const path = [{ x: 84, y: 8, z: 338 }, { x: 54, y: 8, z: 334 }];
    expect(certifyTankRoute([floor, bridge], path).floorY).toBe(8);
    expect(() => certifyTankRoute([floor, { ...bridge, minY: 11.19 }], path)).toThrow(/turret/);
  });

  it('certifies all generated X0→A1 intervals and the real controller trajectory, including ten seconds of target contact', () => {
    const world = buildRoadSupportWorld(), path = tankReturnRoute();
    expect(path[0]).toEqual({ id: 'X0', x: 96, y: 8, z: 444 });
    expect(path.at(-1)).toEqual({ id: 'A1', x: 32, y: 8, z: 98 });
    const bridge = boxFrom({ id: 'future-bridge', x: 70, y: 14, z: 336, w: 8, h: 2, d: 12 }, 'cover');
    expect(certifyTankRoute([...world.boxes, bridge], path).lengthM).toBeGreaterThan(500);
    const free = measureTankTravel(world.boxes, path), contact = measureTankTravel(world.boxes, path, 10);
    expect(free.blockedSeconds).toBe(0);
    expect(contact.blockedSeconds).toBeCloseTo(10, 5);
    expect(contact.seconds - free.seconds).toBeCloseTo(10, 5);
    expect(contact.aimingTicks).toBeGreaterThan(0);
    expect(contact.firedShells).toBeGreaterThan(0);
    for (const result of [free, contact]) {
      expect(certifyTankRoute([...world.boxes, bridge], result.trace).allHullAndTurretYaws).toBe(true);
      expect(Math.hypot(result.endpoint.x - 32, result.endpoint.z - 98)).toBeLessThanOrEqual(getEnemy('tank').vehicle!.arriveM);
      expect(result.endpoint.y).toBe(8);
    }
    expect(getEnemy('tank').vehicle).toMatchObject({ speedMps: 1.6, turnDegPerSec: 30,
      cannon: { tellSeconds: 1, intervalSeconds: 6 }, fireMaxSpeedMps: .5 });
  }, 120_000);
});
