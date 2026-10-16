/** U-221: furnished outpost isolation; U-222 retains real POW tank shelters
 * and the known carry-1 external-camera line. No campaign activation. */
import * as THREE from 'three';
import { Detour, importNavMesh, type NavMesh as DetourMesh } from '@recast-navigation/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ClientConnection, DEFAULT_MOVE_CONFIG as config, TICK_SECONDS, blastExposure, blockedAt,
  buildTree, createLoopbackPair, createMoveState, parseMission, rayWorld, requireWorld,
  stepCharacter, supportUnder, type BotOrder, type Message, type WorldBox,
} from '@sandline/shared';
import { DEFAULT_CAMERA_CONFIG } from '../../../client/src/camera/cameraConfig.ts';
import { createCameraSolve, solveCamera } from '../../../client/src/camera/cameraSolve.ts';
import { createSceneCollider } from '../../../client/src/camera/sceneCollider.ts';
import { mobileOrbit } from '../../../client/src/camera/mobileOrbit.ts';
import { buildOrder } from '../../../client/src/ui/OrderWheel.ts';
import { pickOrder, screenRay } from '../../../client/src/ui/orderPick.ts';
import { createBrainRegistry } from '../../../server/src/ai/Brain.ts';
import { NavMesh, completePathLength, initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { HitboxHistory, resolveShot } from '../../../server/src/net/lagComp.ts';
import { Session } from '../../../server/src/session/Session.ts';
import { buildOutpostWorld } from './qalatOutpost.ts';
import { bakeRoadSupportNav } from './qalatRoadNav.ts';

type Point = { x: number; y: number; z: number };
type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
const p = (x: number, z: number, y = 8): Point => ({ x, y, z });
const rect = (minX: number, maxX: number, minZ: number, maxZ: number): Rect => ({ minX, maxX, minZ, maxZ });
const inside = (r: Rect, at: Point, pad = .06) => at.x >= r.minX - pad && at.x <= r.maxX + pad
  && at.z >= r.minZ - pad && at.z <= r.maxZ + pad;
// Independently transcribed §§8.1/9.3 footprint and gate register. Never use
// generated authoring polygons to define the boundary the bake must obey.
const court = rect(8, 56, 356, 412), eastPad = rect(56, 61, 370, 376);
const annex = [rect(28, 36, 412, 414), rect(30, 34, 412, 420), rect(18, 34, 416, 420),
  rect(18, 22, 416, 428), rect(18, 34, 424, 428), rect(30, 34, 424, 434), rect(24, 40, 434, 448)];
const footprint = [court, ...annex], onInside = (at: Point) => footprint.some((r) => inside(r, at));
const protectedFloor = [...footprint, eastPad, rect(7.2, 8, 371.4, 372)];
const gates = [
  { ...rect(28, 36, 354.9, 356.1), minY: 8, maxY: 15 },
  { ...rect(6.9, 8.1, 372, 376), minY: 8, maxY: 15 },
  { ...rect(55.9, 57.1, 372, 376), minY: 8, maxY: 15 },
];
const roomWitnesses = [p(18, 365), p(16, 380), p(16, 392), p(16, 402), p(48, 402),
  p(32, 440), p(20, 418), p(20, 426), p(32, 426), p(32, 418)];
const outside = [p(32, 350), p(5, 374), p(59, 374), p(96, 444), p(-8, 370, 0), p(-60, 370, 0)];
const world = buildOutpostWorld(), TICK_MS = TICK_SECONDS * 1000;
let nav: NavMesh, mesh: DetourMesh;
beforeAll(async () => {
  await initNav(); const bytes = await bakeRoadSupportNav(world);
  nav = NavMesh.load(bytes); mesh = importNavMesh(bytes).navMesh;
}, 240_000);
afterAll(() => { nav?.destroy(); mesh?.destroy(); });
const yieldWorker = () => new Promise<void>((resolve) => setImmediate(resolve));
const windows = new Map<string, WorldBox[]>();
function nearby(at: Point) {
  const x = Math.floor(at.x / 4) * 4, z = Math.floor(at.z / 4) * 4, key = `${x}/${z}`;
  let boxes = windows.get(key);
  if (!boxes) {
    boxes = world.boxes.filter((b) => b.maxX >= x - 4 && b.minX <= x + 8 && b.maxZ >= z - 4 && b.minZ <= z + 8);
    windows.set(key, boxes);
  }
  return boxes;
}
function scenery(at: Point, reach = 35) {
  const material = new THREE.MeshBasicMaterial({ visible: false });
  const boxes = world.boxes.filter((b) => b.maxX >= at.x - reach && b.minX <= at.x + reach
    && b.maxZ >= at.z - reach && b.minZ <= at.z + reach);
  const objects = boxes.map((b) => {
    const object = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ), material);
    object.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
    object.updateMatrixWorld(); return object;
  });
  return { boxes, objects, dispose() { objects.forEach((o) => o.geometry.dispose()); material.dispose(); } };
}
function squad() {
  const starts = [p(24, 374), p(26, 374), p(36, 380), p(38, 380), p(40, 380), p(42, 380)];
  const fixture = { ...world, squadStarts: starts, mission: { ...requireWorld('greybox-01').mission!,
    spawnZones: [{ id: 'unused', on: 'objective' as const, x: 32, y: 8, z: 374, radius: .1 }] } };
  const mission = parseMission({ id: 'outpost-isolation', world: world.id, respawn: false,
    objectives: [{ type: 'survive', label: 'Outpost isolation proof', seconds: 3600 }] });
  const session = new Session(undefined, '', fixture, { mission, navMesh: nav,
    brainTree: buildTree('friendly', createBrainRegistry()) });
  const pair = createLoopbackPair(); session.addConnection(pair.a, 0);
  let orders: readonly BotOrder[] = [];
  const client = new ClientConnection(pair.b, { onOrders: (o) => { orders = o; } });
  client.join('outpost-isolation'); pair.settle();
  session.slots.slice(2).forEach((s) => session.orderFrom(0,
    { order: 'hold', address: { to: 'slot', index: s.index }, point: null, target: null }));
  let tick = 0;
  return { session, get orders() { return orders; },
    say(message: Message) { client.send(message); pair.settle(); },
    run(ticks: number) { for (let n = 0; n < ticks; n++) {
      client.send({ kind: 'Input', tick: ++tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0 });
      pair.settle(); session.step((session.tick + 1) * TICK_MS); pair.settle();
    } },
  };
}

describe('U-221 complete furnished outpost isolation', () => {
  it('audits every live Detour adjacency after cutting exactly the three registered player gates', () => {
    const centre = p(36, 388), nodes = [centre, ...roomWitnesses, ...outside];
    expect(nav.links()).toEqual([]);
    for (const at of nodes) {
      const hit = nav.nearestPoint(at)?.point;
      expect(hit, `non-vacuous target ${JSON.stringify(at)}`).toBeDefined();
      expect(Math.hypot(hit!.x - at.x, hit!.z - at.z)).toBeLessThan(.1);
      expect(Math.abs(hit!.y - at.y)).toBeLessThan(.05002);
    }
    // Every registered join has a positive control on this same full bake.
    for (const at of outside.slice(0, 3)) for (const [from, to] of [[centre, at], [at, centre]])
      expect(completePathLength(nav.path(from!, to!), from!, to!)).not.toBeNull();
    const polygons = nav.polygons(), byRef = new Map(polygons.map((poly) => [poly.ref, poly]));
    const removed = new Set(polygons.filter((poly) => gates.some((g) =>
      Math.max(...poly.corners.map((v) => v.x)) > g.minX && Math.min(...poly.corners.map((v) => v.x)) < g.maxX
      && Math.max(...poly.corners.map((v) => v.z)) > g.minZ && Math.min(...poly.corners.map((v) => v.z)) < g.maxZ
      && poly.centre.y < g.maxY && poly.centre.y + config.height > g.minY)).map((poly) => poly.ref));
    const seen = new Set<number>(), todo = [nav.nearestPoint(centre)!.polyRef];
    for (let i = 0; i < todo.length; i++) {
      const ref = todo[i]!; if (seen.has(ref) || removed.has(ref)) continue;
      seen.add(ref);
      const { tile, poly } = mesh.getTileAndPolyByRefUnsafe(ref);
      for (let index = poly.firstLink(); index !== Detour.DT_NULL_LINK;) {
        const link = tile.links(index), next = link.ref();
        if (byRef.has(next) && !seen.has(next)) todo.push(next);
        index = link.next();
      }
    }
    expect(seen.size).toBeGreaterThan(100);
    for (const at of roomWitnesses) expect(seen.has(nav.nearestPoint(at)!.polyRef), JSON.stringify(at)).toBe(true);
    const escaped = [...seen].map((ref) => byRef.get(ref)!).filter((poly) => Math.abs(poly.centre.y - 8) > .05002 || !onInside(poly.centre));
    expect(escaped, 'outpost/annex component reached a roof, terrain, basement, X or backing plane').toEqual([]);
    nav.setBlocker('U221-three-gates', gates, true);
    try {
      for (const at of roomWitnesses) expect(completePathLength(nav.path(centre, at), centre, at)).not.toBeNull();
      for (const at of outside) for (const [from, to] of [[centre, at], [at, centre]])
        expect(completePathLength(nav.path(from!, to!), from!, to!), `unlisted gate ${JSON.stringify(at)}`).toBeNull();
    } finally { nav.setBlocker('U221-three-gates', [], false); }
    for (const at of outside.slice(0, 3)) expect(completePathLength(nav.path(centre, at), centre, at)).not.toBeNull();
    console.log('U-221 complete outpost graph', JSON.stringify({ auditedPolygons: seen.size, removed: removed.size, gates: gates.length }));
  }, 120_000);

  it('sweeps every relevant courtyard, annex and room boundary with real jump/vault/drop/stance inputs', async () => {
    const rooms = [rect(10, 26, 360, 370), rect(10, 22, 376, 384), rect(10, 22, 386, 395.4),
      rect(10, 22, 396, 410), rect(42, 54, 390, 410)];
    const actions = ['walk/drop', 'sprint/drop', 'jump/vault', 'crouch', 'prone'] as const;
    const counts = { boundary: 0, room: 0 }, violations: string[] = [];
    const doors = [rect(18, 22, 369.8, 370.8), rect(21.8, 22.8, 378, 382),
      rect(21.8, 22.8, 390, 394), rect(14, 18, 395.2, 396.2), rect(41.2, 42.2, 394, 398)];
    const crossing = (from: Point, to: Point) => {
      // The east turning pad touches the court across solid arch infill.
      // Union membership alone cannot distinguish that wall from its door.
      if ((from.x < 56) !== (to.x < 56)) {
        const t = (56 - from.x) / (to.x - from.x), z = from.z + (to.z - from.z) * t;
        if (z >= 356 && z <= 412 && (z < 372 || z > 376)) return 'unlisted east-wall crossing';
      }
      const wasInside = protectedFloor.some((r) => inside(r, from)), nowInside = protectedFloor.some((r) => inside(r, to));
      // Register the final east-pad/ridge interface as well as south/west.
      // Check airborne crossings too: landing back on an authored floor must
      // not hide a jump through an unrelated boundary or room wall.
      if (wasInside !== nowInside && ![rect(28, 36, 355.4, 356.6), rect(7.4, 8.6, 372, 376),
        rect(56, 61, 369.4, 370.6)].some((gate) => inside(gate, from) || inside(gate, to))) return 'unlisted exterior crossing';
      for (const [i, room] of rooms.entries()) if (inside(room, from) !== inside(room, to)
        && ![doors[i]!, ...(i === 2 ? [doors[3]!] : [])].some((door) => inside(door, from) || inside(door, to))) return 'unlisted room crossing';
      return '';
    };
    const legal = (at: Point) => {
      const floor = nearby(at).filter((b) => b.id === 'outpost-courtyard-floor' || b.id === 'outpost-east-gate-floor'
        || b.id.startsWith('outpost-annex-floor') || b.id.startsWith('outpost-furniture-')
        // A legal gate may be reached by the deliberately oblique second push.
        || /^depot-stair-floor-/.test(b.id) || b.id.startsWith('road-support-') || b.id.startsWith('ridge-floor-'));
      return at.y >= -.000001 && at.y <= 12.000001
        && Math.abs(supportUnder(at.x, at.z, config.radius, at.y + .01, floor, -100) - at.y) < 1e-6;
    };
    for (const [kind, rectangles] of [['boundary', [...footprint, eastPad]], ['room', rooms]] as const) {
      for (const r of rectangles) for (const [a, b, dx, dz] of [
        [[r.minX, r.minZ], [r.maxX, r.minZ], 0, -1], [[r.maxX, r.minZ], [r.maxX, r.maxZ], 1, 0],
        [[r.maxX, r.maxZ], [r.minX, r.maxZ], 0, 1], [[r.minX, r.maxZ], [r.minX, r.minZ], -1, 0],
      ] as const) {
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let t = .5; t < length; t += 2) {
          const edge = p(a[0] + (b[0] - a[0]) * t / length, a[1] + (b[1] - a[1]) * t / length);
          if (kind === 'boundary' && [...footprint, eastPad].some((other) => inside(other, p(edge.x + dx * .2, edge.z + dz * .2), 0))) continue;
          const start = p(edge.x - dx * .65, edge.z - dz * .65), boxes = nearby(start);
          if (blockedAt(start.x, start.z, config.radius, 8, .05, config.height, boxes) || !legal(start)) continue;
          const yaw = (Math.round(Math.atan2(dx, dz) / (2 * Math.PI) * 1024) + 1024) % 1024;
          for (const action of actions) {
            let state = { ...createMoveState(start.x, 8, start.z), grounded: true };
            for (let tick = 0; tick < 150; tick++) {
              const push = tick < 90;
              const previous = state;
              state = stepCharacter(state, { moveX: 0, moveY: push ? 1 : 0,
                yaw: (yaw + (tick >= 60 ? 128 : 0)) % 1024,
                sprint: push && (action === 'sprint/drop' || action === 'jump/vault'), jump: push && action === 'jump/vault',
                crouch: push && action === 'crouch', prone: push && action === 'prone' }, TICK_SECONDS, config, nearby(state));
              const reason = crossing(previous, state) || (state.grounded && !legal(state) ? 'illegal support' : '');
              if (reason) { violations.push(`${kind}/${action}: ${reason} ${JSON.stringify(start)} → ${JSON.stringify(state)}`); break; }
            }
            expect(state.grounded, `${kind}/${action} did not settle`).toBe(true);
            expect(state.vault).toBeNull(); counts[kind]++;
          }
        }
        await yieldWorker();
      }
    }
    expect(counts.boundary).toBeGreaterThan(300); expect(counts.room).toBeGreaterThan(300);
    // A removed closed cell wall must be caught by this independent crossing
    // oracle even though the actor lands on ordinary courtyard support.
    const opened = nearby(p(10.65, 402)).filter((b) => !(b.id.startsWith('outpost-cell-walls') && b.maxX <= 10.000001));
    let control = { ...createMoveState(10.65, 8, 402), grounded: true }, detected = false;
    for (let tick = 0; tick < 30; tick++) {
      const previous = control;
      control = stepCharacter(control, { moveX: 0, moveY: 1, yaw: 768, sprint: true, jump: false, crouch: false, prone: false },
        TICK_SECONDS, config, opened);
      detected ||= crossing(previous, control) === 'unlisted room crossing';
    }
    expect(detected, 'removed closed cell-wall control must fail the boundary oracle').toBe(true);
    const openedEast = nearby(p(55.35, 371)).filter((b) => !b.id.startsWith('outpost-east-arch-infill'));
    control = { ...createMoveState(55.35, 8, 371), grounded: true }; detected = false;
    for (let tick = 0; tick < 20; tick++) {
      const previous = control;
      control = stepCharacter(control, { moveX: 0, moveY: 1, yaw: 256, sprint: true, jump: false, crouch: false, prone: false },
        TICK_SECONDS, config, openedEast);
      detected ||= crossing(previous, control) === 'unlisted east-wall crossing';
    }
    expect(detected, 'removed east-infill control must fail despite reaching legal east-pad support').toBe(true);
    console.log('U-221 boundary controller', JSON.stringify({ counts, actions, pushTicks: 90, settleTicks: 60, violations: violations.length }));
    expect(violations, 'landed on a roof, wall, tower, terrain or backing plane').toEqual([]);
  }, 240_000);

  it('blocks both weapon and blast directions through every outpost room/annex roof including edges', () => {
    const roofs = world.boxes.filter((b) => /^outpost-(?:annex-roof-|[a-z]+-roof$)/.test(b.id));
    expect(roofs.length).toBeGreaterThan(20);
    let probes = 0;
    for (const roof of roofs) for (const x of [roof.minX + .001, (roof.minX + roof.maxX) / 2, roof.maxX - .001])
      for (const z of [roof.minZ + .001, (roof.minZ + roof.maxZ) / 2, roof.maxZ - .001]) for (const upward of [true, false]) {
        const origin = { x, y: upward ? roof.minY - .01 : roof.maxY + .01, z };
        const feet = { x, y: upward ? roof.maxY + .01 : roof.minY - 1.81, z };
        const ray = { origin, direction: { x: 0, y: upward ? 1 : -1, z: 0 }, maxDistance: roof.maxY - roof.minY + 3 };
        const history = new HitboxHistory(); history.record(2, 0, x, feet.y, z);
        expect(resolveShot(history, { shooterNetId: 1, ray, nowMs: 0, clientRenderTimeMs: 0 }, undefined, nearby(feet))?.netId, roof.id).toBe(0);
        expect(blastExposure(origin, feet, 1.8, nearby(feet)), roof.id).toBe(0); probes++;
      }
    console.log('U-221 real outpost roof consumers', JSON.stringify({ slabs: roofs.length, probes }));
  }, 120_000);

  it('keeps desktop/mobile camera arms inside every occupied room and every covered annex turn', async () => {
    let solves = 0, shortened = 0;
    for (const at of roomWitnesses) {
      const scene = scenery(at), collider = createSceneCollider(scene.objects);
      const check = (solved: { position: Point; focus: Point }) => {
        const delta = new THREE.Vector3().subVectors(new THREE.Vector3().copy(solved.position), new THREE.Vector3().copy(solved.focus));
        expect(rayWorld({ origin: solved.focus, direction: delta.clone().normalize(), maxDistance: delta.length() }, scene.boxes, -1e-6),
          `camera crossed solid at ${JSON.stringify(at)}`).toBeNull();
        expect(scene.boxes.some((b) => solved.position.x > b.minX + 1e-7 && solved.position.x < b.maxX - 1e-7
          && solved.position.y > b.minY + 1e-7 && solved.position.y < b.maxY - 1e-7
          && solved.position.z > b.minZ + 1e-7 && solved.position.z < b.maxZ - 1e-7)).toBe(false); solves++;
      };
      try {
        for (const yawWire of [0, 256, 512, 768]) for (const degrees of [-75, -35, 0, 35, 75]) {
          const view = { ...at, yawWire, pitchWire: degrees * 1024 / 360, pitchFraction: degrees / 89,
            ads: false, firstPerson: false, shoulderSide: 1 as const };
          const free = solveCamera(view, DEFAULT_CAMERA_CONFIG, createCameraSolve());
          const solved = solveCamera(view, DEFAULT_CAMERA_CONFIG, createCameraSolve(), 1 / 60, collider);
          shortened += solved.distance < free.distance ? 1 : 0; check(solved);
        }
        for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) for (const pitch of [-1.15, -.35, .15])
          for (const distance of [3, 9, 18]) check(mobileOrbit(at, yaw, pitch, distance, 0, collider));
      } finally { scene.dispose(); }
      await yieldWorker();
    }
    expect(solves).toBe(560); expect(shortened).toBeGreaterThan(0);
    console.log('U-221 roof camera isolation', JSON.stringify({ roomsAndTurns: roomWitnesses.length, solves, shortened }));
  }, 120_000);

  it('preserves clicked outpost/annex floors through wire move/hold and actual friendly movement', () => {
    const sq = squad(), bot = sq.session.slots[1]!;
    for (const at of [p(26, 378), p(16, 402), p(32, 440)]) {
      const scene = scenery(at, 10);
      try {
        const camera = new THREE.PerspectiveCamera(60, 4 / 3, .1, 500);
        camera.position.set(at.x - 2, at.y + 1.6, at.z); camera.lookAt(at.x, at.y, at.z);
        const pick = pickOrder(screenRay(camera, { left: 0, top: 0, width: 400, height: 300 }, 200, 150, 8), scene.objects,
          undefined, { boxes: world.boxes, groundY: 0 });
        expect(pick.feet.y).toBeCloseTo(8, 6);
        bot.state = createMoveState(at.x, 8, at.z - 2);
        for (const order of ['move', 'hold'] as const) {
          const msg = buildOrder(order, { to: 'slot', index: 1 }, { point: pick.point, feet: pick.feet,
            netId: null, enemy: false, downedMate: false, facing: null });
          expect(msg).not.toBeNull(); sq.say(msg!);
          expect(sq.orders.find((o) => o.slot === 1)?.point?.y).toBeCloseTo(8, 6);
          const before = sq.session.orderReports.length;
          for (let tick = 0; tick < 180 && !sq.session.orderReports.slice(before).some((r) => r.slot === 1); tick++) {
            sq.run(1); expect(bot.state.y).toBeCloseTo(8, 6); expect(bot.state.vault).toBeNull();
          }
          if (order === 'move') expect(sq.session.orderReports.slice(before)).toContainEqual(
            expect.objectContaining({ slot: 1, order: 'move', outcome: 'done' }));
          expect(Math.hypot(bot.state.x - pick.feet.x, bot.state.z - pick.feet.z)).toBeLessThan(.7);
        }
      } finally { scene.dispose(); }
    }
  }, 120_000);

  it('uses Session enemy perception to reject a roof-separated actor and see a same-room control', () => {
    const sq = squad(), target = sq.session.slots[0]!;
    target.state = createMoveState(16, 12.8, 402);
    const netId = sq.session.spawnEnemy('rifleman', { x: 16, y: 8, z: 398,
      tree: buildTree('idle', createBrainRegistry()) })!;
    const guard = sq.session.enemies.find((e) => e.netId === netId)!; guard.yaw = 0;
    sq.run(30); expect(guard.state.y).toBe(8);
    expect(guard.awareness.get(target.netId) ?? 0).toBe(0); expect(guard.memory.entries.has(target.netId)).toBe(false);
    target.state = createMoveState(16, 8, 402);
    sq.run(30); expect(guard.awareness.get(target.netId)).toBeGreaterThan(0);
    expect(guard.memory.entries.has(target.netId)).toBe(true);
  }, 120_000);
});
