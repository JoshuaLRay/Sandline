import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, DEFAULT_MUZZLE_RIG, TICK_SECONDS, blockedAt, createMoveState, rayWorld,
  stepCharacter, supportUnder, type WorldBox,
} from '@sandline/shared';
import { NavMesh, completePathLength, initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { PathFollower } from '../../../server/src/ai/locomotion/followPath.ts';
import { DEFAULT_NAV_AGENT, navConfigFor, worldSolids, worldSoup } from '../nav/bake.ts';
import { bakeSolidNavMesh } from '../nav/solidBake.ts';
import { INSERTION, buildInsertionWorld, onInsertionFloor } from './qalatInsertion.ts';
import { between, insertionObservers, rayOccluded, sampleRoute } from './insertionScreening.ts';
import {
  ROAD_SUPPORTS, buildRoadSupportWorld, fightSeparation, onRoadSupportFloor,
  roadSightPieces, roadSightReport, roadSupportManifest, roadSupportPlanSvg,
} from './qalatRoadSupports.ts';
import { longestSegment } from './roadSightLines.ts';

// Independent transcription of the approved §5 coordinates with the U-159
// addendum's bent A3, A4 and A7. Sampling the authoring data alone would also
// pass if a node or a width silently moved.
const APPROVED_SPINE = [
  { id: 'A0', x: 32, y: 8, z: 64 }, { id: 'A1', x: 32, y: 8, z: 98 },
  { id: 'A2', x: 12, y: 8, z: 128 }, { id: 'A3', x: -37, y: 8, z: 142 },
  { id: 'A4', x: -28, y: 8, z: 210 }, { id: 'A5', x: 26, y: 8, z: 232 },
  { id: 'A6', x: 30, y: 8, z: 270 }, { id: 'A7', x: -18, y: 8, z: 302 },
  { id: 'A8', x: 16, y: 8, z: 332 }, { id: 'A9', x: 32, y: 8, z: 350 },
];
const SOUTH_GATE = { id: 'south-gate', x: 32, y: 8, z: 356 };
const ROAD_STOPS = [...APPROVED_SPINE, SOUTH_GATE];
const APRON_IDS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'];
type Point = { x: number; z: number };
// The straighter road U-149 built, which could not hold three separate fights.
const U149_MOVES: Record<string, Point> = { A3: { x: -4, z: 166 }, A4: { x: -4, z: 200 }, A7: { x: 8, z: 304 } };
const U149_SPINE = ROAD_STOPS.map((p) => ({ ...p, ...U149_MOVES[p.id] }));
// §2.2's bevel at the final changing tangent, where there is no large apron.
// These are the four approved 10 m shoulder endpoints at A9, in perimeter order.
const A9_BEVEL: Point[] = [
  { x: 22, z: 350 }, { x: 39.4740931868366, z: 343.3563616117008 },
  { x: 42, z: 350 }, { x: 24.5259068131634, z: 356.6436383882992 },
];
const yieldWorker = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Exact ribbon rectangles and 18 m-radius aprons, independent of the compiler. */
function approvedRoadFootprint(p: Point, margin = 0): boolean {
  if (APPROVED_SPINE.slice(1, -1).some((a) => Math.hypot(p.x - a.x, p.z - a.z) <= 18 + margin)) return true;
  if (A9_BEVEL.every((a, i) => {
    const b = A9_BEVEL[(i + 1) % A9_BEVEL.length]!, dx = b.x - a.x, dz = b.z - a.z;
    return dx * (p.z - a.z) - dz * (p.x - a.x) >= -margin * Math.hypot(dx, dz);
  })) return true;
  return ROAD_STOPS.slice(1).some((b, i) => {
    const a = ROAD_STOPS[i]!, dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    const along = ((p.x - a.x) * dx + (p.z - a.z) * dz) / length;
    const across = Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / length;
    return along >= -margin && along <= length + margin && across <= 10 + margin;
  });
}

function clearSupport(p: Point, half = .001): void {
  expect(supportUnder(p.x, p.z, half, 8.45, world.boxes, 0), `unsupported ${JSON.stringify(p)}`).toBe(8);
  expect(blockedAt(p.x, p.z, half, 8, 0, DEFAULT_MOVE_CONFIG.height, world.boxes), `blocked ${JSON.stringify(p)}`).toBe(false);
}

const world = buildRoadSupportWorld();
let nav: NavMesh;
describe('U-149 isolated A0–A9 primary road supports, bent by U-159', () => {
  beforeAll(async () => {
    await initNav();
    // Use the production solid/headroom rasterizer and the standing agent.
    // These same-height slabs need neither vault links nor a fake route mesh.
    nav = NavMesh.load(await bakeSolidNavMesh(worldSoup(world), worldSolids(world), navConfigFor(DEFAULT_NAV_AGENT)));
  }, 120_000);
  afterAll(() => nav?.destroy());

  it('preserves approved coordinates, both shoulder widths and every return-tangent apron', () => {
    expect(ROAD_SUPPORTS.spine).toEqual(ROAD_STOPS);
    expect(ROAD_SUPPORTS.ribbonWidth).toBe(20);
    expect(ROAD_SUPPORTS.carriagewayWidth).toBe(12);
    expect((ROAD_SUPPORTS.ribbonWidth - ROAD_SUPPORTS.carriagewayWidth) / 2).toBe(4);
    expect(ROAD_SUPPORTS.apronDiameter).toBe(36);
    expect(ROAD_SUPPORTS.apronNodes).toEqual(APRON_IDS);
    expect(world.squadStarts).toEqual(INSERTION.squadStarts);
    expect(nav.links()).toEqual([]);
  });

  it('supports the carriageway and full shoulders perpendicular to every road segment', async () => {
    let probes = 0;
    for (let i = 1; i < ROAD_STOPS.length; i++) {
      const a = ROAD_STOPS[i - 1]!, b = ROAD_STOPS[i]!;
      const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
      const steps = Math.ceil(length);
      for (let n = 0; n <= steps; n++) for (const offset of [-10, -8, -6, 0, 6, 8, 10]) {
        const p = { x: a.x + dx * n / steps - dz / length * offset, z: a.z + dz * n / steps + dx / length * offset };
        clearSupport(p);
        expect(onRoadSupportFloor(p, .001)).toBe(true);
        probes++;
      }
      await yieldWorker();
    }
    expect(probes).toBeGreaterThan(2200);
    // Mid-throat is outside all aprons: this distinguishes a 20 m ribbon
    // from an enlarged floor whose edge tests alone would still pass.
    for (const x of [21.9, 42.1]) {
      expect(onRoadSupportFloor({ x, z: 78 })).toBe(false);
      expect(blockedAt(x, 78, .001, 8, 0, DEFAULT_MOVE_CONFIG.height, world.boxes)).toBe(true);
    }
    expect(onRoadSupportFloor({ x: 32, z: 356 })).toBe(true);
    expect(onRoadSupportFloor({ x: 32, z: 356.1 })).toBe(false);
    expect(supportUnder(32, 356.1, .001, 8.45, world.boxes, 0)).toBe(0);
  }, 60_000);

  it('fills each entire turning apron without a hidden unsupported corner', async () => {
    for (const node of APPROVED_SPINE.slice(1, -1)) {
      for (const radius of [0, 6, 12, 17.99]) for (let degrees = 0; degrees < 360; degrees += 5) {
        const angle = degrees * Math.PI / 180;
        const p = { x: node.x + Math.cos(angle) * radius, z: node.z + Math.sin(angle) * radius };
        clearSupport(p);
        expect(onRoadSupportFloor(p)).toBe(true);
      }
      await yieldWorker();
    }
  }, 60_000);

  it('welds the final bevel and bounds structural support expansion to five centimetres', async () => {
    for (const p of [...A9_BEVEL, { x: 40.5, z: 348 }, { x: 23.5, z: 352 }]) {
      expect(approvedRoadFootprint(p, .001)).toBe(true);
      clearSupport(p);
    }
    let supports = 0;
    for (const box of world.boxes) {
      // New y5.5–8 slabs can conservatively expand the exact footprint only
      // within the recorded tolerance. Every rectangular corner is checked.
      if (box.minY !== 5.5 || box.maxY !== 8) continue;
      supports++;
      for (const x of [box.minX, box.maxX]) for (const z of [box.minZ, box.maxZ]) {
        expect(approvedRoadFootprint({ x, z }, .05), `support expansion at ${JSON.stringify({ x, z })}`).toBe(true);
      }
      if (supports % 256 === 0) await yieldWorker();
    }
    expect(supports).toBeGreaterThan(1000);
  }, 60_000);

  it('reserves the future basement volume and exact service-bridge footprint', () => {
    const northern = world.boxes.filter((b) => b.maxZ > 84);
    expect(northern.length).toBeGreaterThan(0);
    expect(northern.every((b) => b.minY >= 5.5)).toBe(true);
    expect(northern.some((b) => b.minY === 5.5 && b.maxY === 8)).toBe(true);
    const bridge = { minX: 66, maxX: 74, minZ: 330, maxZ: 342 };
    expect(world.boxes.filter((b) => b.maxX > bridge.minX && b.minX < bridge.maxX && b.maxZ > bridge.minZ && b.minZ < bridge.maxZ)).toEqual([]);
    expect(supportUnder(30, 270, .001, 5.49, world.boxes, 0)).toBe(0);
    expect(blockedAt(30, 270, .35, 0, 0, 5.49, world.boxes)).toBe(false);
  });

  for (const reverse of [false, true]) it(`walks all six starts through every S/A stop ${reverse ? 'back from the gate' : 'to the gate'}`, async () => {
    for (const spawn of INSERTION.squadStarts) {
      const stops = [spawn, ...INSERTION.spine.slice(1), ...ROAD_STOPS.slice(1)];
      if (reverse) stops.reverse();
      let state = createMoveState(stops[0]!.x, 8, stops[0]!.z);
      const follower = new PathFollower(nav, world.boxes);
      for (const goal of stops.slice(1)) {
        expect(completePathLength(nav.path(state, goal), state, goal)).not.toBeNull();
        let arrived = false;
        for (let tick = 0; tick < 1500; tick++) {
          const { input, status } = follower.step(state, { goal, pace: 'walk' }, 0);
          if (status === 'arrived') { arrived = true; break; }
          state = stepCharacter(state, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, world.boxes);
          expect(Math.abs(state.y - 8)).toBeLessThan(.05);
          expect(state.vault).toBeNull();
          expect(onInsertionFloor(state, .05) || approvedRoadFootprint(state, .05)).toBe(true);
          if (tick % 256 === 0) await yieldWorker();
        }
        expect(arrived, `stalled at ${JSON.stringify(state)} toward ${JSON.stringify(goal)}`).toBe(true);
      }
    }
  }, 180_000);

  it('keeps a direct gate command on connected y8 floors and rejects backing-plane routes', async () => {
    const start = INSERTION.squadStarts[0]!;
    const path = nav.path(start, SOUTH_GATE)!;
    expect(completePathLength(path, start, SOUTH_GATE)).toBeGreaterThan(390);
    expect(path.vaults).toEqual([]);
    for (const p of sampleRoute(path.points.map((p) => [p.x, p.y, p.z]), .5)) {
      expect(Math.abs(p.y - 8)).toBeLessThan(.11);
      expect(onInsertionFloor(p, .1) || approvedRoadFootprint(p, .1)).toBe(true);
    }
    let state = createMoveState(start.x, 8, start.z), arrived = false;
    const follower = new PathFollower(nav, world.boxes);
    for (let tick = 0; tick < 6000; tick++) {
      const { input, status } = follower.step(state, { goal: SOUTH_GATE, pace: 'walk' }, 0);
      if (status === 'arrived') { arrived = true; break; }
      state = stepCharacter(state, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, world.boxes);
      expect(Math.abs(state.y - 8)).toBeLessThan(.05);
      expect(state.vault).toBeNull();
      expect(onInsertionFloor(state, .05) || approvedRoadFootprint(state, .05)).toBe(true);
      if (tick % 256 === 0) await yieldWorker();
    }
    expect(arrived).toBe(true);
    const backing = { x: 60, y: 0, z: 250 };
    expect(nav.nearestPoint(backing)?.point.y).toBeLessThan(.11);
    for (const from of [start, APPROVED_SPINE[5]!, SOUTH_GATE]) {
      expect(completePathLength(nav.path(from, backing), from, backing)).toBeNull();
    }
  }, 90_000);

  it('inherits the accepted southern screening solids and occludes every observer group at the starts', async () => {
    const accepted = buildInsertionWorld();
    // Include the accepted foundation: basement muzzle rays rise toward S0
    // from below y8 and are screened by its real solid underside/volume.
    const southern = (boxes: readonly WorldBox[]) => boxes.filter((b) => b.minZ < 60)
      .map((b) => ({ ...b, maxZ: Math.min(60, b.maxZ) }));
    // North-cap carving can change generated numeric IDs. The inherited proof
    // depends on identical solid volumes and materials, rather than their IDs.
    const volumes = (boxes: readonly WorldBox[]) => southern(boxes).map((b) =>
      JSON.stringify([b.kind, b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ])).sort();
    expect(volumes(world.boxes)).toEqual(volumes(accepted.boxes));
    const blocked = rayOccluded(southern(world.boxes));
    let rays = 0;
    for (const group of insertionObservers()) {
      for (const [index, from] of group.points.entries()) {
        if (index % 32 !== 0 && index !== group.points.length - 1) continue;
        for (const start of INSERTION.squadStarts) for (const height of [.05, .6, 1.55, 1.8]) {
          const ray = between(from, { ...start, y: start.y + height });
          expect(blocked(ray), `${group.kind}: ${JSON.stringify(from)} sees ${JSON.stringify(start)}`).toBe(true);
          expect(rayWorld(ray, world.boxes)).not.toBeNull();
          rays++;
        }
        await yieldWorker();
      }
    }
    expect(rays).toBeGreaterThan(1000);
  }, 90_000);

  it('U-159: no straight view inside the 12 m tank lane exceeds 90 m', () => {
    const { lane } = roadSightPieces();
    const view = longestSegment(lane);
    expect(view.length).toBeLessThanOrEqual(ROAD_SUPPORTS.sightLines.maxLaneViewM);
    expect(view.length).toBeCloseTo(86.74, 2);
    expect(roadSightReport().longestLaneView.length).toBeCloseTo(view.length, 2);
    // Negative control: the same measure on U-149's road finds the rejected
    // view from the A4 bend down the lane to the court.
    const before = longestSegment(roadSightPieces(U149_SPINE).lane);
    expect(before.length).toBeGreaterThan(144);
    expect(before.to.z).toBeGreaterThan(195);
    expect(before.from.z).toBeLessThan(70);
  }, 60_000);

  it('U-159: no straight view on the walking surface joins two of the three fights', () => {
    const pairs = fightSeparation();
    // toll A2 · frontage A4/A5 · forecourt A8: every cross-fight node pair.
    expect(pairs.map((p) => p.nodes.join('-'))).toEqual(['A2-A4', 'A2-A5', 'A2-A8', 'A4-A8', 'A5-A8']);
    for (const p of pairs) expect(p.separated, `${p.nodes.join('-')} ${JSON.stringify(p.witness)}`).toBe(true);
    expect(roadSightReport().separatedFights).toEqual(pairs.map((p) => p.nodes.join('-')));
    // On U-149's road the toll bend saw straight into the frontage fight.
    const before = fightSeparation(U149_SPINE).find((p) => p.nodes.join('-') === 'A2-A4')!;
    expect(before.separated).toBe(false);
    expect(before.witness!.length).toBeGreaterThan(100);
  }, 60_000);

  it('U-159: records the longest bare-surface view from each fight for U-150 cover', () => {
    const views = roadSightReport().longestFightViews;
    expect(Object.keys(views)).toEqual(['A2', 'A4', 'A5', 'A8']);
    for (const [id, view] of Object.entries(views)) {
      const node = APPROVED_SPINE.find((p) => p.id === id)!;
      expect(Math.hypot(view.from.x - node.x, view.from.z - node.z), id).toBeLessThanOrEqual(18.3);
      expect(Math.hypot(view.to.x - view.from.x, view.to.z - view.from.z)).toBeCloseTo(view.length, 0);
    }
    // Views longer than the lane's leave the lane, so U-150 can still cut them.
    expect(views['A2']!.length).toBeLessThanOrEqual(90);
    expect(views['A8']!.length).toBeLessThanOrEqual(90);
  }, 60_000);

  it('keeps generated construction, plan and eight actual-scene captures current', () => {
    const manifest = roadSupportManifest();
    expect(JSON.parse(readFileSync(new URL('../../../../artifacts/qalat-road-supports/construction.json', import.meta.url), 'utf8'))).toEqual(manifest);
    expect(readFileSync(new URL('../../../../artifacts/qalat-road-supports/plan.svg', import.meta.url), 'utf8')).toBe(roadSupportPlanSvg());
    const captures = JSON.parse(readFileSync(new URL('../../../../artifacts/qalat-road-supports/captures.json', import.meta.url), 'utf8'));
    expect(captures).toMatchObject(manifest);
    expect(captures.viewport).toEqual([1440, 1000]);
    expect(captures.views).toHaveLength(8);
    expect(new Set(captures.views.map((v: { name: string }) => v.name)).size).toBe(8);
    const standingViews = captures.views.slice(0, 5) as { name: string; position: number[] }[];
    expect(standingViews.map((view) => view.name)).toEqual(['cap-d', 'cap-a', 'a3-west-leg', 'a5', 'cap-x-forecourt-road']);
    for (const view of standingViews) {
      const feet = { x: view.position[0]!, y: view.position[1]! - DEFAULT_MUZZLE_RIG.eyeHeight, z: view.position[2]! };
      expect(feet.y, `${view.name} standing eye`).toBeCloseTo(8);
      clearSupport(feet, DEFAULT_MOVE_CONFIG.radius);
      expect(onInsertionFloor(feet, .001) || approvedRoadFootprint(feet, .001), `${view.name} legal standing floor`).toBe(true);
    }
    for (const view of captures.views as { name: string; levelHash: string; calls: number; boxCount: number }[]) {
      expect(view.levelHash).toBe(manifest.levelHash);
      expect(view.boxCount).toBe(manifest.boxCount);
      expect(view.calls).toBeGreaterThan(0);
      expect(view.calls).toBeLessThan(300);
      const png = readFileSync(new URL(`../../../../artifacts/qalat-road-supports/${view.name}.png`, import.meta.url));
      expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(png.readUInt32BE(16)).toBe(1440);
      expect(png.readUInt32BE(20)).toBe(1000);
    }
  });
});
