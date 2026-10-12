import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, DEFAULT_MUZZLE_RIG, TICK_SECONDS, blockedAt, createMoveState, rayWorld,
  stepCharacter, supportUnder, type WorldBox,
} from '@sandline/shared';
import { NavMesh, completePathLength, initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { PathFollower } from '../../../server/src/ai/locomotion/followPath.ts';
import { INSERTION, buildInsertionWorld, onInsertionFloor } from './qalatInsertion.ts';
import { between, insertionObservers, rayOccluded, sampleRoute } from './insertionScreening.ts';
import {
  ROAD_SUPPORTS, buildRoadSupportLevel, buildRoadSupportWorld, fightSeparation, onRoadSupportFloor,
  roadCombatReport, roadSightPieces, roadSightReport, roadSupportManifest, roadSupportPlanSvg, roadTankSweepReport,
} from './qalatRoadSupports.ts';
import { longestSegment } from './roadSightLines.ts';
import { onTankIngressFloor } from './qalatTankIngress.ts';
import { buildRoadCombat } from './qalatRoadCombat.ts';
import { bakeRoadSupportNav } from './qalatRoadNav.ts';

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

function clearSupport(p: Point, half = .001, allowCombat = false): void {
  expect(supportUnder(p.x, p.z, half, 8.45, world.boxes, 0), `unsupported ${JSON.stringify(p)}`).toBe(8);
  // U-161 clips shoulders/aprons around named combat solids; all other
  // geometry must still leave the original foundation clear and supported.
  const expected = allowCombat && blockedAt(p.x, p.z, half, 8, 0, DEFAULT_MOVE_CONFIG.height, combatBoxes);
  expect(blockedAt(p.x, p.z, half, 8, 0, DEFAULT_MOVE_CONFIG.height, world.boxes), `blocked ${JSON.stringify(p)}`).toBe(expected);
}

const world = buildRoadSupportWorld();
const combatIds = new Set(buildRoadCombat().map((b) => b.id));
const combatBoxes = world.boxes.filter((b) => combatIds.has(b.id));
let nav: NavMesh;
describe('U-149 isolated A0–A9 primary road supports, bent by U-159 and closed by U-160 rock', () => {
  beforeAll(async () => {
    await initNav();
    // Use the production solid/headroom rasterizer and the standing agent.
    // These same-height slabs need neither vault links nor a fake route mesh.
    nav = NavMesh.load(await bakeRoadSupportNav(world));
  }, 180_000);
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
        clearSupport(p, .001, Math.abs(offset) > 6);
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
        clearSupport(p, .001, true);
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
        // Independently specified building footprints and the 4 m store connector.
        const tollFloor = x >= -8.65 && x <= .65 && z >= 113.35 && z <= 122.65;
        const storeFloor = x >= 45.35 && x <= 54.65 && z >= 53.35 && z <= 62.65;
        const storeConnector = x >= 43.95 && x <= 46.05 && z >= 55.95 && z <= 60.05;
        expect(approvedRoadFootprint({ x, z }, .05) || onTankIngressFloor({ x, z }, .05) || tollFloor || storeFloor || storeConnector, `support expansion at ${JSON.stringify({ x, z })}`).toBe(true);
      }
      if (supports % 256 === 0) await yieldWorker();
    }
    expect(supports).toBeGreaterThan(1000);
  }, 60_000);

  it('reserves the future basement volume and exact service-bridge deck volume', () => {
    const northern = world.boxes.filter((b) => b.maxZ > 84);
    expect(northern.length).toBeGreaterThan(0);
    expect(northern.every((b) => b.minY >= 5.5)).toBe(true);
    expect(northern.some((b) => b.minY === 5.5 && b.maxY === 8)).toBe(true);
    const bridge = { minX: 66, maxX: 74, minZ: 330, maxZ: 342 };
    expect(world.boxes.filter((b) => b.maxX > bridge.minX && b.minX < bridge.maxX
      && b.maxZ > bridge.minZ && b.minZ < bridge.maxZ && b.minY < 16 && b.maxY > 14)).toEqual([]);
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

  it('keeps a direct gate command untruncated on connected y8 floors and rejects backing-plane routes', async () => {
    const start = INSERTION.squadStarts[0]!;
    const path = nav.path(start, SOUTH_GATE)!;
    // U-161's finer combat contours need 272 polygons. A 256-polygon output
    // buffer stopped this otherwise connected command near A7, short of gate.
    expect(path.corridor.length).toBeGreaterThan(256);
    expect(completePathLength(path, start, SOUTH_GATE), 'single command must reach the gate').toBeGreaterThan(390);
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
    // U-160: every rock top is an island. Left escarpment, A3/A7 inside
    // corners, the T-E foot, a fin, a fan-shaped slope and a temporary cap.
    const tops = [{ x: -60, y: 26, z: 200 }, { x: -12, y: 20, z: 175 }, { x: 4, y: 20, z: 308 },
      { x: 45, y: 20, z: 190 }, { x: 36, y: 26, z: 150 }, { x: 40, y: 14, z: 214 }, { x: 33, y: 20, z: 140 }];
    for (const at of tops) {
      // Query at the rock's actual crest; fan-shaped slopes sit below the zone's.
      const top = { ...at, y: Math.max(...world.boxes.filter((b) => at.x >= b.minX && at.x <= b.maxX && at.z >= b.minZ && at.z <= b.maxZ).map((b) => b.maxY)) };
      const hit = nav.nearestPoint(top, { x: .5, y: .5, z: .5 });
      expect(hit, `no rock-top mesh near ${JSON.stringify(top)}`).not.toBeNull();
      const island = hit!.point;
      expect(island.y, JSON.stringify(top)).toBeGreaterThan(10.1);
      for (const from of [start, APPROVED_SPINE[2]!, APPROVED_SPINE[5]!, SOUTH_GATE]) {
        expect(completePathLength(nav.path(from, island), from, island), JSON.stringify(top)).toBeNull();
      }
    }
  }, 90_000);

  it('inherits the accepted southern screening solids and occludes every observer group at the starts', async () => {
    const accepted = buildInsertionWorld();
    // Include the accepted foundation: basement muzzle rays rise toward S0
    // from below y8 and are screened by its real solid underside/volume.
    const southern = (boxes: readonly WorldBox[]) => boxes.filter((b) => b.minZ < 60)
      .map((b) => ({ ...b, maxZ: Math.min(60, b.maxZ) }));
    // Store carving changes the box decomposition and adds overlapping support
    // slabs. Compare solid unions at every y/z boundary, by material, rather
    // than requiring each compiler to split the identical volume into the same
    // boxes. The sole exception is the independent §11.2 shell/connector
    // envelope, including the existing 0.05 m construction tolerance.
    const clean = (n: number) => Math.round(n * 1e8) / 1e8;
    const normalize = (boxes: readonly WorldBox[]) => southern(boxes).map((b) => ({ ...b,
      minX: clean(b.minX), maxX: clean(b.maxX), minY: clean(b.minY), maxY: clean(b.maxY),
      minZ: clean(b.minZ), maxZ: clean(b.maxZ),
    }));
    const built = normalize(world.boxes), original = normalize(accepted.boxes);
    const all = [...built, ...original];
    const ys = [...new Set(all.flatMap((b) => [b.minY, b.maxY]))].sort((a, b) => a - b);
    const kinds = [...new Set(all.map((b) => b.kind))];
    const spans = (boxes: Iterable<WorldBox>, carve: boolean): [number, number][] => {
      const pieces: [number, number][] = [];
      for (const b of boxes) {
        if (!carve || b.maxX <= 43.95 || b.minX >= 54.65) pieces.push([b.minX, b.maxX]);
        else {
          if (b.minX < 43.95) pieces.push([b.minX, 43.95]);
          if (b.maxX > 54.65) pieces.push([54.65, b.maxX]);
        }
      }
      const merged: [number, number][] = [];
      for (const p of pieces.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
        const last = merged.at(-1);
        if (last && p[0] <= last[1]) last[1] = Math.max(last[1], p[1]);
        else merged.push([...p]);
      }
      return merged;
    };
    let bands = 0;
    for (const kind of kinds) for (let y = 1; y < ys.length; y++) {
      const y0 = ys[y - 1]!, y1 = ys[y]!;
      const layers = [built, original].map((boxes) => boxes.filter((b) => b.kind === kind && b.minY <= y0 && b.maxY >= y1));
      const events = layers.flatMap((boxes, side) => boxes.flatMap((b) => [
        { z: b.minZ, side, b, add: true }, { z: b.maxZ, side, b, add: false },
      ])).sort((a, b) => a.z - b.z);
      const zs = [...new Set([53.35, 62.65, ...events.map((e) => e.z)])].sort((a, b) => a - b);
      const active = [new Set<WorldBox>(), new Set<WorldBox>()];
      let nextEvent = 0;
      for (let row = 1; row < zs.length; row++) {
        const z0 = zs[row - 1]!, z1 = zs[row]!;
        while (nextEvent < events.length && events[nextEvent]!.z <= z0) {
          const e = events[nextEvent++]!;
          if (e.add) active[e.side]!.add(e.b); else active[e.side]!.delete(e.b);
        }
        const carve = z0 >= 53.35 && z1 <= 62.65;
        expect(spans(active[0]!, carve), `${kind} changed outside store at y${y0}..${y1}/z${z0}..${z1}`)
          .toEqual(spans(active[1]!, carve));
        bands++;
      }
    }
    expect(bands).toBeGreaterThan(10_000);
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

  it('keeps the independently computed tank sweep and controller travel report current', async () => {
    const level = buildRoadSupportLevel(), report = roadTankSweepReport(level);
    const generated = JSON.parse(readFileSync(new URL('../../../../artifacts/qalat-road-supports/construction.json', import.meta.url), 'utf8'));
    expect(report).toEqual(generated.tankSweep);
    expect(report.levelHash).toBe(generated.levelHash);
    expect(roadTankSweepReport(level)).toBe(report);
    // A warm cache must never certify altered geometry under the old hash.
    const blocked = { ...level, boxes: [...level.boxes,
      { id: 'tank-report-cache-obstacle', x: 96, y: 8, z: 444, w: 12, h: 4, d: 12 }] };
    expect(() => roadTankSweepReport(blocked)).toThrow(/blocked/);
    expect(roadTankSweepReport(level)).toBe(report);
    // Flush the completed proof test before the independent sight/manifest
    // comparison, so Vitest's reporting RPC is not starved by both together.
    await yieldWorker();
  }, 60_000);

  it('keeps the independently computed combat sight and physical blocker report current', async () => {
    const report = roadCombatReport();
    const generated = JSON.parse(readFileSync(new URL('../../../../artifacts/qalat-road-supports/construction.json', import.meta.url), 'utf8'));
    expect(report).toEqual(generated.combatSightLines);
    // Let the reporting RPC flush this asserted sight proof before the
    // complete manifest and capture comparison reuses the same source cache.
    await yieldWorker();
  }, 60_000);

  it('keeps generated construction, plan and actual-scene captures current', () => {
    const manifest = roadSupportManifest();
    expect(JSON.parse(readFileSync(new URL('../../../../artifacts/qalat-road-supports/construction.json', import.meta.url), 'utf8'))).toEqual(manifest);
    expect(readFileSync(new URL('../../../../artifacts/qalat-road-supports/plan.svg', import.meta.url), 'utf8')).toBe(roadSupportPlanSvg());
    const captures = JSON.parse(readFileSync(new URL('../../../../artifacts/qalat-road-supports/captures.json', import.meta.url), 'utf8'));
    expect(captures).toMatchObject(manifest);
    expect(captures.viewport).toEqual([1440, 1000]);
    expect(captures.views).toHaveLength(28);
    expect(new Set(captures.views.map((v: { name: string }) => v.name)).size).toBe(28);
    const standingViews = captures.views.slice(0, 7) as { name: string; position: number[] }[];
    expect(standingViews.map((view) => view.name)).toEqual(['cap-d', 'cap-a', 'a3-west-leg', 'a5', 'cap-x-forecourt-road', 'a2-toward-a3', 'a6-toward-a7']);
    const combatViews = captures.views.slice(11, 14) as { name: string; position: number[] }[];
    expect(combatViews.map((view) => view.name)).toEqual(['toll-office', 'frontage-mg', 'depot-frontage']);
    const ingressViews = captures.views.slice(14, 18) as { name: string; position: number[] }[];
    const returnViews = captures.views.slice(19, 22) as { name: string; position: number[] }[];
    expect(returnViews.map((view) => view.name)).toEqual(['cap-return', 'weigh-station-door', 'weigh-station-holding']);
    expect(returnViews.map((view) => view.position)).toEqual([[44, 9.55, 58], [40, 9.55, 58], [50, 9.55, 58]]);
    for (const view of returnViews) {
      const feet = { x: view.position[0]!, y: view.position[1]! - DEFAULT_MUZZLE_RIG.eyeHeight, z: view.position[2]! };
      expect(feet.y).toBeCloseTo(8);
      clearSupport(feet, DEFAULT_MOVE_CONFIG.radius);
      expect(feet.x >= 40 && feet.x <= 54 && feet.z >= 54 && feet.z <= 62).toBe(true);
    }
    const firingViews = captures.views.slice(22) as { name: string; position: number[] }[];
    expect(firingViews.map((view) => view.name)).toEqual(['rocket-ac01', 'rocket-ac02', 'rocket-ac07', 'rocket-ac08', 'rocket-ac11', 'rocket-ac12']);
    for (const view of firingViews) {
      const feet = { x: view.position[0]!, y: view.position[1]! - DEFAULT_MUZZLE_RIG.eyeHeight, z: view.position[2]! };
      expect(feet.y).toBeCloseTo(8);
      clearSupport(feet, DEFAULT_MOVE_CONFIG.radius);
      expect(approvedRoadFootprint(feet) || (feet.x >= -8 && feet.x <= 0 && feet.z >= 114 && feet.z <= 122)).toBe(true);
    }
    for (const view of [...standingViews, ...combatViews, ...ingressViews]) {
      const feet = { x: view.position[0]!, y: view.position[1]! - DEFAULT_MUZZLE_RIG.eyeHeight, z: view.position[2]! };
      expect(feet.y, `${view.name} standing eye`).toBeCloseTo(8);
      clearSupport(feet, DEFAULT_MOVE_CONFIG.radius);
      expect(onInsertionFloor(feet, .001) || approvedRoadFootprint(feet, .001) || onTankIngressFloor(feet, .001) || (view.name === 'toll-office' && feet.x >= -8 && feet.x <= 0 && feet.z >= 114 && feet.z <= 122), `${view.name} legal standing floor`).toBe(true);
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
  }, 60_000);
});
