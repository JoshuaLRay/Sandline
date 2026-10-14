import { beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, blockedAt, getEnemy, rayWorld, supportUnder, type World, type WorldBox,
} from '@sandline/shared';
import { buildDepotWorld } from './qalatDepot.ts';
import { insertionObservers, verifyInsertionScreening } from './insertionScreening.ts';
import { buildRoadSupportWorld, tankReturnRoute } from './qalatRoadSupports.ts';
import { certifyTankRoute, measureTankTravel } from './qalatTankSweep.ts';
import { convexHull } from './roadSightLines.ts';
import { inConvex } from './planStrata.ts';

type Solid = Pick<WorldBox, 'minX' | 'maxX' | 'minY' | 'maxY' | 'minZ' | 'maxZ'>;
const EPS = 1e-7;
const solid = (minX: number, maxX: number, minZ: number, maxZ: number, minY: number, maxY: number): Solid =>
  ({ minX, maxX, minZ, maxZ, minY, maxY });
const overlaps = (a: Solid, b: Solid) => a.maxX > b.minX + EPS && a.minX < b.maxX - EPS
  && a.maxY > b.minY + EPS && a.minY < b.maxY - EPS && a.maxZ > b.minZ + EPS && a.minZ < b.maxZ - EPS;
// Exact difference of closed rectangular volumes; zero-thickness contacts
// cannot hide a deleted layer of earth beside or above a stair aperture.
function subtract(a: Solid, cut: Solid): Solid[] {
  if (!overlaps(a, cut)) return [a];
  const x0 = Math.max(a.minX, cut.minX), x1 = Math.min(a.maxX, cut.maxX);
  const y0 = Math.max(a.minY, cut.minY), y1 = Math.min(a.maxY, cut.maxY);
  const z0 = Math.max(a.minZ, cut.minZ), z1 = Math.min(a.maxZ, cut.maxZ);
  return [solid(a.minX, x0, a.minZ, a.maxZ, a.minY, a.maxY), solid(x1, a.maxX, a.minZ, a.maxZ, a.minY, a.maxY),
    solid(x0, x1, a.minZ, z0, a.minY, a.maxY), solid(x0, x1, z1, a.maxZ, a.minY, a.maxY),
    solid(x0, x1, z0, z1, a.minY, y0), solid(x0, x1, z0, z1, y1, a.maxY)]
    .filter((p) => p.maxX - p.minX > EPS && p.maxY - p.minY > EPS && p.maxZ - p.minZ > EPS);
}

// Independent §7.2 clear apertures, never read from depotStairFloors or the
// authoring JSON. All four flight profiles include their exact 2 m rests.
const apertures: Solid[] = [solid(-14, 10, 58, 78, 8, 12), solid(10, 12, 66, 70, 8, 11.2),
  solid(4, 8, 94, 98, 0, 3.2), solid(-4, 10, 82, 90, 4, 7.2), solid(-10, 4, 382, 390, 4, 7.2),
  solid(4, 12, 370, 378, 8, Infinity), solid(3.4, 4, 373 + 1 / 3, 377 + 1 / 3, 8, 11.2)];
// The broad middle landings keep 4 m turns around each unbroken cheek tip;
// their extra depth does not authorize another cut at any other elevation.
const RISERS = [.4, .8, 1.2, 1.6, 2, 2.4, 2.8, 3.2, 3.6, 4, 6, 6.4, 6.8, 7.2, 7.6, 8, 8.4, 8.8, 9.2, 9.6];
for (const [x, z, y, dz, dy] of [[-2, 76, 8, 1, -1], [8, 86, 4, 1, -1], [-8, 376, 0, 1, 1], [2, 386, 4, -1, 1]]) {
  const cuts = [0, ...RISERS, 10];
  for (let i = 1; i < cuts.length; i++) {
    const start = cuts[i - 1]!, end = cuts[i]!;
    const floor = y! + dy! * .2 * RISERS.filter((at) => at <= (start + end) / 2).length;
    apertures.push(solid(x! - 2, x! + 2, Math.min(z! + dz! * start, z! + dz! * end),
      Math.max(z! + dz! * start, z! + dz! * end), floor, floor + 3.2));
  }
}
// The one diagonal doorway locally bevels from a perpendicular 4 m ribbon
// to B10's west face. Its row skin may expand only by the 5 cm construction
// tolerance; this exception ends at y11.2 and never opens the sky above it.
const side = 2 / Math.sqrt(10);
const mouth = convexHull([{ x: 2 - side, z: 376 - 3 * side }, { x: 2 + side, z: 376 + 3 * side },
  { x: 4, z: 375 + 1 / 3 - 2 }, { x: 4, z: 375 + 1 / 3 + 2 }]
  .flatMap((p) => [-.05, .05].flatMap((x) => [-.05, .05].map((z) => ({ x: p.x + x, z: p.z + z })))));
const insideMouth = (p: Solid) => p.minY >= 8 - EPS && p.maxY <= 11.2 + EPS
  && [p.minX, p.maxX].every((x) => [p.minZ, p.maxZ].every((z) => inConvex(mouth, { x, z })));

let world: World;
beforeAll(() => { world = buildDepotWorld(); }, 120_000);

describe('U-171 covered depot retains the completed surface in its actual scene', () => {
  it('preserves every original surface solid outside the independent exact 3D room/stair apertures', () => {
    const original = buildRoadSupportWorld();
    // Only original geology intersects the named new room/stair voids. This
    // deliberately admits no broad plan-area exception for other construction.
    const untouched = original.boxes.filter((b) => b.id !== 'insertion-foundation'
      && !/^rock-\d+$/.test(b.id) && !/^road-rock-(skin|mass)-\d+$/.test(b.id));
    const byId = new Map(world.boxes.map((b) => [b.id, b]));
    expect(untouched.length).toBeGreaterThan(10_000);
    expect(untouched.map((b) => byId.get(b.id))).toEqual(untouched);
    const descendants = new Map<string, WorldBox[]>();
    for (const b of world.boxes) {
      const source = b.id.split('-depot-cut-')[0]!;
      const list = descendants.get(source) ?? []; list.push(b); descendants.set(source, list);
    }
    const violations: { id: string; loss: Solid[] }[] = [];
    let changed = 0;
    for (const old of original.boxes) {
      const retained = byId.get(old.id);
      if (retained && ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ'].every((key) =>
        retained[key as keyof Solid] === old[key as keyof Solid])) continue;
      changed++;
      let loss: Solid[] = [old];
      for (const b of descendants.get(old.id) ?? []) loss = loss.flatMap((p) => subtract(p, b));
      for (const aperture of apertures.filter((a) => overlaps(a, old))) loss = loss.flatMap((p) => subtract(p, aperture));
      loss = loss.filter((p) => !insideMouth(p));
      if (loss.length) violations.push({ id: old.id, loss });
    }
    expect(changed, 'the actual original geology must be carved for both endpoint systems').toBeGreaterThan(100);
    expect(violations.slice(0, 5), 'deleted original earth outside named 3D apertures').toEqual([]);
    console.log('U-171 exact surface preservation', JSON.stringify({ originalSolids: original.boxes.length,
      unchangedConstruction: untouched.length, carvedOriginalSolids: changed, illegalLosses: violations.length }));
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
