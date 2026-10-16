import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ClientConnection, DEFAULT_MOVE_CONFIG, TICK_SECONDS, blockedAt, buildTree,
  createLoopbackPair, supportUnder, type Message, type SquadSpread,
} from '@sandline/shared';
import { createBrainRegistry } from '../../../server/src/ai/Brain.ts';
import { NavMesh, completePathLength, initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { Session } from '../../../server/src/session/Session.ts';
import { buildOutpostWorld } from './qalatOutpost.ts';
import { bakeRoadSupportNav } from './qalatRoadNav.ts';

type Point = { x: number; y: number; z: number };
type Rect = { x0: number; x1: number; z0: number; z1: number };
const rect = (x0: number, x1: number, z0: number, z1: number): Rect => ({ x0, x1, z0, z1 });
const inside = (p: Point, r: Rect, inset = 0) => p.x >= r.x0 + inset && p.x <= r.x1 - inset
  && p.z >= r.z0 + inset && p.z <= r.z1 - inset;
const at = (x: number, z: number): Point => ({ x, y: 8, z });
// Independent §§8.1/16.1 transcription. No generated gate/room/floor register
// is used to decide where a body may walk or which portal it crossed.
const COURT = rect(8, 56, 356, 412), REGROUP = rect(30.5, 44, 368, 382);
const FLOORS = [COURT, rect(28, 36, 346, 356), rect(1, 8, 372, 378),
  rect(52, 60, 368, 374), rect(56, 61, 370, 376)];
const joins = [
  { id: 'south', axis: 'z', faces: [355, 356], centre: 32, half: 4, outside: rect(28, 36, 346, 355),
    goal: at(34, 348), starts: [at(32.8, 348), at(34, 348), at(32.8, 349.2), at(34, 349.2), at(32.8, 350.4), at(34, 350.4)], pow: at(31.5, 349.2) },
  { id: 'west', axis: 'x', faces: [7, 8], centre: 374, half: 2, outside: rect(1, 7, 372, 378),
    goal: at(3, 375), starts: [at(5, 373), at(6.2, 373), at(5, 374.2), at(6.2, 374.2), at(5, 375.4), at(6.2, 375.4)], pow: at(3.8, 375) },
  { id: 'east', axis: 'x', faces: [56, 57], centre: 374, half: 2, outside: rect(57, 61, 370, 376),
    goal: at(59.5, 374), starts: [at(58, 372.6), at(59.2, 372.6), at(58, 373.8), at(59.2, 373.8), at(58, 375), at(59.2, 375)], pow: at(60.3, 374.5) },
] as const;
const courtStarts = [at(35, 374), at(36.2, 374), at(35, 375.2), at(36.2, 375.2), at(35, 376.4), at(36.2, 376.4)];
const HOLDINGS = [at(16, 402), at(12, 400), at(20, 400), at(12, 404), at(20, 404), at(12, 408)];
const world = buildOutpostWorld();
// A conservative movement broadphase only: retain every exact solid at every
// elevation touching the independent footprint plus four metres. The standing
// bake uses the complete construction, including its inherited approaches.
const movementBoxes = world.boxes.filter((b) => FLOORS.some((r) => b.maxX >= r.x0 - 4 && b.minX <= r.x1 + 4
  && b.maxZ >= r.z0 - 4 && b.minZ <= r.z1 + 4));
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

function connect(session: Session) {
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  const client = new ClientConnection(pair.b, {});
  client.join('outpost commander'); pair.settle();
  const send = (message: Message) => { client.send(message); pair.settle(); };
  return { pair, send };
}

describe('U-221 furnished outpost joins with six Session soldiers and an escorted POW', () => {
  beforeAll(async () => { await initNav(); nav = NavMesh.load(await bakeRoadSupportNav(world)); }, 240_000);
  afterAll(() => nav?.destroy());

  it('retains six real holding bodies and reaches each individual rescue stand through the antechamber', async () => {
    const session = new Session(undefined, '', { ...world, boxes: movementBoxes,
      squadStarts: Array.from({ length: 6 }, (_, i) => at(16 + i, 392)) }, {
      navMesh: nav, brainTree: buildTree('friendly', createBrainRegistry()), testHumanCount: 0,
    });
    const { pair, send } = connect(session);
    try {
      send({ kind: 'SwitchCharacter', slot: 0, spectate: true });
      for (let i = 1; i < HOLDINGS.length; i++) expect(session.captureCharacter(i, HOLDINGS[i]!)).toBe(true);
      expect(session.spawnEnemy('pow', { ...HOLDINGS[0]!, captive: true, authoredHeight: true })).not.toBeNull();
      const held = [session.enemies[0]!, ...session.slots.slice(1)], rescuer = session.slots[0]!;
      expect(held).toHaveLength(6);
      expect(session.slots.filter((s) => s.captured)).toHaveLength(5);
      for (const [i, captive] of held.entries()) {
        const p = captive.state;
        expect(p).toMatchObject(HOLDINGS[i]!);
        expect(blockedAt(p.x, p.z, DEFAULT_MOVE_CONFIG.radius, 8, .05, DEFAULT_MOVE_CONFIG.height, nearby(p))).toBe(false);
        expect(supportUnder(p.x, p.z, DEFAULT_MOVE_CONFIG.radius, 8.01, nearby(p), 0)).toBeCloseTo(8, 6);
        for (const other of held.slice(i + 1)) expect(Math.hypot(p.x - other.state.x, p.z - other.state.z)).toBeGreaterThanOrEqual(2 * DEFAULT_MOVE_CONFIG.radius);
      }
      const stands = [at(16, 400.8), at(13.2, 400), at(18.8, 400), at(13.2, 404), at(18.8, 404), at(13.2, 408)];
      let ticks = 0;
      for (const [i, stand] of stands.entries()) {
        // Return through the independently specified doorway before each
        // approach. No teleport, added soldier or automatic rescue is used.
        for (const goal of [at(16, 392), stand]) {
          send({ kind: 'Order', order: 'move', address: { to: 'slot', index: 0 }, point: goal, target: null });
          const path = nav.path(rescuer.state, goal);
          expect(completePathLength(path, rescuer.state, goal), `holding${i}: incomplete access`).not.toBeNull();
          expect(path!.vaults).toEqual([]);
          let arrived = false;
          for (let tick = 0; tick < 1200; tick++) {
            if (ticks % 30 === 0) send({ kind: 'Ping', id: ticks, clientTime: ticks * TICK_SECONDS * 1000 });
            session.step((session.tick + 1) * TICK_SECONDS * 1000); pair.settle(); ticks++;
            const p = rescuer.state;
            expect(p.y).toBeCloseTo(8, 6); expect(p.vault).toBeNull();
            expect(p.crouched || p.prone).toBe(false);
            expect(inside(p, rect(10, 22, 386, 410)), 'left the ante/cell access').toBe(true);
            expect(blockedAt(p.x, p.z, DEFAULT_MOVE_CONFIG.radius, 8, .05, DEFAULT_MOVE_CONFIG.height, nearby(p))).toBe(false);
            expect(supportUnder(p.x, p.z, DEFAULT_MOVE_CONFIG.radius, 8.01, nearby(p), 0)).toBeCloseTo(8, 6);
            for (const [j, captive] of held.entries()) {
              expect(captive.state).toMatchObject(HOLDINGS[j]!);
              expect(Math.hypot(p.x - captive.state.x, p.z - captive.state.z), `holding${i}: walked through captive${j}`)
                .toBeGreaterThanOrEqual(2 * DEFAULT_MOVE_CONFIG.radius - 1e-6);
            }
            arrived = Math.hypot(p.x - goal.x, p.z - goal.z) < .55;
            if (arrived) break;
            if (ticks % 128 === 0) await yieldWorker();
          }
          expect(arrived, `holding${i}: stranded rescuer ${JSON.stringify(rescuer.state)}`).toBe(true);
        }
        const captive = held[i]!;
        expect(Math.hypot(rescuer.state.x - captive.state.x, rescuer.state.z - captive.state.z), `holding${i}: beyond ordinary rescue reach`).toBeLessThan(2);
      }
      expect(session.enemies[0]!.captive).toBe(true);
      expect(session.slots.filter((s) => s.captured)).toHaveLength(5);
      expect(session.orderReports.filter((r) => r.outcome === 'failed')).toEqual([]);
    } finally { pair.b.close('fixture complete'); pair.settle(); }
  }, 120_000);

  for (const join of joins) for (const outward of [false, true])
    for (const spread of ['tight', 'standard', 'wide'] satisfies SquadSpread[])
      it(`${join.id} ${outward ? 'outward' : 'inward'} at ${spread}: seven bodies cross the legal door and regroup`, async () => {
        const starts = outward ? courtStarts : join.starts;
        const session = new Session(undefined, '', { ...world, boxes: movementBoxes, squadStarts: starts.map((p) => ({ ...p })) }, {
          navMesh: nav, brainTree: buildTree('friendly', createBrainRegistry()), testHumanCount: 0,
        });
        const { pair, send } = connect(session);
        try {
          // Ordinary commander authority reaches the current seat too after
          // switching to spectator AI, as in the accepted depot fixture.
          send({ kind: 'Spread', address: { to: 'all' }, spread });
          send({ kind: 'SwitchCharacter', slot: 1 });
          send({ kind: 'Spread', address: { to: 'all' }, spread });
          send({ kind: 'SwitchCharacter', slot: 1, spectate: true });
          expect(session.slots.map((s) => session.spreadFor(s.index))).toEqual(Array(6).fill(spread));
          const powStart = outward ? at(38, 375.2) : join.pow;
          expect(session.spawnEnemy('pow', { ...powStart, authoredHeight: true })).not.toBeNull();
          const pow = session.enemies[0]!;
          expect(pow.captive).toBe(false);
          const bodies = [...session.slots, pow], crossings = bodies.map(() => new Set<number>());
          const traces = bodies.map(() => [] as number[]);
          const axis = join.axis, across = axis === 'x' ? 'z' : 'x';
          const stage = (p: Point) => {
            const value = p[axis];
            const physical = value < join.faces[0] ? 0 : value > join.faces[1] ? 2 : 1;
            return (join.id === 'east') !== outward ? 2 - physical : physical;
          };
          const record = () => bodies.forEach((b, i) => {
            const index = stage(b.state), trace = traces[i]!;
            if (trace.at(-1) !== index) trace.push(index);
          });
          const checkBodies = () => {
            for (const [i, b] of bodies.entries()) {
              const p = b.state, label = `${join.id}/${outward}/${spread}/actor${i} ${JSON.stringify(p)}`;
              expect(p.y, `${label}: changed storey`).toBeCloseTo(8, 6);
              expect(p.vault, `${label}: vaulted`).toBeNull();
              expect(p.crouched || p.prone, `${label}: nonstanding route`).toBe(false);
              expect(FLOORS.some((r) => inside(p, r)), `${label}: unlisted approach or annex`).toBe(true);
              expect(blockedAt(p.x, p.z, DEFAULT_MOVE_CONFIG.radius, p.y, .05,
                DEFAULT_MOVE_CONFIG.height, nearby(p)), `${label}: intersects construction`).toBe(false);
              expect(supportUnder(p.x, p.z, DEFAULT_MOVE_CONFIG.radius, p.y + .01, nearby(p), 0), `${label}: lost floor`).toBeCloseTo(8, 6);
              expect(b.health.current, `${label}: lost actor`).toBe(b.health.max);
            }
            for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
              const a = bodies[i]!.state, b = bodies[j]!.state;
              expect(Math.hypot(a.x - b.x, a.z - b.z), `actors ${i}/${j} overlap`)
                .toBeGreaterThanOrEqual(2 * DEFAULT_MOVE_CONFIG.radius - 1e-6);
            }
          };
          checkBodies(); record();
          let ticks = 0;
          const advance = async () => {
            const before = bodies.map((b) => b.state);
            if (ticks % 30 === 0) send({ kind: 'Ping', id: ticks, clientTime: ticks * TICK_SECONDS * 1000 });
            session.step((session.tick + 1) * TICK_SECONDS * 1000); pair.settle(); ticks++;
            checkBodies(); record();
            for (const [i, body] of bodies.entries()) for (const face of join.faces) {
              const a = before[i]!, b = body.state, from = a[axis] - face, to = b[axis] - face;
              if (from * to > 0 || Math.abs(from - to) < 1e-9) continue;
              const t = from / (from - to), lateral = a[across] + t * (b[across] - a[across]);
              // Crossing either masonry face outside the authored opening is
              // an immediate failure, not merely absent doorway evidence.
              expect(Math.abs(lateral - join.centre), `${join.id}: crossed solid gate wall`).toBeLessThanOrEqual(join.half + .000001);
              crossings[i]!.add(face);
            }
            if (ticks % 128 === 0) await yieldWorker();
          };
          const goal = outward ? join.goal : at(37, 375.5), pocket = outward ? join.outside : REGROUP;
          send({ kind: 'Order', order: 'move', address: { to: 'all' }, point: goal, target: null });
          const initialDestinations = session.slots.map((s) => session.orderFor(s.index)?.point);
          for (const soldier of session.slots) {
            const asked = session.orderFor(soldier.index)?.point;
            expect(asked, 'wire move did not reach every soldier').toBeDefined();
            expect(Math.abs(asked!.y - 8), 'order changed floors').toBeLessThanOrEqual(.05002);
            const path = nav.path(soldier.state, asked!);
            expect(completePathLength(path, soldier.state, asked!), 'incomplete standing order').not.toBeNull();
            expect(path!.vaults).toEqual([]);
            expect(path!.points.every((p) => FLOORS.some((r) => inside(p, r))), 'planned an unlisted route').toBe(true);
          }
          let arrived = false, best = Infinity, stalled = 0;
          for (let tick = 0; tick < 3600; tick++) {
            if (outward && join.id !== 'south' && tick === 150) {
              // The ordinary all-squad pattern trails behind its point. On
              // these short side pads it can assign destinations inside the
              // gate. A commander stages each soldier on a distinct exterior
              // stand with normal wire orders; no body is moved by the test.
              console.log('U-221 ordinary side-pad staging', JSON.stringify({ join: join.id, spread, initialDestinations }));
              const powGoal = join.id === 'west' ? at(5.5, 376.7) : at(59.5, 371.2);
              send({ kind: 'Order', order: 'move', address: { to: 'all' }, point: powGoal, target: null });
              const stands = join.id === 'west' ? [at(4.7, 373), at(6.2, 373), at(4.7, 374.5), at(6.2, 374.5), at(2, 375), at(3.5, 375)]
                : [at(58, 372.5), at(59.5, 372.5), at(58, 374), at(59.5, 374), at(58, 375.5), at(59.5, 375.5)];
              for (const [i, point] of stands.entries()) {
                const soldier = session.slots[i]!, path = nav.path(soldier.state, point);
                expect(completePathLength(path, soldier.state, point), `actor${i}: incomplete exterior stand`).not.toBeNull();
                expect(path!.vaults).toEqual([]);
                send({ kind: 'Order', order: 'move', address: { to: 'slot', index: i }, point, target: null });
              }
              stalled = 0; best = Infinity;
            }
            await advance();
            // Group arrival and Hold are the construction contract. Packed
            // move-pattern completion remains the separate U-174 task.
            arrived = bodies.every((b) => inside(b.state, pocket, DEFAULT_MOVE_CONFIG.radius) && stage(b.state) === 2);
            if (arrived) break;
            const distance = bodies.reduce((sum, b) => sum + Math.hypot(b.state.x - goal.x, b.state.z - goal.z), 0);
            if (distance < best - .1) { best = distance; stalled = 0; } else stalled++;
            if (stalled > 900) break;
          }
          expect(arrived, `stranded at ${JSON.stringify(bodies.map((b) => b.state))}; orders ${JSON.stringify(session.slots.map((s) => session.orderFor(s.index)))}; reports ${JSON.stringify(session.orderReports)}`).toBe(true);
          send({ kind: 'Order', order: 'hold', address: { to: 'all' }, point: null, target: null });
          for (let tick = 0; tick < 30; tick++) await advance();
          for (const [i, body] of bodies.entries()) {
            expect(inside(body.state, pocket, DEFAULT_MOVE_CONFIG.radius), `actor${i}: left regroup hold`).toBe(true);
            expect(body.state.grounded, `actor${i}: unsupported hold`).toBe(true);
            expect([...crossings[i]!].sort(), `actor${i}: missed gate face`).toEqual([...join.faces].sort());
            expect([...new Set(traces[i]!)], `actor${i}: missed/reordered outside, doorway or court`).toEqual([0, 1, 2]);
            for (let j = 1; j < traces[i]!.length; j++) expect(Math.abs(traces[i]![j]! - traces[i]![j - 1]!)).toBeLessThanOrEqual(1);
          }
          expect(session.orderReports.filter((r) => r.outcome === 'failed')).toEqual([]);
          console.log('U-221 outpost seven-actor join', JSON.stringify({ join: join.id, outward, spread, ticks, actors: bodies.length,
            sourceSolids: world.boxes.length, movementSolids: movementBoxes.length, crossedFacesPerActor: crossings.map((c) => c.size) }));
        } finally { pair.b.close('fixture complete'); pair.settle(); }
      }, 180_000);
});
