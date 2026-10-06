import { describe, expect, it } from 'vitest';
import { boxFrom } from './world.ts';
import { getEnemy } from './enemies.ts';
import { validateVehiclePath, vehicleSupport } from './vehiclePlacement.ts';
import { createDrive, stepDrive, withdrawDrive } from './vehicle.ts';

const vehicle = getEnemy('tank').vehicle!;
const deck = boxFrom(
  { id: 'road', x: 0, y: 5.5, z: 20, w: 20, d: 80, h: 2.5 },
  'cover',
);
const bridge = boxFrom(
  { id: 'bridge', x: 0, y: 12, z: 20, w: 20, d: 8, h: 4 },
  'cover',
);
const start = { x: 0, y: 8, z: 0 };
const forward = { x: 0, z: 1 };

describe('supported 3D vehicle placement (U-110)', () => {
  it('uses the road underneath an overhead bridge, including the turret clearance', () => {
    expect(
      vehicleSupport({ ...start, z: 20 }, forward, vehicle, [deck, bridge]),
    ).toBe(8);
    expect(() =>
      validateVehiclePath(
        start,
        [{ x: 0, y: 8, z: 40 }],
        vehicle,
        [deck, bridge],
        'tank',
      ),
    ).not.toThrow();
    expect(
      vehicleSupport({ ...start, z: 20 }, forward, vehicle, [
        deck,
        { ...bridge, minY: 11 },
      ]),
    ).toBeNull();
  });

  it('rejects unsupported heights, track overhang, vertical-only paths and obstacles between waypoints', () => {
    for (const at of [
      { ...start, y: 7 },
      { ...start, y: 16 },
      { ...start, x: 9 },
    ])
      expect(vehicleSupport(at, forward, vehicle, [deck, bridge])).toBeNull();
    expect(() =>
      validateVehiclePath(
        start,
        [{ ...start, y: 16 }],
        vehicle,
        [deck, bridge],
        'tank',
      ),
    ).toThrow(/vertical-only/);
    const wall = boxFrom(
      { id: 'wall', x: 0, y: 8, z: 20, w: 12, d: 1, h: 4 },
      'cover',
    );
    expect(() =>
      validateVehiclePath(
        start,
        [{ x: 0, y: 8, z: 40 }],
        vehicle,
        [deck, wall],
        'tank',
      ),
    ).toThrow(/clearance/);
    expect(() =>
      validateVehiclePath(
        start,
        [{ x: 0, y: NaN, z: 40 }],
        vehicle,
        [deck],
        'tank',
      ),
    ).toThrow(/wire bounds/);
  });

  it('interpolates waypoint height, inherits omissions, preserves it on withdrawal and consults clearance while turning', () => {
    const drive = createDrive(
      [
        { x: 0, y: 8, z: 16 },
        { x: 0, z: 30 },
      ],
      0,
      { x: 0, y: 0, z: 0 },
    );
    let at = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 150; i++)
      at = stepDrive(
        at,
        drive,
        { speedMps: 2, turnDegPerSec: 30, arriveM: 0.05 },
        1 / 30,
        () => true,
      ) as typeof at;
    expect(at.y).toBeCloseTo(at.z / 2, 6);
    expect(drive.path[1]!.y).toBe(8);
    drive.next = 2;
    withdrawDrive(drive, { x: 0, y: 8, z: 30 });
    expect(drive.path.map((p) => p.y)).toEqual([8, 8, 0]);
    const turn = createDrive([{ x: 20, z: 0 }], 0, start);
    const heading = turn.heading;
    expect(stepDrive(start, turn, vehicle, 1 / 30, () => false)).toEqual(start);
    expect(turn).toMatchObject({ phase: 'blocked', heading });
  });
});
