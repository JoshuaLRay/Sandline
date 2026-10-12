import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, DEFAULT_MUZZLE_RIG, ENEMIES, cos, rayWorld, sin, wireToTable,
} from '@sandline/shared';
import { bodyParts, vehicleHitbox } from '../../../server/src/net/lagComp.ts';
import { between, insertionBodySamples, rayOccluded, sampleRoute } from './insertionScreening.ts';
import { INSERTION } from './qalatInsertion.ts';
import { ROAD_COMBAT } from './qalatRoadCombat.ts';
import { ROAD_SUPPORTS, buildRoadSupportWorld, tankReturnRoute } from './qalatRoadSupports.ts';
import { TANK_INGRESS } from './qalatTankIngress.ts';

type Point = { x: number; y: number; z: number };
const tank = ENEMIES['tank']!.vehicle!;
const world = buildRoadSupportWorld();
const blocked = rayOccluded(world.boxes.filter((box) => box.maxY > ROAD_SUPPORTS.floorY));
const yaws = Array.from({ length: 16 }, (_, i) => i * 64);
const heights = [...new Set([.05, DEFAULT_MUZZLE_RIG.proneEyeHeight, DEFAULT_MOVE_CONFIG.proneHeight,
  DEFAULT_MUZZLE_RIG.crouchEyeHeight, DEFAULT_MOVE_CONFIG.crouchHeight,
  DEFAULT_MUZZLE_RIG.eyeHeight, DEFAULT_MOVE_CONFIG.height])];

/** The same shared yaw table and turret-point transform used by Session. */
function muzzles(at: Point): Point[] {
  return yaws.flatMap((yaw) => {
    const angle = wireToTable(yaw), fx = sin(angle), fz = cos(angle);
    return [tank.cannon.muzzle, tank.machineGun.muzzle].map(([right, up, forward]) => ({
      x: at.x - right * fz + forward * fx, y: at.y + up,
      z: at.z + right * fx + forward * fz,
    }));
  });
}

/** Actual production hull/turret capsule surface samples, including their
 * highest/lowest, side, nose and rear extremes in every sampled orientation.
 * Finite 3D ray evidence; the continuous body-clearance proof is separate.
 */
function body(at: Point): Point[] {
  const axes = [{ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
    { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }];
  return yaws.flatMap((yaw) => bodyParts(vehicleHitbox(tank), 'standing', at, yaw)
    .flatMap((part) => [part.a, part.b].flatMap((end) => axes.map((axis) => ({
      x: end.x + axis.x * part.radius, y: end.y + axis.y * part.radius,
      z: end.z + axis.z * part.radius,
    }))))).filter((point) => point.y > ROAD_SUPPORTS.floorY);
}

describe('U-151 service ingress screening', () => {
  it('retains the high T-E screening mass beyond closed-set contacts with the narrow X5 fan', () => {
    // These exterior points share a row with the narrow fan but lie well east
    // of it. Capping the whole touching span previously lowered both to about
    // y20 and exposed the low side of X2 from V3.
    for (const point of [{ x: 76, z: 307 }, { x: 80, z: 314 }]) {
      const mass = world.boxes.filter((box) => box.id.startsWith('road-rock-mass-') &&
        box.minX <= point.x && box.maxX >= point.x && box.minZ <= point.z && box.maxZ >= point.z);
      expect(Math.max(...mass.map((box) => box.maxY))).toBe(TANK_INGRESS.eastRidge.topY);
    }
    const ray = between({ x: 66, y: 26 + DEFAULT_MUZZLE_RIG.eyeHeight, z: 286 },
      { x: 113.3, y: 9, z: 384.4 });
    expect(rayWorld(ray, world.boxes)).not.toBeNull();
    expect(blocked(ray)).toBe(true);
  });

  it('screens the X0 rotating body and both muzzles from V3 and the entire future outpost footprint', async () => {
    const targets = [...body(TANK_INGRESS.spine[0]!), ...muzzles(TANK_INGRESS.spine[0]!)];
    const observers: Point[] = heights.map((height) => ({ x: 66, y: 26 + height, z: 286 }));
    // Future outpost walkable envelope, rather than only a convenient guard
    // socket. No unbuilt outpost walls/roof contribute to this screening.
    for (let x = 8; x <= 56; x++) for (let z = 356; z <= 412; z++) {
      for (const height of heights) observers.push({ x, y: 8 + height, z });
    }
    for (let x = 24; x <= 40; x++) for (let z = 434; z <= 448; z++) {
      for (const height of heights) observers.push({ x, y: 8 + height, z });
    }
    // Certify protection with only existing solids east of the future outpost.
    // Temporary rock occupying unbuilt rooms cannot provide a false pass.
    const outsideOutpost = rayOccluded(world.boxes.filter((box) => box.maxX > 57 && box.maxY > 8)
      .map((box) => ({ ...box, minX: Math.max(57, box.minX) })));
    let rays = 0;
    for (const [index, from] of observers.entries()) {
      const screened = index < heights.length ? blocked : outsideOutpost;
      for (const to of targets) {
        rays++;
        if (!screened(between(from, to))) throw new Error(`X0 exposed ${JSON.stringify(from)} → ${JSON.stringify(to)}`);
      }
      if (index % 64 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(rays).toBeGreaterThan(1_000_000);
    expect(rayOccluded([])(between(observers[0]!, targets[0]!))).toBe(false);
    console.log('U-151 motor-pool screening', JSON.stringify({ observers: observers.length, targets: targets.length,
      rays, outpostGridM: 1, orientations: yaws.length, method: 'actual scene hull/turret/body/muzzle rays' }));
  }, 120_000);

  it('keeps the eastern X nodes hidden from V3 until X5 and exposes X5 to V3 and both forecourt firing pads', () => {
    const v3 = { x: 66, y: 26 + DEFAULT_MUZZLE_RIG.eyeHeight, z: 286 };
    const pads = ROAD_COMBAT.regroupPads.filter((pad) => ['A-C11', 'A-C12'].includes(pad.cover));
    expect(pads).toHaveLength(2);
    const eyes = [v3, ...pads.map((pad) => ({ x: pad.x, y: 8 + DEFAULT_MUZZLE_RIG.eyeHeight, z: pad.z }))];
    for (const node of TANK_INGRESS.spine.slice(0, 5)) {
      for (const to of body(node)) {
        expect(blocked(between(v3, to)), `V3 reveals ${node.id} at ${JSON.stringify(to)}`).toBe(true);
      }
    }
    const x5 = TANK_INGRESS.spine.find((node) => node.id === 'X5')!;
    for (const from of eyes) {
      expect(body(x5).some((to) => !blocked(between(from, to))), `X5 hidden from ${JSON.stringify(from)}`).toBe(true);
    }
  });

  it('retains GEO-07 against both muzzles along the complete new X0→A1 path and turning orientations', async () => {
    const route = sampleRoute(tankReturnRoute().map((node) => [node.x, node.y, node.z]));
    // Require the southern insertion landform itself to block the shot: later
    // road cover, X rock and future outpost walls cannot mask an insertion leak.
    const southern = world.boxes.filter((box) => box.minZ < 60)
      .map((box) => ({ ...box, maxZ: Math.min(60, box.maxZ) }));
    const cores = southern.filter((box) => INSERTION.rockCores.some((core) => core.id === box.id));
    const southernBlocked = rayOccluded(southern), targets = insertionBodySamples();
    let rays = 0;
    for (const [index, at] of route.entries()) {
      for (const from of muzzles(at)) for (const to of targets) {
        const ray = between(from, to); rays++;
        if (rayWorld(ray, cores) === null && !southernBlocked(ray)) {
          throw new Error(`Extended tank route exposes insertion ${JSON.stringify(from)} → ${JSON.stringify(to)}`);
        }
      }
      if (index % 8 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(route[0]).toEqual({ x: 96, y: 8, z: 444 });
    expect(route.at(-1)).toEqual({ x: 32, y: 8, z: 98 });
    expect(rays).toBeGreaterThan(10_000_000);
    console.log('U-151 extended GEO-07', JSON.stringify({ routeSamples: route.length, muzzles: 2,
      orientations: yaws.length, targets: targets.length, rays, sampleStepM: 1 }));
  }, 240_000);
});
