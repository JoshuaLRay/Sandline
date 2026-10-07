import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MOVE_CONFIG, DEFAULT_MUZZLE_RIG, TICK_SECONDS, blockedAt, createMoveState, rayWorld, stepCharacter, supportUnder } from '@sandline/shared';
import { NavMesh, completePathLength, initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { PathFollower } from '../../../server/src/ai/locomotion/followPath.ts';
import { DEFAULT_NAV_AGENT, navConfigFor, worldSolids, worldSoup } from '../nav/bake.ts';
import { bakeSolidNavMesh } from '../nav/solidBake.ts';
import { INSERTION, buildInsertionWorld, insertionManifest, insertionPlanSvg, onInsertionFloor } from './qalatInsertion.ts';
import { between, insertionObservers, rayOccluded, sampleRoute, verifyInsertionScreening } from './insertionScreening.ts';

const world = buildInsertionWorld();
let nav: NavMesh;
describe('U-138 isolated Juniper Hollow construction', () => {
  beforeAll(async () => {
    await initNav();
    // All reachable floor is y8 and every terrain face is >=18 m tall. No
    // vault/drop link can connect those levels; bake the production solid
    // rasterizer with the production standing agent and no invented links.
    nav = NavMesh.load(await bakeSolidNavMesh(worldSoup(world), worldSolids(world), navConfigFor(DEFAULT_NAV_AGENT)));
  }, 120_000);
  afterAll(() => nav?.destroy());

  it('keeps generated review evidence current with the actual compiled scene', () => {
    expect(JSON.parse(readFileSync(new URL('../../../../artifacts/qalat-insertion/construction.json', import.meta.url), 'utf8'))).toEqual(insertionManifest());
    expect(readFileSync(new URL('../../../../artifacts/qalat-insertion/plan.svg', import.meta.url), 'utf8')).toBe(insertionPlanSvg());
    const captures = JSON.parse(readFileSync(new URL('../../../../artifacts/qalat-insertion/captures.json', import.meta.url), 'utf8'));
    expect(captures).toMatchObject(insertionManifest());
    expect(captures.views).toHaveLength(5);
    expect(captures.views.every((v: { levelHash: string; calls: number }) => v.levelHash === insertionManifest().levelHash && v.calls < 300)).toBe(true);
    expect(world.squadStarts).toEqual([
      { x: -6, y: 8, z: -10 }, { x: -2, y: 8, z: -10 }, { x: 2, y: 8, z: -10 },
      { x: -6, y: 8, z: -6 }, { x: -2, y: 8, z: -6 }, { x: 2, y: 8, z: -6 },
    ]);
  });

  it('supports the entire S0 rectangle, all starts and 8 m perpendicular ribbons', () => {
    for (let x = -20; x <= 18; x++) for (let z = -24; z <= 12; z++) {
      expect(supportUnder(x, z, .001, 8.45, world.boxes, 0)).toBe(8);
      expect(blockedAt(x, z, .001, 8, 0, DEFAULT_MOVE_CONFIG.height, world.boxes)).toBe(false);
    }
    for (let i = 1; i < INSERTION.spine.length; i++) {
      const a = INSERTION.spine[i - 1]!, b = INSERTION.spine[i]!;
      const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
      for (let n = 1; n < Math.floor(length); n++) for (const side of [-1, 1]) {
        const x = a.x + dx * n / length - dz / length * 4 * side;
        const z = a.z + dz * n / length + dx / length * 4 * side;
        expect(blockedAt(x, z, .001, 8, 0, DEFAULT_MOVE_CONFIG.height, world.boxes)).toBe(false);
      }
    }
  }, 60_000);

  it('has five metres of solid overhang headroom and a western sky opening', () => {
    const roof = world.boxes.find((b) => b.id === 'hollow-overhang')!;
    expect([roof.minX, roof.maxX, roof.minZ, roof.maxZ, roof.minY, roof.maxY]).toEqual([-8, 18, -18, 12, 13, 14.2]);
    expect(rayWorld({ origin: { x: 0, y: 9.55, z: -6 }, direction: { x: 0, y: 1, z: 0 }, maxDistance: 100 }, world.boxes)?.box.id).toBe(roof.id);
    expect(rayWorld({ origin: { x: -16, y: 9.55, z: -6 }, direction: { x: 0, y: 1, z: 0 }, maxDistance: 100 }, world.boxes)).toBeNull();
  });

  for (const reverse of [false, true]) it(`walks all six starts and both bends ${reverse ? 'inbound' : 'outbound'} on real nav/controller`, () => {
    for (const spawn of INSERTION.squadStarts) {
      const stops = [spawn, ...INSERTION.spine.slice(1)];
      if (reverse) stops.reverse();
      let state = createMoveState(stops[0]!.x, 8, stops[0]!.z);
      const follower = new PathFollower(nav, world.boxes);
      for (const goal of stops.slice(1)) {
        expect(completePathLength(nav.path(state, goal), state, goal)).not.toBeNull();
        let arrived = false;
        for (let tick = 0; tick < 900; tick++) {
          const { input, status } = follower.step(state, { goal, pace: 'walk' }, 0);
          if (status === 'arrived') { arrived = true; break; }
          state = stepCharacter(state, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, world.boxes);
          expect(Math.abs(state.y - 8)).toBeLessThan(.05);
          expect(state.vault).toBeNull();
          expect(onInsertionFloor(state, .05)).toBe(true);
        }
        expect(arrived, `stalled at ${JSON.stringify(state)} toward ${JSON.stringify(goal)}`).toBe(true);
      }
    }
  }, 120_000);

  it('forces both reveal bends even on a direct D0 command and reverses through all continuation sockets', () => {
    const a = INSERTION.spine[0]!, b = INSERTION.spine.at(-1)!;
    const path = nav.path(a, b)!;
    const samples = sampleRoute(path.points.map((p) => [p.x, p.y, p.z]), .5);
    expect(completePathLength(path, a, b)).toBeGreaterThan(86);
    expect(samples.some((p) => p.x < -8 && p.z >= 16)).toBe(true);
    expect(samples.some((p) => p.z >= 35 && p.z <= 49)).toBe(true);
    for (const p of samples) expect(onInsertionFloor(p, .1)).toBe(true);
    let state = createMoveState(a.x, 8, a.z), arrived = false;
    const follower = new PathFollower(nav, world.boxes);
    for (let tick = 0; tick < 2400; tick++) {
      const { input, status } = follower.step(state, { goal: b, pace: 'walk' }, 0);
      if (status === 'arrived') { arrived = true; break; }
      state = stepCharacter(state, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, world.boxes);
      expect(Math.abs(state.y - 8)).toBeLessThan(.05);
      expect(state.vault).toBeNull();
      expect(onInsertionFloor(state, .05)).toBe(true);
    }
    expect(arrived).toBe(true);
    for (const mouth of INSERTION.continuations) for (const [from, to] of [[b, mouth], [mouth, b]]) {
      expect(completePathLength(nav.path(from!, to!), from!, to!)).not.toBeNull();
    }
    for (const p of [{ x: 0, y: 38, z: 20 }, { x: -32, y: 32, z: 0 }, { x: -8, y: 34, z: 55 }, { x: 0, y: 14.2, z: -6 }]) {
      expect(completePathLength(nav.path(a, p), a, p)).toBeNull();
    }
    expect(rayWorld(between({ ...a, y: 9.55 }, { ...b, y: 9.55 }), world.boxes)).not.toBeNull();
    expect(rayWorld(between({ x: -12, y: 9.55, z: 36 }, { x: 32, y: 9.55, z: 64 }), world.boxes)).not.toBeNull();
  }, 60_000);

  it('keeps the entire court hidden beyond 12 m, including legal approach shoulders', async () => {
    const c = INSERTION.court, radius = DEFAULT_MOVE_CONFIG.radius;
    const eyeY = INSERTION.floorY + DEFAULT_MUZZLE_RIG.eyeHeight;
    const targets = [];
    for (let x = c.minX; x <= c.maxX; x++) for (let z = c.minZ; z <= c.maxZ; z++) targets.push({ x, y: eyeY, z });
    // Floor grid includes corner bevels. Dense perpendicular shoulder probes
    // include the maximum legal standing-centre offset from each 8 m edge.
    const probes = [];
    const maxApproachX = Math.max(c.maxX, ...INSERTION.spine.map((p) => p.x)) + INSERTION.ribbonWidth / 2;
    for (let x = INSERTION.pocket.minX; x <= maxApproachX; x += .5) for (let z = INSERTION.pocket.minZ; z < c.minZ; z += .5) probes.push({ x, y: 8, z });
    for (let i = 1; i < INSERTION.spine.length; i++) {
      const a = INSERTION.spine[i - 1]!, b = INSERTION.spine[i]!;
      const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
      for (const p of sampleRoute([[a.x, 8, a.z], [b.x, 8, b.z]], .25)) for (const side of [-4 + radius, 0, 4 - radius]) {
        probes.push({ x: p.x - dz / length * side, y: 8, z: p.z + dx / length * side });
      }
    }
    const blocked = rayOccluded(world.boxes);
    let hiddenProbes = 0, rays = 0, revealedWithin12 = false;
    for (const [index, p] of probes.entries()) {
      if (!onInsertionFloor(p) || blockedAt(p.x, p.z, radius, 8, 0, DEFAULT_MOVE_CONFIG.height, world.boxes)) continue;
      // Distance to the nearest court floor boundary, not to D0's centre.
      const distance = Math.hypot(Math.max(c.minX - p.x, 0, p.x - c.maxX), Math.max(c.minZ - p.z, 0, p.z - c.maxZ));
      if (distance > 12) {
        hiddenProbes++;
        for (const to of targets) {
          rays++;
          if (!blocked(between({ ...p, y: eyeY }, to))) throw new Error(`Early court reveal ${distance} m from ${JSON.stringify(p)} to ${JSON.stringify(to)}`);
        }
      } else if (distance > 0 && !revealedWithin12) {
        revealedWithin12 = targets.some((to) => !blocked(between({ ...p, y: eyeY }, to)));
      }
      if (index % 64 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(hiddenProbes).toBeGreaterThan(6000);
    expect(revealedWithin12).toBe(true);
    console.log('U-138 late court reveal', JSON.stringify({ hiddenProbes, targets: targets.length, rays, gridStepM: .5, shoulderStepM: .25, limitM: 12 }));
  }, 120_000);

  it('rejects stand/jump/crouch/prone/vault escapes around the pocket and bends', () => {
    const attempts = [
      { x: -19.5, z: -6, yaw: 768 }, { x: 17.5, z: -6, yaw: 256 }, { x: 0, z: -23.5, yaw: 512 },
      { x: -15.5, z: 26, yaw: 768 }, { x: -8.5, z: 26, yaw: 256 },
      { x: 0, z: 11.5, yaw: 0 }, { x: 0, z: 43.4, yaw: 0 },
    ];
    for (const at of attempts) for (const stance of ['stand', 'jump', 'crouch', 'prone']) {
      let state = createMoveState(at.x, 8, at.z);
      for (let tick = 0; tick < 90; tick++) state = stepCharacter(state, {
        moveX: 0, moveY: 1, yaw: at.yaw, sprint: true, jump: stance === 'jump', crouch: stance === 'crouch', prone: stance === 'prone',
      }, TICK_SECONDS, DEFAULT_MOVE_CONFIG, world.boxes);
      expect(state.vault).toBeNull();
      expect(state.y).toBeLessThan(11.2); // even a normal jump stays below the hollow roof
      for (let settle = 0; settle < 30; settle++) state = stepCharacter(state, { moveX: 0, moveY: 0, yaw: at.yaw, sprint: false, jump: false, crouch: false, prone: false }, TICK_SECONDS, DEFAULT_MOVE_CONFIG, world.boxes);
      expect(state.y).toBeCloseTo(8);
      expect(onInsertionFloor(state, .05)).toBe(true);
      expect(Math.hypot(state.x - at.x, state.z - at.z)).toBeLessThan(1);
    }
  }, 60_000);

  it('checks interpolated observers, both tank muzzles and all stance body heights against solid southern terrain', async () => {
    const evidence = await verifyInsertionScreening();
    expect(evidence[0]!.observers).toBe(36);
    expect(evidence.every((e) => e.rays > 0)).toBe(true);
    expect(evidence.at(-1)!.observers).toBe(insertionObservers().at(-1)!.points.length);
    console.log('U-138 GEO-07', JSON.stringify(evidence));
  }, 240_000);

  it('uses exact shared ray results in its broad-phase index, with an empty-scene failure control', () => {
    const boxes = world.boxes.filter((b) => b.minZ < 60 && b.maxY > 8);
    const indexed = rayOccluded(boxes);
    const from = insertionObservers()[0]!.points;
    for (const p of from.slice(0, 8)) for (const x of [-20, 0, 18]) {
      const ray = between(p, { x, y: 9.55, z: 12 });
      expect(indexed(ray)).toBe(rayWorld(ray, boxes) !== null);
      expect(rayOccluded([])(ray)).toBe(false);
    }
    const route = sampleRoute([[0, 8, 0], [4, 12, 4]]);
    expect(route.at(-1)).toEqual({ x: 4, y: 12, z: 4 });
    for (let i = 1; i < route.length; i++) expect(Math.hypot(route[i]!.x - route[i - 1]!.x, route[i]!.y - route[i - 1]!.y, route[i]!.z - route[i - 1]!.z)).toBeLessThanOrEqual(1);
  });
});
