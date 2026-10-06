import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type EncounterSocket, buildTree, createMoveState, loadWorld, parseEncounter, parseEventScript, parseMission, parseTreeDef, regionContains, rememberSeen, DAMAGE, requireWorld, TICK_SECONDS } from '@sandline/shared';
import { Brain, createBrainRegistry } from '../../../server/src/ai/Brain.ts';
import { BoundedRegion } from '../../../server/src/ai/nav/BoundedRegion.ts';
import { initNav, NavMesh, completePathLength } from '../../../server/src/ai/nav/NavMesh.ts';
import { Session } from '../../../server/src/session/Session.ts';
import { parseCheckpointWorld } from '../../../server/src/session/checkpointWorld.ts';
import type { CampaignState } from '../../../server/src/persistence/CampaignDatabase.ts';
import { bakeWorld, DEFAULT_NAV_AGENT, onMesh } from './bake.ts';
import { coverPoints } from './cover.ts';
import type { CoverPoint } from '../../../server/src/ai/nav/baked/types.ts';

const world = loadWorld({ id: 'bounded-patrol', floor: { halfExtent: 30 }, cover: [
  { id: 'surface', x: 0, y: 5.5, z: 0, w: 16, d: 16, h: 2.5 },
  { id: 'bridge', x: 0, y: 14, z: 0, w: 10, d: 10, h: 2 },
  ...[0, 8, 16].map((y) => ({ id: `crate-${y}`, x: 3, y, z: 3, w: 1.2, d: 1.2, h: 1.2 })),
  ...Array.from({ length: 20 }, (_, i) => ({ id: `step-${i}`, x: 17.75 - i * .5, y: 0, z: 0, w: .5, d: 3, h: (i + 1) * .4 })),
], mission: { ...requireWorld('greybox-01').mission!, spawnZones: [{ id: 'z', on: 'objective', x: 25, z: 25, radius: .1 }] } });
const prism = (y: number, minX = -7, maxX = 7) => ({ minX, maxX, minZ: -7, maxZ: 7, minY: y - .3, maxY: y + .3 });
const regions = { basement: [prism(0)], surface: [prism(8)], bridge: [prism(16, -4, 4)] };
const socket = (id: string, x: number, y: number, z: number, combatRegion: string) => ({ id, archetype: 'rifleman', feet: { x, y, z }, face: { x: 0, z: -6 }, combatRegion });
const sockets: EncounterSocket[] = [
  { ...socket('patrol', -4, 0, -4, 'basement'), patrol: { route: [{ x: -4, y: 0, z: -4 }, { x: -4, y: 0, z: 4 }, { x: 0, y: 0, z: 4 }], pauseSeconds: 3 } },
  socket('hold', 4, 0, -4, 'basement'), socket('upper', 0, 8, -4, 'surface'), socket('bridge', 0, 16, -4, 'bridge'),
];
const raw = { world: world.id, aliveCap: 4, probes: [1], areas: {}, regions, groups: [{ id: 'g', zone: 'z', members: [{ archetype: 'rifleman', count: 4 }], sockets, posture: { kind: 'hold' }, trigger: { kind: 'start' } }] };
const encounter = parseEncounter(raw, () => world);
const mission = parseMission({ id: world.id, world: world.id, respawn: false, objectives: [{ type: 'survive', label: 'Wait', seconds: 3600 }] });
const events = parseEventScript({ world: world.id, blockers: [], events: [{ id: 'start', trigger: { kind: 'time', seconds: 0 }, actions: [{ kind: 'spawn-group', group: 'g' }] }] }, encounter, world, mission);
const ease = buildTree(parseTreeDef({ id: 'fixture-at-ease', root: { type: 'action', name: 'atEase' } }), createBrainRegistry());
let mesh: NavMesh;
let cover: readonly CoverPoint[];
beforeAll(async () => { await initNav(); mesh = NavMesh.load(await bakeWorld(world)); cover = coverPoints(world, DEFAULT_NAV_AGENT, (p) => onMesh(mesh, p, DEFAULT_NAV_AGENT.climb)); });
afterAll(() => mesh.destroy());
function play(campaign?: CampaignState) {
  const saves: CampaignState[] = [];
  const session = new Session(undefined, '', world, { encounter, mission, events, navMesh: mesh, cover, testHumanCount: 1, ...(campaign ? { campaign } : {}), onCampaignSave: (c) => saves.push(c) });
  let now = 0;
  const step = (n = 1) => { for (let i = 0; i < n; i++) session.step(now += TICK_SECONDS * 1000); };
  if (!campaign) step();
  for (const e of session.enemies) {
    if (!campaign) { e.state = createMoveState(e.posture!.post.x, e.posture!.post.y, e.posture!.post.z); e.posture!.leg = 0; if (e.posture!.patrol) e.posture!.patrol!.pauseTicks = 0; }
    e.brain = new Brain(e, ease); e.brain.think(0);
  }
  const guard = session.enemies.find((e) => e.spawnId === 'patrol')!;
  return { session, saves, step, guard, capture: () => (session as unknown as { captureMissionCheckpoint(): void }).captureMissionCheckpoint() };
}
describe('real bounded navigation (U-130)', () => {
  it('uses nav connectivity and exact region geometry, preserving the other floors and blocker flags', () => {
    const lower = new BoundedRegion(regions.basement, mesh);
    const a = { x: 0, y: 0, z: -3 }, b = { x: 0, y: 0, z: 3 };
    expect(lower.path(a, b)).not.toBeNull();
    expect(completePathLength(mesh.path(a, { x: 0, y: 8, z: -3 }), a, { x: 0, y: 8, z: -3 })).not.toBeNull();
    expect(lower.path(a, { x: 0, y: 8, z: -3 })).toBeNull();
    expect(lower.path(a, { x: 0, y: 0, z: -15 }, 64)).toBeNull();
    const disconnected = new BoundedRegion([...regions.basement, ...regions.bridge], mesh);
    expect(disconnected.path(a, { x: 0, y: 16, z: -3 })).toBeNull();
    expect(() => mesh.within(new Set(), () => { throw new Error('query failed'); })).toThrow(/query failed/);
    for (const y of [0, 8, 16]) expect(mesh.nearestPoint({ x: 0, y, z: -3 })).not.toBeNull();
    const block = { minX: -8, maxX: 8, minZ: -8, maxZ: 8, minY: 8, maxY: 10 };
    mesh.setBlocker('fixture', [block], true);
    try { expect(lower.path(a, b)).not.toBeNull(); expect(mesh.nearestPoint({ x: 0, y: 8, z: -3 })).toBeNull(); }
    finally { mesh.setBlocker('fixture', [], false); }
  });
  it('rejects malformed patrol connectivity before control, including an isolated upper floor', () => {
    const bad = structuredClone(raw);
    bad.groups[0]!.sockets[0]!.patrol!.route[1]!.y = 16;
    bad.groups[0]!.sockets[0]!.combatRegion = 'all';
    Object.assign(bad.regions, { all: [...regions.basement, ...regions.bridge] });
    const e = parseEncounter(bad, () => world);
    expect(() => new Session(undefined, '', world, { encounter: e, mission, events, navMesh: mesh })).toThrow(/patrol leg/);
  });
  it('patrols only its assigned member, pauses 90 ticks and traverses both directions while companions hold', () => {
    const m = play();
    const start = { ...m.guard.state };
    m.step(90); expect(m.guard.state.x).toBe(start.x); expect(m.guard.state.z).toBe(start.z);
    m.step(); expect(m.guard.state.z).toBeGreaterThan(start.z);
    let reversed = false, returned = false;
    for (let i = 0; i < 600; i++) {
      m.step();
      expect(regionContains(regions.basement, m.guard.state)).toBe(true);
      reversed ||= m.guard.posture!.patrol!.direction === -1;
      returned ||= reversed && m.guard.posture!.patrol!.direction === 1;
    }
    expect(reversed).toBe(true); expect(returned).toBe(true);
    for (const s of sockets.slice(1)) {
      const e = m.session.enemies.find((e) => e.spawnId === s.id)!;
      expect(e.state.x).toBeCloseTo(s.feet.x, 3); expect(e.state.z).toBeCloseTo(s.feet.z, 3); expect(e.state.y).toBeCloseTo(s.feet.y, 3);
    }
  });
  it('walks an authored 3D patrol up and back down actual stairs inside explicitly allowed transitions', () => {
    const route = [{ x: 20, y: 0, z: 0 }, { x: 0, y: 8, z: -4 }];
    const transition = [
      { minX: 18, maxX: 24, minZ: -2, maxZ: 2, minY: -.3, maxY: 8.3 },
      { minX: 6.5, maxX: 19, minZ: -2, maxZ: 2, minY: -.3, maxY: 8.3 },
      prism(8),
    ];
    const e = parseEncounter({ ...raw, aliveCap: 1, regions: { transition }, groups: [{ ...raw.groups[0]!, members: [{ archetype: 'rifleman', count: 1 }], sockets: [{ ...socket('stairs', 20, 0, 0, 'transition'), patrol: { route, pauseSeconds: 3 } }] }] }, () => world);
    const session = new Session(undefined, '', world, { encounter: e, mission, events, navMesh: mesh, testHumanCount: 1 });
    session.step(TICK_SECONDS * 1000);
    const guard = session.enemies[0]!; guard.brain = new Brain(guard, ease); guard.brain.think(0);
    let high = false, middle = false, returned = false;
    for (let tick = 2; tick < 1100; tick++) {
      session.step(tick * TICK_SECONDS * 1000);
      expect(regionContains(transition, guard.state)).toBe(true);
      middle ||= guard.state.y > 1 && guard.state.y < 7;
      high ||= guard.state.y > 7.9;
      returned ||= high && guard.state.y < .1;
    }
    expect(middle).toBe(true); expect(high).toBe(true); expect(returned).toBe(true);
  });
  it('preserves reverse leg, 3D route, bounds and remaining pause through retry and durable reload', () => {
    const m = play();
    for (let i = 0; i < 500 && !(m.guard.posture!.patrol!.direction === -1 && m.guard.posture!.patrol!.pauseTicks > 40); i++) m.step();
    m.step(10); m.capture();
    const p = structuredClone(m.guard.posture!); expect(p.patrol!.direction).toBe(-1); expect(p.patrol!.pauseTicks).toBeGreaterThan(0);
    const state = JSON.parse(JSON.stringify(m.saves.at(-1))) as CampaignState;
    const parsed = parseCheckpointWorld(state.checkpoint!.world)!;
    expect(parsed.enemies.find((e) => e.spawnId === 'patrol')!.posture!.route[0]!.y).toBe(0);
    expect(parsed.enemies.find((e) => e.spawnId === 'patrol')!.posture!.region).toEqual(regions.basement);
    m.session.retryMission(true);
    expect(m.session.enemies.find((e) => e.spawnId === 'patrol')!.posture!.patrol!.pauseTicks).toBe(p.patrol!.pauseTicks);
    const loaded = play(state);
    expect(loaded.guard.posture!.leg).toBe(p.leg);
    const before = { ...loaded.guard.state };
    loaded.step(p.patrol!.pauseTicks); expect(loaded.guard.state.x).toBe(before.x); expect(loaded.guard.state.z).toBe(before.z);
    loaded.step(); expect(loaded.guard.state.x).toBeLessThan(before.x);
    const invalid = structuredClone(state.checkpoint!.world) as NonNullable<ReturnType<typeof parseCheckpointWorld>>;
    invalid.enemies.find((e) => e.spawnId === 'patrol')!.posture!.patrol!.direction = 0 as 1;
    expect(parseCheckpointWorld(invalid)).toBeNull();
  });
  it('preempts patrol for combat and refuses pursuits to another floor or insertion, with a legal pursuit control', () => {
    const m = play(); let contact = false;
    let goal = { x: 0, y: 8, z: -4 };
    const registry = createBrainRegistry().condition('contact', () => contact).action('pursue-fixture', ({ blackboard }) => { blackboard.set('intent', { goal, pace: 'walk' }); return 'running'; });
    const tree = buildTree(parseTreeDef({ id: 'preemption-fixture', root: { type: 'selector', reactive: true, children: [{ type: 'sequence', children: [{ type: 'condition', name: 'contact' }, { type: 'action', name: 'pursue-fixture' }] }, { type: 'action', name: 'atEase' }] } }), registry);
    m.guard.brain = new Brain(m.guard, tree); m.guard.brain.think(0); m.step(95);
    contact = true;
    const start = { ...m.guard.state }; m.step(30);
    expect(m.guard.posture!.patrol!.active).toBe(false); expect(m.guard.pathStatus).toBe('unreachable');
    expect(Math.abs(m.guard.state.x - start.x)).toBeLessThan(.01); expect(m.guard.state.y).toBe(0);
    goal = { x: 0, y: 0, z: -20 }; m.step(30); expect(m.guard.pathStatus).toBe('unreachable');
    expect(regionContains(regions.basement, m.guard.state)).toBe(true);
    goal = { x: -4, y: 0, z: 2 }; m.step(120); expect(m.guard.state.z).toBeGreaterThan(start.z + 2);
  });
  it('keeps avoidance or externally supplied movement from crossing a legal region boundary', () => {
    const m = play(); const e = m.session.enemies.find((e) => e.spawnId === 'hold')!;
    e.state.x = 6.99; e.state.z = -4; e.brain = new Brain(e); e.follower = null;
    for (let i = 0; i < 15; i++) { e.input = { ...e.input, moveX: 0, moveY: 1, yaw: 256 }; m.step(); expect(e.state.x).toBeLessThanOrEqual(7); }
    expect(e.pathStatus).toBe('unreachable');
  });
  it('the actual takeCover leaf releases an otherwise reachable reservation on the wrong floor', () => {
    const m = play(); const e = m.guard;
    const index = m.session.cover!.points.findIndex((p) => p.y > 7 && p.y < 9);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(m.session.cover!.reserve(e.netId, index, e.state)).toBe(true);
    const target = m.session.slots[0]!; target.state = createMoveState(-5, 0, 0);
    rememberSeen(e.memory, target.netId, target.state, 0, false); e.target = target.netId;
    e.brain = new Brain(e, buildTree(parseTreeDef({ id: 'cover-leaf-fixture', root: { type: 'action', name: 'takeCover', args: { keep: true } } }), createBrainRegistry()));
    e.brain.think(0);
    const held = m.session.cover!.heldPoint(e.netId);
    expect(held).not.toBeNull(); expect(held!.y).toBeCloseTo(0);
    expect(e.canReach(held!)).toBe(true);
  });
  it('capture assignment and lever goals require a complete path inside the guard region', () => {
    const m = play(); const e = m.guard;
    const held = m.session.slots[0]!;
    m.session.slots.slice(1).forEach((s) => { s.state = createMoveState(-26, 0, -26); });
    held.health.current = 0; held.health.downedAt = 0; held.health.diedAt = null;
    held.state = createMoveState(-12, 0, -4);
    for (const enemy of m.session.enemies) { enemy.target = null; enemy.memory.entries.clear(); if (enemy.state.y > 1) { enemy.health.current = 0; enemy.health.diedAt = 0; } }
    const x = m.session as unknown as { assignCaptures(now: number): void; atHeld(enemy: typeof e, target: typeof held): boolean; enemyInteractionGoal(enemy: typeof e, at: { x: number; y: number; z: number }): { x: number; y: number; z: number } | null };
    expect(completePathLength(mesh.path(e.state, held.state), e.state, held.state)).not.toBeNull();
    x.assignCaptures(DAMAGE.capture.downedMinSeconds + 1); expect(m.session.captures).toHaveLength(0);
    held.state = createMoveState(-6, 0, -4);
    x.assignCaptures(DAMAGE.capture.downedMinSeconds + 1); expect(m.session.captures).toHaveLength(1);
    e.state.x = -6; held.state.x = -7.1;
    expect(x.atHeld(e, held)).toBe(false);
    expect(x.enemyInteractionGoal(e, { x: -12, y: 1.3, z: -4 })).toBeNull();
    const legal = x.enemyInteractionGoal(e, { x: -5, y: 1.3, z: -4 });
    expect(legal).not.toBeNull(); expect(legal!.y).toBeCloseTo(.05, 1);
  });
  it('filters cover to a complete legal route, excluding the reachable surface and disconnected bridge', () => {
    const m = play(); const e = m.guard;
    expect(e.canReach({ x: 0, y: 8, z: -4 })).toBe(false);
    expect(e.canReach({ x: 0, y: 16, z: -4 })).toBe(false);
    const choices = m.session.cover!.rank({ from: e.state, threats: [{ x: 0, y: 1.6, z: -20 }], combat: false, accept: (p) => e.canReach(p), pathCost: e.movementCost! });
    expect(choices.length).toBeGreaterThan(0);
    for (const c of choices) { expect(c.point.y).toBeCloseTo(0); expect(regionContains(regions.basement, c.point)).toBe(true); }
  });
});
