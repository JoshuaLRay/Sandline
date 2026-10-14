import { beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, blockedAt, getEnemy, rayWorld, supportUnder, type World,
} from '@sandline/shared';
import { buildDepotWorld } from './qalatDepot.ts';
import { insertionObservers, verifyInsertionScreening } from './insertionScreening.ts';
import { buildRoadSupportWorld, tankReturnRoute } from './qalatRoadSupports.ts';
import { certifyTankRoute, measureTankTravel } from './qalatTankSweep.ts';

let world: World;
beforeAll(() => { world = buildDepotWorld(); }, 120_000);

describe('U-171 covered depot retains the completed surface in its actual scene', () => {
  it('retains every surface support, crossing, screen, bridge and furnished ridge box exactly', () => {
    const original = buildRoadSupportWorld();
    // Only original geology intersects the named new room/stair voids. This
    // deliberately admits no broad plan-area exception for other construction.
    const untouched = original.boxes.filter((b) => b.id !== 'insertion-foundation'
      && !/^rock-\d+$/.test(b.id) && !/^road-rock-(skin|mass)-\d+$/.test(b.id));
    const byId = new Map(world.boxes.map((b) => [b.id, b]));
    expect(untouched.length).toBeGreaterThan(10_000);
    expect(untouched.map((b) => byId.get(b.id))).toEqual(untouched);
  }, 120_000);

  it('keeps GEO-07 spawn-body screening against guards, patrols, reserves, high observers and tank muzzles', async () => {
    const evidence = await verifyInsertionScreening(world);
    expect(evidence.map((e) => e.observers)).toEqual(insertionObservers().map((g) => g.points.length));
    expect(evidence.every((e) => e.targets > 10_000 && e.sampleStepM === 1)).toBe(true);
    expect(evidence.reduce((rays, e) => rays + e.rays, 0)).toBeGreaterThan(10_000_000);
    console.log('U-171 retained actual-scene GEO-07', JSON.stringify(evidence));
  }, 240_000);

  it('certifies the whole rotating tank sweep, track support and ordinary real-controller return', () => {
    const route = tankReturnRoute();
    expect(route[0]).toEqual({ id: 'X0', x: 96, y: 8, z: 444 });
    expect(route.at(-1)).toEqual({ id: 'A1', x: 32, y: 8, z: 98 });
    const authored = certifyTankRoute(world.boxes, route);
    expect(authored).toMatchObject({ allHullAndTurretYaws: true, endpointsAndStops: true, floorY: 8 });
    expect(authored.lengthM).toBeGreaterThan(500);
    const travel = measureTankTravel(world.boxes, route);
    expect(travel.blockedSeconds).toBe(0);
    expect(travel.endpoint.y).toBe(8);
    expect(Math.hypot(travel.endpoint.x - 32, travel.endpoint.z - 98)).toBeLessThanOrEqual(getEnemy('tank').vehicle!.arriveM);
    const driven = certifyTankRoute(world.boxes, travel.trace);
    expect(driven).toMatchObject({ allHullAndTurretYaws: true, endpointsAndStops: true, floorY: 8 });
    console.log('U-171 retained actual-scene GEO-09', JSON.stringify({ authored, driven,
      seconds: travel.seconds, blockedSeconds: travel.blockedSeconds, endpoint: travel.endpoint }));
  }, 120_000);

  it('preserves independent road/ridge/C12 nodes, B6 roof isolation and the unbuilt outpost closures', () => {
    // Independent approved surface coordinates: new depot wells cannot move
    // any existing route, flatten a crossing or open another gate into U-116.
    const nodes = [
      [32, 8, 64], [32, 8, 98], [12, 8, 128], [-37, 8, 142], [-28, 8, 210],
      [26, 8, 232], [30, 8, 270], [-18, 8, 302], [16, 8, 332], [32, 8, 350], [32, 8, 356],
      [62, 8, 68], [78, 14, 96], [64, 20, 128], [80, 26, 168], [94, 30, 210],
      [86, 30, 248], [72, 26, 286], [70, 20, 322], [70, 16, 336], [70, 12, 350], [56, 8, 370],
      [28, 8, 134], [40, 12, 140], [54, 16, 140], [40, 8, 218], [62, 14, 216], [78, 20, 224], [66, 24, 244],
    ];
    for (const [x, y, z] of nodes) {
      expect(supportUnder(x!, z!, DEFAULT_MOVE_CONFIG.radius, y! + .05, world.boxes, 0), `${x}/${y}/${z} support`).toBeCloseTo(y!, 8);
      expect(blockedAt(x!, z!, DEFAULT_MOVE_CONFIG.radius, y!, 0, DEFAULT_MOVE_CONFIG.height, world.boxes),
        `${x}/${y}/${z} standing body`).toBe(false);
    }
    const roof = rayWorld({ origin: { x: 30, y: 1.6, z: 270 }, direction: { x: 0, y: 1, z: 0 }, maxDistance: 10 }, world.boxes);
    expect(roof?.distance).toBeCloseTo(3.9, 8);
    expect(supportUnder(30, 270, DEFAULT_MOVE_CONFIG.radius, .05, world.boxes, -1)).toBe(0);
    expect(world.boxes.find((b) => b.id === 'ridge-bridge-deck')).toMatchObject({
      minX: 66, maxX: 74, minZ: 330, maxZ: 342, minY: 14, maxY: 16,
    });
    expect(world.boxes.find((b) => b.id === 'ridge-cap-east-gate')).toMatchObject({
      minX: 52, maxX: 60, minZ: 374, maxZ: 374.6, minY: 5.5, maxY: 10.2,
    });
    for (const [x, z] of [[32, 356.8], [56, 374]])
      expect(blockedAt(x!, z!, DEFAULT_MOVE_CONFIG.radius, 8, 0, DEFAULT_MOVE_CONFIG.height, world.boxes),
        `${x}/${z} outpost remains closed`).toBe(true);
    expect(world.boxes.some((b) => b.id.startsWith('road-cap-south-gate-'))).toBe(true);
  });
});
