import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ClientConnection, DEFAULT_MOVE_CONFIG, TICK_SECONDS, blockedAt, buildTree,
  createLoopbackPair, supportUnder, type Message, type SquadSpread,
} from '@sandline/shared';
import { createBrainRegistry } from '../../../server/src/ai/Brain.ts';
import { NavMesh, completePathLength, initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { Session } from '../../../server/src/session/Session.ts';
import { buildDepotWorld } from './qalatDepot.ts';
import { bakeRoadSupportNav } from './qalatRoadNav.ts';
import { inConvex, rectPolygon, type Point } from './planStrata.ts';
import { convexHull, ribbonPieces } from './roadSightLines.ts';

type Node = { id: string; x: number; y: number; z: number };
// Independent §7.2 transcription: visit evidence cannot follow a changed
// generator's own room, door or route register.
const ROUTE: Node[] = [
  ['D0', 32, 8, 64], ['loading-lane', 12, 8, 68], ['B0', -2, 8, 68], ['B0-upper', -2, 8, 76],
  ['B0-first-rest', -2, 6, 81], ['B0-switchback-west', -2, 4, 86], ['B0-switchback-east', 8, 4, 86],
  ['B0-second-rest', 8, 2, 91], ['B0-lower', 8, 0, 96], ['B1', -2, 0, 96],
  ['B1-B2', -20, 0, 96], ['B2', -20, 0, 120], ['B2-B3', -36, 0, 136],
  ['B3', -36, 0, 160], ['B3-B4', -36, 0, 188], ['B4', -18, 0, 200], ['B4-B5', 8, 0, 216],
  ['B5', 8, 0, 232], ['B5-B6-south', 8, 0, 250], ['B5-B6-east', 30, 0, 250], ['B6', 30, 0, 270],
  ['B6-B7-east', 30, 0, 298], ['B6-B7-west', -14, 0, 298], ['B7', -14, 0, 310],
  ['B7-B8', -14, 0, 330], ['B8', -14, 0, 346], ['B8-B9', -8, 0, 362], ['B9', -8, 0, 370],
  ['B10-lower', -8, 0, 376], ['B10-first-rest', -8, 2, 381], ['B10-switchback-west', -8, 4, 386],
  ['B10-switchback-east', 2, 4, 386], ['B10-second-rest', 2, 6, 381], ['B10-upper', 2, 8, 376], ['B10', 8, 8, 374],
].map(([id, x, y, z]) => ({ id: id as string, x: x as number, y: y as number, z: z as number }));
const ROOMS = [
  [-2, 96, 12, 12], [-20, 120, 20, 24], [-36, 160, 24, 32], [-18, 200, 20, 24],
  [8, 232, 16, 16], [30, 270, 28, 36], [-14, 310, 20, 20], [-14, 346, 20, 24], [-8, 370, 12, 12],
] as const;
// Actual doorway plane crossings, independently intersected from §7.2.
// All nine rooms contribute entry/exit portals, plus the two upper doors.
const roomIndices = [9, 11, 13, 15, 17, 20, 23, 25, 27];
const doors = ROOMS.flatMap(([x, z, w, d], i) => [-1, 1].map((side) => {
  const toward = ROUTE[roomIndices[i]! + side]!, dx = toward.x - x, dz = toward.z - z;
  const tx = dx ? w / 2 / Math.abs(dx) : Infinity, tz = dz ? d / 2 / Math.abs(dz) : Infinity;
  const t = Math.min(tx, tz);
  return { id: `B${i + 1}-${side < 0 ? 'in' : 'out'}`, x: x + t * dx, z: z + t * dz, y: 0, axis: tx < tz ? 'x' as const : 'z' as const };
}));
// The upper B10 west doorway meets the diagonal segment at z375⅓.
// Its room centre is (8,374); the inside west face is x4.
doors.push({ id: 'B0-east', x: 10, z: 68, y: 8, axis: 'x' },
  { id: 'B10-west', x: 4, z: 375 + 1 / 3, y: 8, axis: 'x' });
const rect = (x0: number, x1: number, z0: number, z1: number) => rectPolygon({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 });
const flatFloors = [
  ...ROOMS.map(([x, z, w, d]) => rect(x - w / 2, x + w / 2, z - d / 2, z + d / 2)),
  // Door masonry bevels extend a touching corridor piece by 0.6 m.
  // This admits that bounded widening, while exact door crossings and the
  // separate full-component escape proof retain the enclosure contract.
  ...ribbonPieces(ROUTE.slice(8, 29), 5.2),
  ...ROUTE.slice(8, 29).map((p) => rect(p.x - 2.6, p.x + 2.6, p.z - 2.6, p.z + 2.6)),
];
for (const [x, z, w, d] of ROOMS) for (const [i, a] of ROUTE.slice(9, 27).entries()) {
  const b = ROUTE[i + 10]!, dx = b.x - a.x, dz = b.z - a.z;
  for (const wallX of [x - w / 2, x + w / 2]) if (dx) {
    const t = (wallX - a.x) / dx, atZ = a.z + t * dz;
    if (t >= 0 && t <= 1 && atZ >= z - d / 2 && atZ <= z + d / 2)
      flatFloors.push(rect(wallX - 4, wallX + 4, atZ - 2, atZ + 2));
  }
  for (const wallZ of [z - d / 2, z + d / 2]) if (dz) {
    const t = (wallZ - a.z) / dz, atX = a.x + t * dx;
    if (t >= 0 && t <= 1 && atX >= x - w / 2 && atX <= x + w / 2)
      flatFloors.push(rect(atX - 2, atX + 2, wallZ - 4, wallZ + 4));
  }
}
const endpointFloors = [rect(-14, 10, 58, 78), rect(20, 44, 53, 75), rect(4, 12, 370, 378),
  rect(-4, 10, 82, 90), rect(-10, 4, 382, 390), rect(-1.2, 4, 372.4, 382),
  ...ribbonPieces(ROUTE.slice(0, 10), 4), ...ribbonPieces(ROUTE.slice(27), 4),
  ...ribbonPieces(ROUTE.slice(0, 3), 6)];
const grow = (poly: ReturnType<typeof rect>) => convexHull(poly.flatMap((p) => [-.08, .08].flatMap((dx) =>
  [-.08, .08].map((dz) => ({ x: p.x + dx, z: p.z + dz })))));
const flat = flatFloors.map(grow), endpoints = endpointFloors.map(grow);
const contains = (polys: typeof flat, p: Point) => polys.some((poly) => inConvex(poly, p));
const world = buildDepotWorld();
// A conservative movement broadphase for the real Session. Keep every exact
// generated solid touching the entire independent route plus four metres,
// at every elevation (including all roofs). The unchanged full world is baked
// and audited separately; bodies leaving this envelope fail on that tick.
const queryBounds = [...flatFloors, ...endpointFloors].map((poly) => ({
  minX: Math.min(...poly.map((p) => p.x)) - 4, maxX: Math.max(...poly.map((p) => p.x)) + 4,
  minZ: Math.min(...poly.map((p) => p.z)) - 4, maxZ: Math.max(...poly.map((p) => p.z)) + 4,
}));
const movementBoxes = world.boxes.filter((b) => queryBounds.some((a) => b.maxX >= a.minX && b.minX <= a.maxX
  && b.maxZ >= a.minZ && b.minZ <= a.maxZ));
const windows = new Map<string, typeof world.boxes>();
function nearby(p: Point) {
  const x = Math.floor(p.x / 4) * 4, z = Math.floor(p.z / 4) * 4, key = `${x}/${z}`;
  let boxes = windows.get(key);
  if (!boxes) {
    boxes = world.boxes.filter((b) => b.maxX >= x - 8 && b.minX <= x + 12 && b.maxZ >= z - 8 && b.minZ <= z + 12);
    windows.set(key, boxes);
  }
  return boxes;
}
let nav: NavMesh;
const yieldWorker = () => new Promise<void>((resolve) => setImmediate(resolve));

// Partition an independently specified route by arclength, then locate each
// actual body on it. This records rooms/turns/rests even when furniture makes
// a body flank the centreline. First entries must remain in exact order.
function stationRegions(nodes: Node[]) {
  const lengths = nodes.slice(1).map((b, i) => Math.hypot(b.x - nodes[i]!.x, b.y - nodes[i]!.y, b.z - nodes[i]!.z));
  const stations = [0];
  for (const length of lengths) stations.push(stations.at(-1)! + length);
  const boundaries = stations.slice(1).map((s, i) => (s + stations[i]!) / 2);
  return (p: Node | { x: number; y: number; z: number }) => {
    let distance = Infinity, station = 0;
    for (let i = 0; i < lengths.length; i++) {
      const a = nodes[i]!, b = nodes[i + 1]!, dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / lengths[i]! ** 2));
      const d = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy, p.z - a.z - t * dz);
      if (d < distance) { distance = d; station = stations[i]! + t * lengths[i]!; }
    }
    const index = boundaries.findIndex((s) => station < s);
    return index < 0 ? nodes.length - 1 : index;
  };
}

describe('U-173 complete furnished depot with seven actual Session actors', () => {
  beforeAll(async () => { await initNav(); nav = NavMesh.load(await bakeRoadSupportNav(world)); }, 240_000);
  afterAll(() => nav?.destroy());

  for (const reverse of [false, true]) for (const spread of ['tight', 'standard', 'wide'] satisfies SquadSpread[])
    it(`${reverse ? 'B10→D0' : 'D0→B10'} at ${spread}: every soldier and POW traverses every route region`, async () => {
      // Movement-only construction fixture. All route solids, standing
      // nav, normal Session AI, avoidance, body separation and orders remain.
      // No encounter, tank activation, objective progression or human verdict.
      const nodes = reverse ? [...ROUTE].reverse() : ROUTE, first = nodes[0]!, last = nodes.at(-1)!;
      const squadStarts = Array.from({ length: 6 }, (_, index) => ({ x: first.x + (index % 2 ? .8 : -.8),
        y: first.y, z: first.z + (Math.floor(index / 2) - 1) * 1.2 }));
      const session = new Session(undefined, '', { ...world, boxes: movementBoxes, squadStarts }, {
        navMesh: nav, brainTree: buildTree('friendly', createBrainRegistry()), testHumanCount: 0,
      });
      const pair = createLoopbackPair();
      session.addConnection(pair.a, 0);
      const client = new ClientConnection(pair.b, {});
      client.join('depot commander'); pair.settle();
      const send = (message: Message) => { client.send(message); pair.settle(); };
      // Set every slot via ordinary commander authority, including the seat
      // later driven by spectator AI. No private preset/brain mutation.
      send({ kind: 'Spread', address: { to: 'all' }, spread });
      send({ kind: 'SwitchCharacter', slot: 1 });
      send({ kind: 'Spread', address: { to: 'all' }, spread });
      send({ kind: 'SwitchCharacter', slot: 1, spectate: true });
      expect(session.slots.map((s) => session.spreadFor(s.index))).toEqual(Array(6).fill(spread));
      for (const slot of session.slots) {
        const x = first.x + (slot.index % 2 ? .8 : -.8), z = first.z + (Math.floor(slot.index / 2) - 1) * 1.2;
        expect(slot.state).toMatchObject({ x, y: first.y, z });
        expect(blockedAt(x, z, DEFAULT_MOVE_CONFIG.radius, first.y, .05, DEFAULT_MOVE_CONFIG.height, nearby(slot.state))).toBe(false);
      }
      expect(session.spawnEnemy('pow', { x: first.x + 2.2, y: first.y, z: first.z, authoredHeight: true })).not.toBeNull();
      const pow = session.enemies[0]!;
      const bodies = [...session.slots, pow], regions = bodies.map(() => [] as number[]), locate = stationRegions(nodes);
      const record = () => bodies.forEach((body, i) => {
        const index = locate(body.state), trace = regions[i]!;
        if (trace.at(-1) !== index) trace.push(index);
      });
      const crossed = bodies.map(() => new Set<string>());
      record();
      let ticks = 0;
      const advance = async () => {
        const before = bodies.map((b) => b.state);
        if (ticks % 30 === 0) send({ kind: 'Ping', id: ticks, clientTime: ticks * TICK_SECONDS * 1000 });
        session.step((session.tick + 1) * TICK_SECONDS * 1000); pair.settle(); ticks++;
        for (const [i, body] of bodies.entries()) {
          const p = body.state, previous = before[i]!, label = `${spread}/${reverse}/actor${i}/${ticks} ${JSON.stringify(p)}`;
          expect(p.vault, label).toBeNull();
          expect(p.crouched || p.prone, label).toBe(false);
          expect(Math.abs(p.y - before[i]!.y), `${label}: floor snap/drop`).toBeLessThanOrEqual(DEFAULT_MOVE_CONFIG.stepHeight + 1e-6);
          expect(contains(flat, p) || contains(endpoints, p), `${label}: left independent depot envelope`).toBe(true);
          if (!contains(endpoints, p)) expect(p.y, `${label}: left basement floor`).toBeCloseTo(0, 6);
          expect(blockedAt(p.x, p.z, DEFAULT_MOVE_CONFIG.radius, p.y, DEFAULT_MOVE_CONFIG.stepHeight,
            DEFAULT_MOVE_CONFIG.height, nearby(p)), `${label}: inside structure`).toBe(false);
          const support = supportUnder(p.x, p.z, DEFAULT_MOVE_CONFIG.radius, p.y + .01, nearby(p), 0);
          // Running down ordinary 0.20/0.40 stairs is briefly ballistic.
          // Bound the gap by one step plus the maximum separation from a
          // 1:2 descending profile under ordinary gravity, at the fastest
          // soldier's sprint. A missing floor or a storey drop exceeds it.
          const descentSpeed = DEFAULT_MOVE_CONFIG.sprintSpeed * 1.1 / 2;
          const maximumGap = DEFAULT_MOVE_CONFIG.stepHeight + descentSpeed ** 2 / (-2 * DEFAULT_MOVE_CONFIG.gravity);
          expect(p.y - support, `${label}: lost supported storey`).toBeLessThanOrEqual(maximumGap + 1e-6);
          // Body separation can move feet across an adjacent tread after the
          // controller has resolved y; the following tick settles that one
          // ordinary step. It must never change to a different storey.
          if (p.grounded) expect(Math.abs(p.y - support), `${label}: grounded support`).toBeLessThanOrEqual(DEFAULT_MOVE_CONFIG.stepHeight + 1e-6);
          for (const door of doors) {
            const a = previous[door.axis] - door[door.axis], b = p[door.axis] - door[door.axis];
            if (a * b > 0 || Math.abs(a - b) < 1e-9) continue;
            const t = a / (a - b), across = door.axis === 'x' ? 'z' : 'x';
            const lateral = previous[across] + t * (p[across] - previous[across]);
            const y = previous.y + t * (p.y - previous.y);
            if (Math.abs(lateral - door[across]) < 2.05 && y >= door.y - .200001 && y <= door.y + maximumGap) crossed[i]!.add(door.id);
          }
          expect(body.health.current, `${label}: movement fixture lost actor`).toBe(body.health.max);
        }
        for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i]!.state, b = bodies[j]!.state;
          if (a.y < b.y + DEFAULT_MOVE_CONFIG.height && b.y < a.y + DEFAULT_MOVE_CONFIG.height)
            expect(Math.hypot(a.x - b.x, a.z - b.z), `actors ${i}/${j} overlap at tick ${ticks}`)
              .toBeGreaterThanOrEqual(2 * DEFAULT_MOVE_CONFIG.radius - 1e-6);
        }
        record();
        if (ticks % 128 === 0) await yieldWorker();
      };
      // Natural regroup rooms from GEO-06. Intermediate corridor and stair
      // nodes are never imposed on any follower: their traces must discover
      // all of them using real pathfinding to these normal squad orders.
      const stops = [
        { id: 'B3', x: -36, y: 0, z: 158 }, { id: 'B5', x: reverse ? 7 : 10, y: 0, z: reverse ? 228 : 232 },
        { id: 'B6', x: 30, y: 0, z: 270 }, { id: 'B7', x: -14, y: 0, z: 310 },
      ];
      if (reverse) stops.reverse();
      // Put the outward destination inside the far half of the 8×8 porch,
      // leaving space for Wide's trailing destinations to emerge from B10.
      const destination = reverse ? last : { ...last, x: 9, z: 376 };
      for (const goal of [...stops, destination]) {
        send({ kind: 'Order', order: 'move', address: { to: 'all' }, point: goal, target: null });
        for (const slot of session.slots) {
          const asked = session.orderFor(slot.index)?.point;
          expect(asked, `${goal.id}/actor${slot.index} lost wire order`).toBeDefined();
          expect(Math.abs(asked!.y - goal.y), `${goal.id}/actor${slot.index} wrong order storey`).toBeLessThanOrEqual(.05002);
          const path = nav.path(slot.state, asked!);
          expect(completePathLength(path, slot.state, asked!), `${goal.id}/actor${slot.index} incomplete order`).not.toBeNull();
          expect(path!.vaults).toEqual([]);
        }
        let arrived = false, bestDistance = Infinity, stalled = 0;
        for (let tick = 0; tick < 7200; tick++) {
          await advance();
          // GEO-06 asks the whole group to reach the clear regroup pocket,
          // then halt. It does not require seven actors to finish a tightly
          // packed move-order pattern before the commander may issue Hold.
          arrived = goal === destination ? bodies.every((b) => Math.abs(b.state.y - 8) < .05 && locate(b.state) === nodes.length - 1
            && (reverse ? b.state.x >= 20.35 && b.state.x <= 43.65 && b.state.z >= 53.35 && b.state.z <= 74.65
              : b.state.x >= 4.35 && b.state.x <= 11.65 && b.state.z >= 370.35 && b.state.z <= 377.65))
            : bodies.every((b) => {
              const room = ROOMS[Number(goal.id.slice(1)) - 1]!;
              const inRoom = Math.abs(b.state.x - room[0]) <= room[2] / 2 - .35
                && Math.abs(b.state.z - room[1]) <= room[3] / 2 - .35;
              // B5 has an exact approved 8×8 regroup pocket; the other
              // named regroup rooms retain their full furnished floor.
              const inPocket = goal.id !== 'B5' || b.state.x >= 5 && b.state.x <= 13 && b.state.z >= 226 && b.state.z <= 234;
              return Math.abs(b.state.y) < .05 && inRoom && inPocket && locate(b.state) === nodes.findIndex((n) => n.id === goal.id);
            });
          if (arrived) break;
          const distance = bodies.reduce((sum, b) => sum + Math.hypot(b.state.x - goal.x, b.state.y - goal.y, b.state.z - goal.z), 0);
          if (distance < bestDistance - .1) { bestDistance = distance; stalled = 0; } else stalled++;
          if (stalled > 900) break;
        }
        expect(arrived, `${goal.id}: stranded actors ${JSON.stringify(bodies.map((b) => b.state))}; orders ${JSON.stringify(session.slots.map((s) => session.orderFor(s.index)))}; reports ${JSON.stringify(session.orderReports)}`).toBe(true);
        console.log('U-173 group arrival', JSON.stringify({ reverse, spread, room: goal.id, ticks }));
        expect(session.orderReports.filter((r) => r.outcome === 'failed'), goal.id).toEqual([]);
        if (goal !== destination) {
          const room = ROOMS[Number(goal.id.slice(1)) - 1]!;
          send({ kind: 'Order', order: 'hold', address: { to: 'all' }, point: null, target: null });
          for (let tick = 0; tick < 30; tick++) await advance();
          for (const b of bodies) {
            expect(b.state.y, `${goal.id} regroup floor`).toBe(0);
            expect(Math.abs(b.state.x - room[0]), `${goal.id} regroup x`).toBeLessThan(room[2] / 2);
            expect(Math.abs(b.state.z - room[1]), `${goal.id} regroup z`).toBeLessThan(room[3] / 2);
          }
        }
      }
      send({ kind: 'Order', order: 'hold', address: { to: 'all' }, point: null, target: null });
      for (let tick = 0; tick < 30; tick++) await advance();
      for (const [i, trace] of regions.entries()) {
        expect([...crossed[i]!].sort(), `actor${i} missed a doorway`).toEqual(doors.map((d) => d.id).sort());
        expect([...new Set(trace)], `actor${i} missed/reordered room, corridor or stair region: ${trace}`).toEqual(nodes.map((_, i) => i));
        for (let j = 1; j < trace.length; j++) expect(Math.abs(trace[j]! - trace[j - 1]!), `actor${i} skipped region`).toBeLessThanOrEqual(1);
      }
      expect(bodies.every((b) => b.state.grounded), 'all seven settled on the endpoint floor').toBe(true);
      expect(bodies.every((b) => Math.abs(b.state.y - 8) < .05), 'all seven emerged onto the endpoint floor').toBe(true);
      console.log('U-173 actual Session seven-actor depot', JSON.stringify({ direction: reverse ? 'B10→D0' : 'D0→B10',
        spread, ticks, seconds: ticks * TICK_SECONDS, sourceSolids: world.boxes.length, movementSolids: movementBoxes.length, actors: bodies.length, regionsPerActor: regions.map((r) => new Set(r).size),
        doorwaysPerActor: crossed.map((d) => d.size), regroupRooms: stops.map((s) => s.id), failedOrders: session.orderReports.filter((r) => r.outcome === 'failed').length }));
      pair.b.close('fixture complete'); pair.settle();
    }, 360_000);
});
