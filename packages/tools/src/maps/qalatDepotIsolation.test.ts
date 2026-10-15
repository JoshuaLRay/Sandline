/** U-173: actual furnished depot geometry through the production floor consumers. */
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ClientConnection, DEFAULT_MOVE_CONFIG, DEFAULT_MUZZLE_RIG, TICK_SECONDS,
  blastDamageAt, blastDamageOn, blastExposure, blockedAt, buildTree, createLoopbackPair,
  createMoveState, decodeMessage, getEnemy, getProjectile, parseEncounter, parseMission,
  rayWorld, requireWorld, sight, supportUnder, type BotOrder, type Message, type WorldBox,
} from '@sandline/shared';
import { createSceneCollider } from '../../../client/src/camera/sceneCollider.ts';
import { createCameraSolve, solveCamera } from '../../../client/src/camera/cameraSolve.ts';
import { DEFAULT_CAMERA_CONFIG } from '../../../client/src/camera/cameraConfig.ts';
import { mobileOrbit } from '../../../client/src/camera/mobileOrbit.ts';
import { pickOrder, screenRay } from '../../../client/src/ui/orderPick.ts';
import { buildOrder } from '../../../client/src/ui/OrderWheel.ts';
import { createBrainRegistry } from '../../../server/src/ai/Brain.ts';
import { NavMesh, initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { HitboxHistory, resolveShot } from '../../../server/src/net/lagComp.ts';
import { Session } from '../../../server/src/session/Session.ts';
import { DEFAULT_NAV_AGENT, onMesh } from '../nav/bake.ts';
import { coverPoints } from '../nav/cover.ts';
import { buildDepotWorld } from './qalatDepot.ts';
import { bakeRoadSupportNav } from './qalatRoadNav.ts';

const TICK_MS = TICK_SECONDS * 1000;
const generated = buildDepotWorld();
// Independent approved B6/A6 overlap and retained ridge bridge. Construction
// geometry is unmodified; the test mission supplies only sockets and a retry.
const starts = [0, 8].flatMap((y) => [268, 270, 272].map((z) => ({ x: 30, y, z })));
const world = { ...generated, squadStarts: starts, mission: {
  ...requireWorld('greybox-01').mission!,
  spawnZones: [{ id: 'unused', on: 'objective' as const, x: 30, y: 0, z: 270, radius: .1 }],
} };
const sockets = [0, 8].map((y) => ({ id: `B6-floor-${y}`, archetype: 'rifleman',
  feet: { x: 30, y, z: 270 }, face: { x: 30, z: 266 } }));
const encounter = parseEncounter({ world: world.id, aliveCap: 2, probes: [.3, 1, 1.7], areas: {},
  groups: [{ id: 'floors', zone: 'unused', fixedCount: true, members: [{ archetype: 'rifleman', count: 2 }],
    sockets, posture: { kind: 'hold' }, trigger: { kind: 'time', seconds: 9999 } }] }, () => world);
const mission = parseMission({ id: 'depot-isolation', world: world.id, respawn: false,
  objectives: [{ type: 'survive', label: 'Floor isolation proof', seconds: 3600 }] });
let nav: NavMesh;
beforeAll(async () => { await initNav(); nav = NavMesh.load(await bakeRoadSupportNav(generated)); }, 240_000);
afterAll(() => nav?.destroy());

/** Conservative broadphase, retaining every box intersecting a query's bounds. */
const windows = new Map<string, WorldBox[]>();
function nearby(x: number, z: number): WorldBox[] {
  const gx = Math.floor(x / 8) * 8, gz = Math.floor(z / 8) * 8, key = `${gx}/${gz}`;
  let boxes = windows.get(key);
  if (!boxes) {
    boxes = world.boxes.filter((b) => b.maxX >= gx - 2 && b.minX <= gx + 10 && b.maxZ >= gz - 2 && b.minZ <= gz + 10);
    windows.set(key, boxes);
  }
  return boxes;
}
function squad() {
  const session = new Session(undefined, '', world, { encounter, mission, navMesh: nav,
    brainTree: buildTree('friendly', createBrainRegistry()) });
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  const hits: Extract<Message, { kind: 'HitEvent' }>[] = [];
  pair.b.onMessage((bytes) => { const msg = decodeMessage(bytes); if (msg.kind === 'HitEvent') hits.push(msg); });
  let orders: readonly BotOrder[] = [];
  const client = new ClientConnection(pair.b, { onOrders: (o) => { orders = o; } });
  client.join('depot-proof'); pair.settle();
  // The other four slots are irrelevant to these focused single-bot probes;
  // full live seven-actor congestion is covered by the traversal regression.
  for (const slot of session.slots.slice(2)) Object.assign(slot.health, { current: 0, downedAt: null, diedAt: 0 });
  let tick = 0;
  return { session, hits, get orders() { return orders; },
    say(msg: Message) { client.send(msg); pair.settle(); },
    run(ticks: number, until?: () => boolean) {
      for (let t = 0; t < ticks; t++) {
        client.send({ kind: 'Input', tick: ++tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0 });
        pair.settle(); session.step((session.tick + 1) * TICK_MS); pair.settle();
        if (until?.()) break;
      }
    },
  };
}
/** Exact collision meshes, with ordinary outward-facing underside triangles. */
function scenery(at: { x: number; z: number }, reach = 35) {
  const material = new THREE.MeshBasicMaterial({ visible: false });
  const objects = world.boxes.filter((b) => b.maxX >= at.x - reach && b.minX <= at.x + reach
    && b.maxZ >= at.z - reach && b.minZ <= at.z + reach).map((b) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ), material);
    mesh.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
    mesh.updateMatrixWorld(); return mesh;
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000).rotateX(-Math.PI / 2), material);
  floor.updateMatrixWorld(); objects.push(floor);
  return { objects, dispose() { for (const o of objects) o.geometry.dispose(); material.dispose(); } };
}

describe('U-173 actual depot spawn, AI, cover and order floors', () => {
  it('retains exact six authored slot starts and two same-x/z enemy socket floors through restart/retry', () => {
    const sq = squad();
    expect(sq.session.slots.map((s) => ({ x: s.state.x, y: s.state.y, z: s.state.z }))).toEqual(starts);
    const assertStarts = () => {
      for (const [i, slot] of sq.session.slots.entries()) {
        expect(slot.state).toMatchObject(starts[i]!);
        expect(supportUnder(slot.state.x, slot.state.z, .35, slot.state.y + .01, world.boxes, 0)).toBe(slot.state.y);
        expect(blockedAt(slot.state.x, slot.state.z, .35, slot.state.y, .05, 1.8, world.boxes)).toBe(false);
      }
    };
    assertStarts();
    sq.session.slots.forEach((s) => { s.state.x += 1; });
    sq.session.retryMission(true); assertStarts();
    sq.session.slots.forEach((s) => { s.state.z += 1; });
    sq.session.restartMission(); assertStarts();
    for (const [i, slot] of sq.session.slots.entries()) slot.state = createMoveState(30, starts[i]!.y, 254 + i);
    sq.session.spawner!.activate('floors', 0);
    sq.run(1);
    for (const socket of sockets) {
      const e = sq.session.enemies.find((e) => e.spawnId === socket.id)!;
      expect(e.state).toMatchObject(socket.feet);
      expect(e.posture!.post).toEqual(socket.feet);
    }
    const bad = { ...encounter, groups: [{ ...encounter.groups[0]!, sockets: [
      { ...sockets[0]!, feet: { x: 30, y: 4, z: 270 } }, sockets[1]!,
    ] }] };
    expect(() => new Session(undefined, '', world, { encounter: bad, mission, navMesh: nav }))
      .toThrow(/B6-floor-0.*(floor|socket|support)/);
  });

  for (const y of [0, 8]) it(`executes a real wire move then hold on B6/A6 floor y${y}`, () => {
    const sq = squad(), bot = sq.session.slots[1]!;
    sq.session.slots[0]!.state = createMoveState(31, y, 266);
    bot.state = createMoveState(30, y, 267);
    const goal = { x: 30, y, z: 272 };
    sq.say({ kind: 'Order', order: 'move', address: { to: 'slot', index: 1 }, point: goal, target: null });
    expect(sq.orders.find((o) => o.slot === 1)?.point).toEqual(goal);
    for (let n = 0; n < 180 && !sq.session.orderReports.some((r) => r.slot === 1); n++) {
      sq.run(1);
      expect(bot.state.y).toBeCloseTo(y, 8);
      expect(bot.state.vault).toBeNull();
    }
    expect(sq.session.orderReports).toContainEqual(expect.objectContaining({ slot: 1, order: 'move', outcome: 'done' }));
    expect(Math.hypot(bot.state.x - goal.x, bot.state.z - goal.z)).toBeLessThan(.7);
    sq.say({ kind: 'Order', order: 'hold', address: { to: 'slot', index: 1 }, point: goal, target: null });
    sq.run(30); expect(bot.state.y).toBeCloseTo(y, 8);
    expect(sq.orders.find((o) => o.slot === 1)).toMatchObject({ order: 'hold', point: goal });
  });

  it('routes B6→A6 commands through B0, never completes a move/hold from directly beneath the goal', () => {
    const sq = squad(), bot = sq.session.slots[1]!;
    sq.session.slots[0]!.state = createMoveState(31, 0, 267);
    for (const order of ['move', 'hold'] as const) {
      bot.state = createMoveState(30, 0, 270);
      const goal = { x: 30, y: 8, z: 270 }, path = nav.path(bot.state, goal)!;
      expect(path.vaults).toEqual([]);
      expect(path.points.some((p) => p.z < 98 && p.y > 1)).toBe(true);
      sq.say({ kind: 'Order', order, address: { to: 'slot', index: 1 }, point: goal, target: null });
      const previousReports = sq.session.orderReports.length;
      sq.run(10);
      expect(sq.orders.find((o) => o.slot === 1)?.point).toEqual(goal);
      expect(sq.session.orderReports.slice(previousReports).some((r) => r.slot === 1 && r.outcome === 'done')).toBe(false);
      expect(bot.state.y).toBeCloseTo(0, 8);
      expect(Math.hypot(bot.state.x - 30, bot.state.z - 270)).toBeGreaterThan(.1);
    }
  });

  it('uses actual enemy perception through the B6 roof, with a visible same-floor control', () => {
    const sq = squad();
    sq.session.slots[0]!.state = createMoveState(30, 8, 270);
    sq.session.slots[1]!.state = createMoveState(30, 8, 268);
    const id = sq.session.spawnEnemy('rifleman', { x: 30, y: 0, z: 266, tree: buildTree('idle', createBrainRegistry()) })!;
    const guard = sq.session.enemies.find((e) => e.netId === id)!;
    guard.yaw = 0;
    sq.run(30);
    expect(guard.state.y).toBe(0);
    expect(guard.awareness.get(sq.session.slots[0]!.netId) ?? 0).toBe(0);
    expect(guard.memory.entries.has(sq.session.slots[0]!.netId)).toBe(false);
    sq.session.slots[0]!.state = createMoveState(30, 0, 270);
    sq.run(30);
    expect(guard.awareness.get(sq.session.slots[0]!.netId)).toBeGreaterThan(0);
    expect(guard.memory.entries.has(sq.session.slots[0]!.netId)).toBe(true);
  });

  it('bakes real B6 cover and rejects surface choices from below and basement choices from above', () => {
    // Crop candidate generation at a conservative B6 enclosure. All physical
    // solids touching that enclosure remain exact; the full nav/session still
    // decide reachability, so the roof is never removed to manufacture cover.
    const local = { ...world, boxes: world.boxes.filter((b) => b.maxX >= 15 && b.minX <= 45 && b.maxZ >= 250 && b.minZ <= 290) };
    const points = coverPoints(local, DEFAULT_NAV_AGENT, (p) => onMesh(nav, p, DEFAULT_NAV_AGENT.climb));
    const lower = points.filter((p) => p.box === 'depot-furniture-B6-low-stack');
    expect(lower.length).toBeGreaterThan(0);
    expect(lower.every((p) => p.y === 0)).toBe(true);
    expect(points.filter((p) => p.box.startsWith('depot-roof-') && p.y === 0)).toEqual([]);
    const low = lower[0]!, lowThreat = { x: low.x - low.nx * 4, y: 1.55, z: low.z - low.nz * 4 };
    const session = new Session(undefined, '', world, { navMesh: nav, cover: lower, testHumanCount: 0 });
    expect(session.cover!.choose(100, { from: low, threats: [lowThreat], combat: false })?.point.y).toBe(0);
    expect(session.cover!.choose(101, { from: { ...low, y: 8 }, threats: [lowThreat], combat: false })).toBeNull();
    // Retained A6 shoulder cover is generated from the actual surface solids.
    const upper = points.filter((p) => p.y === 8);
    expect(upper.length).toBeGreaterThan(0);
    const high = upper[0]!, threat = { x: high.x - high.nx * 4, y: 9.55, z: high.z - high.nz * 4 };
    const surface = new Session(undefined, '', world, { navMesh: nav, cover: [high], testHumanCount: 0 });
    expect(surface.cover!.choose(102, { from: high, threats: [threat], combat: false })?.point.y).toBe(8);
    expect(surface.cover!.choose(103, { from: { ...high, y: 0 }, threats: [threat], combat: false })).toBeNull();
    console.log('U-173 actual B6 cover', JSON.stringify({ lower: lower.length, upper: upper.length, rejectedUnderside: true }));
  }, 120_000);
});

describe('U-173 roof weapons, order picking and camera collision', () => {
  it('stops hitscan and every blast probe on both faces of every generated room/stair roof slab', () => {
    const roofs = world.boxes.filter((b) => /^depot-(?:stair-)?roof-/.test(b.id));
    expect(roofs.length).toBeGreaterThan(100);
    let probes = 0;
    for (const slab of roofs) {
      const insetX = Math.min(.001, (slab.maxX - slab.minX) / 4), insetZ = Math.min(.001, (slab.maxZ - slab.minZ) / 4);
      const positions = [[(slab.minX + slab.maxX) / 2, (slab.minZ + slab.maxZ) / 2],
        ...[slab.minX + insetX, slab.maxX - insetX].flatMap((x) => [slab.minZ + insetZ, slab.maxZ - insetZ].map((z) => [x, z]))];
      for (const [x, z] of positions) {
        const boxes = nearby(x!, z!);
        for (const upward of [true, false]) {
          const feet = { x: x!, y: upward ? slab.maxY + .01 : slab.minY - 1.81, z: z! };
          const centre = { x: x!, y: upward ? slab.minY - .01 : slab.maxY + .01, z: z! };
          const direction = { x: 0, y: upward ? 1 : -1, z: 0 };
          const ray = { origin: centre, direction, maxDistance: slab.maxY - slab.minY + 3 };
          expect(rayWorld(ray, boxes), slab.id).not.toBeNull();
          const history = new HitboxHistory(); history.record(2, 0, feet.x, feet.y, feet.z);
          expect(resolveShot(history, { shooterNetId: 1, ray, nowMs: 0, clientRenderTimeMs: 0 }, undefined, boxes)?.netId, slab.id).toBe(0);
          expect(blastExposure(centre, feet, 1.8, boxes), slab.id).toBe(0);
          probes++;
        }
      }
    }
    console.log('U-173 complete roof slab probes', JSON.stringify({ roofSlabs: roofs.length, faceAndEdgeProbes: probes }));
  }, 120_000);

  it.each([0, 8])('real wire fire at B6 y%s stops at the roof while same-floor fire still damages', (fromY) => {
    const sq = squad(), shooter = sq.session.slots[0]!, target = sq.session.slots[1]!;
    shooter.state = createMoveState(30, fromY, 268);
    target.state = createMoveState(30, fromY === 0 ? 8 : 0, 270);
    sq.say({ kind: 'Order', order: 'hold', address: { to: 'slot', index: 1 }, point: { x: 30, y: target.state.y, z: 270 }, target: null });
    sq.run(2);
    const eye = { x: shooter.state.x, y: shooter.state.y + DEFAULT_MUZZLE_RIG.eyeHeight, z: shooter.state.z };
    expect(sight({ eye, yaw: 0 }, { feet: target.state, stance: 'standing', speed: 0, firing: false }, world.boxes, getEnemy('rifleman').perception))
      .toMatchObject({ inRange: true, inCone: true, visible: false, exposure: 0 });
    const hp = target.health.current, dy = target.state.y + 1 - eye.y, dz = target.state.z - eye.z;
    sq.say({ kind: 'Fire', tick: sq.session.tick, yaw: 0,
      pitch: Math.round(Math.atan2(dy, dz) / (2 * Math.PI) * 4096) & 4095,
      renderTimeMs: sq.session.tick * TICK_MS, weapon: 0, ads: true });
    expect(sq.hits).toHaveLength(1); expect(sq.hits[0]!.targetNetId).toBe(0);
    expect(sq.hits[0]!.y).toBeCloseTo(fromY === 0 ? 5.5 : 8, 1);
    expect(target.health.current).toBe(hp);
    const centre = { x: 30, y: fromY === 0 ? 5.49 : 8.01, z: 270 };
    const def = getProjectile('rocket'), feet = { x: 30, y: fromY === 0 ? 8 : 0, z: 270 };
    expect(blastExposure(centre, feet, 1.8, world.boxes)).toBe(0);
    const base = blastDamageAt(def, Math.abs(feet.y + .9 - centre.y));
    expect(blastDamageOn(def, centre, feet, 1.8, world.boxes)).toBeCloseTo(base * def.blastCoverFraction, 8);
    target.state = createMoveState(30, fromY, 272);
    sq.say({ kind: 'Order', order: 'hold', address: { to: 'slot', index: 1 }, point: { x: 30, y: fromY, z: 272 }, target: null });
    sq.run(12);
    sq.say({ kind: 'Fire', tick: sq.session.tick, yaw: 0, pitch: 0, renderTimeMs: sq.session.tick * TICK_MS, weapon: 0, ads: true });
    expect(sq.hits.at(-1)!.targetNetId).toBe(target.netId);
    expect(target.health.current).toBeLessThan(hp);
  });

  it('real screen picks and wire move/hold retain basement, road and bridge feet', () => {
    const sq = squad();
    for (const at of [{ x: 30, z: 270, y: 0 }, { x: 30, z: 270, y: 8 }, { x: 70, z: 336, y: 16 }]) {
      const scene = scenery(at, 10);
      try {
        const camera = new THREE.PerspectiveCamera(60, 4 / 3, .1, 500);
        camera.position.set(at.x - 3, at.y + 1.6, at.z); camera.lookAt(at.x, at.y, at.z);
        const pick = pickOrder(screenRay(camera, { left: 0, top: 0, width: 400, height: 300 }, 200, 150, 8), scene.objects, undefined, { boxes: world.boxes, groundY: 0 });
        expect(pick.feet.y).toBeCloseTo(at.y, 5);
        for (const kind of ['move', 'hold'] as const) {
          const msg = buildOrder(kind, { to: 'slot', index: 1 }, { point: pick.point, feet: pick.feet,
            netId: null, enemy: false, downedMate: false, facing: null });
          expect(msg).not.toBeNull(); sq.say(msg!);
          expect(sq.orders.find((o) => o.slot === 1)?.point?.y).toBeCloseTo(at.y, 5);
        }
      } finally { scene.dispose(); }
    }
  });

  it('desktop/mobile camera arms stay inside every room and both covered stair systems at all view pitches', () => {
    // Independent §7.2 room/landing coordinates and exact ceiling heights.
    const views = [[-2, 8, 68, 12], [-2, 6, 81, 9.2], [8, 2, 91, 5.2], [-2, 0, 96, 3.6],
      [-20, 0, 120, 4.5], [-36, 0, 160, 5.5], [-18, 0, 200, 4.5], [8, 0, 232, 4],
      [30, 0, 270, 5.5], [-14, 0, 310, 4], [-14, 0, 346, 4], [-8, 0, 370, 3.6],
      [-8, 2, 381, 5.2], [2, 6, 381, 9.2], [2, 8, 376, 11.2], [30, 8, 270, Infinity], [70, 16, 336, Infinity]];
    let desktopBlocked = 0, mobileBlocked = 0, solves = 0;
    for (const [x, y, z, ceiling] of views) {
      const at = { x: x!, y: y!, z: z! }, scene = scenery(at);
      try {
        const collider = createSceneCollider(scene.objects);
        const clearArm = (solved: { position: { x: number; y: number; z: number }; focus: { x: number; y: number; z: number } }) => {
          const delta = new THREE.Vector3().subVectors(new THREE.Vector3().copy(solved.position), new THREE.Vector3().copy(solved.focus));
          expect(collider.cast(solved.focus, delta.clone().normalize(), delta.length()), `${x}/${y}/${z}`).toBeNull();
          expect(solved.position.y).toBeLessThan(ceiling!);
          solves++;
        };
        for (const yawWire of [0, 256, 512, 768]) for (const degrees of [-75, -55, -35, 0, 35, 55, 75]) {
          const view = { ...at, yawWire, pitchWire: degrees * 1024 / 360, pitchFraction: degrees / 89,
            ads: false, firstPerson: false, shoulderSide: 1 as const };
          const free = solveCamera(view, DEFAULT_CAMERA_CONFIG, createCameraSolve());
          const solved = solveCamera(view, DEFAULT_CAMERA_CONFIG, createCameraSolve(), 1 / 60, collider);
          desktopBlocked += solved.distance < free.distance ? 1 : 0; clearArm(solved);
        }
        for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) for (const pitch of [-1.15, -.8, -.35, 0, .15]) for (const distance of [5.5, 16.5, 33]) {
          const free = mobileOrbit(at, yaw, pitch, distance, 0), solved = mobileOrbit(at, yaw, pitch, distance, 0, collider);
          const length = (s: typeof free) => Math.hypot(s.position.x - s.focus.x, s.position.y - s.focus.y, s.position.z - s.focus.z);
          mobileBlocked += length(solved) < length(free) - 1e-6 ? 1 : 0; clearArm(solved);
        }
      } finally { scene.dispose(); }
    }
    expect(desktopBlocked).toBeGreaterThan(0); expect(mobileBlocked).toBeGreaterThan(0);
    console.log('U-173 actual scene camera paths', JSON.stringify({ locations: views.length, solves, desktopBlocked, mobileBlocked }));
  }, 120_000);
});
