/**
 * U-123: squad and escort commands keep the floor they name. Real `Session`s on
 * a baked three-storey fixture — ground y0, a solid slab whose top is y8 (with
 * stairs up to it) and an unconnected bridge at y16, all over the same x/z —
 * with the friendly tree in the bot slots and a human lead over loopback.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  ClientConnection,
  type BotOrder,
  type Message,
  type MissionDef,
  buildTree,
  createLoopbackPair,
  createMoveState,
  loadWorld,
  parseEncounter,
  requireWorld,
} from '@sandline/shared';
import { createBrainRegistry } from '../../../server/src/ai/Brain.ts';
import { initNav, NavMesh } from '../../../server/src/ai/nav/NavMesh.ts';
import type { CampaignState } from '../../../server/src/persistence/CampaignDatabase.ts';
import { Session } from '../../../server/src/session/Session.ts';
import { bakeWorld } from './bake.ts';

const TICK_MS = 1000 / 30;
const world = loadWorld({ id: 'layer-commands', floor: { halfExtent: 30 }, cover: [
  { id: 'surface', x: 0, y: 5.5, z: 0, w: 16, d: 16, h: 2.5 },
  { id: 'bridge', x: 0, y: 14, z: 0, w: 10, d: 10, h: 2 },
  ...Array.from({ length: 20 }, (_, i) => ({ id: `step-${i}`, x: 17.75 - i * .5, y: 0, z: 0, w: .5, d: 3, h: (i + 1) * .4 })),
] });
/** The same geometry carrying a mission block, so a mission (and its retry) can run on it. */
const missionWorld = { ...world, mission: requireWorld('greybox-01').mission };
const ENCOUNTER = parseEncounter({ world: 'layer-commands', aliveCap: 1, probes: [0.3, 1.0, 1.7], areas: {},
  // A group that never comes: the mission is only here to checkpoint and retry.
  groups: [{ id: 'never', members: [{ archetype: 'rifleman', count: 1 }], zone: 'behind-objective', posture: { kind: 'garrison', at: 'objective' }, trigger: { kind: 'time', seconds: 9999 } }] }, () => missionWorld);
/** Far out of every test's way, on the ground. */
const AWAY = { x: -26, y: 0, z: -26 };
let mesh: NavMesh;
beforeAll(async () => {
  await initNav();
  mesh = NavMesh.load(await bakeWorld(world));
});
afterAll(() => mesh.destroy());

const flat = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** A lead in slot 0 over loopback; every other slot a friendly bot, parked at AWAY unless `at` places it. */
function squad(at: Record<number, { x: number; y: number; z: number }> | null, options: { mission?: MissionDef; campaign?: CampaignState; onCampaignSave?: (s: CampaignState) => void } = {}) {
  const session = new Session(undefined, '', options.mission ? missionWorld : world, {
    ...(options.mission ? { encounter: ENCOUNTER } : {}),
    navMesh: mesh,
    brainTree: buildTree('friendly', createBrainRegistry()),
    ...options,
  });
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  const failed: Extract<Message, { kind: 'OrderFailed' }>[] = [];
  let orders: readonly BotOrder[] = [];
  const client = new ClientConnection(pair.b, { onOrderFailed: (m) => failed.push(m), onOrders: (o) => { orders = o; } });
  client.join('lead');
  pair.settle();
  // Null keeps where the session put everyone (a resumed checkpoint).
  if (at) session.slots.forEach((s, i) => {
    const p = at[i] ?? { x: AWAY.x + i * 1.5, y: AWAY.y, z: AWAY.z };
    s.state = createMoveState(p.x, p.y, p.z);
  });
  let tick = 0;
  return {
    session,
    failed,
    get orders() { return orders; },
    say(msg: Message) {
      client.send(msg);
      pair.settle();
    },
    run(ticks: number, until?: () => boolean) {
      for (let t = 0; t < ticks; t++) {
        client.send({ kind: 'Input', tick: ++tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0 });
        pair.settle();
        session.step((session.tick + 1) * TICK_MS);
        pair.settle();
        if (until?.()) return t;
      }
      return ticks;
    },
    reports: (slot: number) => session.orderReports.filter((r) => r.slot === slot),
  };
}

describe('3D move and hold goals (U-123)', () => {
  it('walks under a raised goal at the same x/z, up the stairs, and arrives on the named floor', () => {
    // The way to the stairs runs along z = 2, straight under the goal.
    const sq = squad({ 1: { x: -14, y: 0, z: 2 } });
    sq.say({ kind: 'Order', order: 'move', address: { to: 'slot', index: 1 }, point: { x: 0, y: 8, z: 2 }, target: null });
    const bot = sq.session.slots[1]!;
    let passedUnder = false;
    sq.run(30 * 30, () => {
      passedUnder ||= bot.state.y < 1 && flat(bot.state, { x: 0, z: 2 }) < .5;
      return sq.reports(1).length > 0;
    });
    expect(passedUnder).toBe(true);
    expect(sq.reports(1)).toEqual([expect.objectContaining({ order: 'move', outcome: 'done' })]);
    expect(bot.state.y).toBeCloseTo(8, 1);
    expect(flat(bot.state, { x: 0, z: 2 })).toBeLessThan(.6);
  });

  it('refuses a goal on an unconnected floor above reachable ground, instead of standing beneath it', () => {
    // Detour's partial corridor toward this bridge point ends on the y8 slab directly beneath it.
    const sq = squad({ 1: { x: -14, y: 0, z: 2 } });
    sq.say({ kind: 'Order', order: 'move', address: { to: 'slot', index: 1 }, point: { x: 4, y: 16, z: 0 }, target: null });
    sq.run(10);
    expect(sq.reports(1)).toEqual([expect.objectContaining({ order: 'move', outcome: 'failed', reason: 'unreachable' })]);
    expect(sq.failed).toEqual([{ kind: 'OrderFailed', slot: 1, order: 'move' }]);
    expect(sq.session.slots[1]!.state.y).toBeLessThan(1);
  });

  it('keeps an on-mesh point exactly and snaps an off-mesh one onto the floor it names, never another storey', () => {
    const sq = squad({ 1: { x: -14, y: 0, z: 2 } });
    const goal = (point: { x: number; y: number; z: number }) => {
      sq.say({ kind: 'Order', order: 'move', address: { to: 'slot', index: 1 }, point, target: null });
      return sq.orders.find((o) => o.slot === 1)!.point!;
    };
    for (const y of [0, 8, 16]) expect(goal({ x: 0, y, z: 2 })).toEqual({ x: 0, y, z: 2 });
    // A height a wall face or a raw old-client hit might give: the nearest floor within reach, not the one above.
    expect(goal({ x: 0, y: 1.5, z: 2 }).y).toBeCloseTo(0.05, 1);
    expect(goal({ x: 0, y: 9.5, z: 2 }).y).toBeCloseTo(8.05, 1);
    expect(goal({ x: 0, y: 17.5, z: 0 }).y).toBeCloseTo(16.05, 1);
    // Inside the slab: no floor within reach, kept as asked, and refused as unreachable.
    expect(goal({ x: 0, y: 4, z: 2 })).toEqual({ x: 0, y: 4, z: 2 });
    sq.run(10);
    expect(sq.reports(1).at(-1)).toMatchObject({ order: 'move', outcome: 'failed', reason: 'unreachable' });
  });

  it('keeps every member of a group order on the requested floor and replicates the floor goal', () => {
    const at: Record<number, { x: number; y: number; z: number }> = {};
    for (let i = 1; i < 6; i++) at[i] = { x: -14, y: 0, z: -4 + i * 1.4 };
    const sq = squad(at);
    sq.say({ kind: 'Order', order: 'move', address: { to: 'all' }, point: { x: -2, y: 8, z: 0 }, target: null });
    expect(sq.orders).toHaveLength(5);
    for (const o of sq.orders) expect(o.point!.y).toBeGreaterThan(7.5);
    sq.run(30 * 40, () => [1, 2, 3, 4, 5].every((i) => sq.reports(i).length > 0));
    for (let i = 1; i < 6; i++) {
      expect(sq.reports(i)).toEqual([expect.objectContaining({ order: 'move', outcome: 'done' })]);
      expect(sq.session.slots[i]!.state.y).toBeCloseTo(8, 1);
    }
  });

  it('holds a lower-floor anchor beneath the bot by going down to it', () => {
    const sq = squad({ 1: { x: 1, y: 8, z: 0 } });
    sq.say({ kind: 'Order', order: 'hold', address: { to: 'slot', index: 1 }, point: { x: 1, y: 0, z: 0 }, target: null });
    const bot = sq.session.slots[1]!;
    sq.run(30 * 30, () => bot.state.y < .5 && flat(bot.state, { x: 1, z: 0 }) < .6);
    expect(bot.state.y).toBeLessThan(.5);
    expect(flat(bot.state, { x: 1, z: 0 })).toBeLessThan(.6);
  });
});

describe('3D following and revive reach (U-123)', () => {
  it('a follower beneath its formation place climbs to the lead’s floor', () => {
    const sq = squad({ 0: { x: 0, y: 8, z: 3 } });
    sq.run(2);
    const place = (sq.session as unknown as { formation: { place(i: number): { goal: { x: number; y: number; z: number } } | null } }).formation.place(1)!;
    expect(place.goal.y).toBeGreaterThan(7.5);
    sq.session.slots[1]!.state = createMoveState(place.goal.x, 0, place.goal.z);
    const bot = sq.session.slots[1]!;
    sq.run(30 * 30, () => bot.state.y > 7.5 && flat(bot.state, place.goal) < 1);
    expect(bot.state.y).toBeCloseTo(8, 1);
    expect(flat(bot.state, place.goal)).toBeLessThan(1);
  });

  it('revives a squadmate downed on the floor above, not from beneath it', () => {
    const sq = squad({ 1: { x: 0, y: 0, z: .5 }, 2: { x: 0, y: 8, z: 0 } });
    const mate = sq.session.slots[2]!;
    Object.assign(mate.health, { current: 0, downedAt: 0, diedAt: null });
    sq.say({ kind: 'Order', order: 'revive', address: { to: 'slot', index: 1 }, point: null, target: mate.netId });
    sq.run(30 * 25, () => mate.health.downedAt === null);
    expect(mate.health.downedAt).toBeNull();
    // The bot hears it is up on its next think.
    sq.run(10);
    expect(sq.session.slots[1]!.state.y).toBeCloseTo(8, 1);
    expect(sq.reports(1)).toEqual([expect.objectContaining({ order: 'revive', outcome: 'done', reason: 'up' })]);
  });

  it('the escorted prisoner follows a lead on the floor above instead of stopping beneath it', () => {
    const sq = squad({ 0: { x: 0, y: 8, z: 0 } });
    for (const slot of sq.session.slots.slice(1)) Object.assign(slot.health, { current: 0, downedAt: null, diedAt: 0 });
    const id = sq.session.spawnEnemy('pow', { x: 0, y: 0, z: -2 })!;
    const pow = sq.session.enemies.find((e) => e.netId === id)!;
    sq.run(30 * 30, () => pow.state.y > 7.5 && flat(pow.state, { x: 0, z: 0 }) < 4);
    expect(pow.state.y).toBeCloseTo(8, 1);
    expect(flat(pow.state, { x: 0, z: 0 })).toBeLessThan(4);
  });

  it('sends the escorted prisoner to the requested floor of a squad move', () => {
    const sq = squad({});
    const id = sq.session.spawnEnemy('pow', { x: -14, y: 0, z: 0 })!;
    const pow = sq.session.enemies.find((e) => e.netId === id)!;
    sq.say({ kind: 'Order', order: 'move', address: { to: 'all' }, point: { x: 0, y: 8, z: 0 }, target: null });
    let passedUnder = false;
    sq.run(30 * 40, () => {
      passedUnder ||= pow.state.y < 1 && flat(pow.state, { x: 0, z: 0 }) < 1.5;
      return pow.state.y > 7.5 && flat(pow.state, { x: 0, z: 0 }) < 1.5;
    });
    expect(passedUnder).toBe(true);
    expect(pow.state.y).toBeCloseTo(8, 1);
  });
});

describe('retry positions keep their floors (U-123)', () => {
  const MISSION = {
    id: 'layer-commands-test',
    world: 'layer-commands',
    respawn: false,
    objectives: [{ type: 'survive', label: 'the night', seconds: 600 }],
  } as unknown as MissionDef;
  const STACK = { 0: { x: 0, y: 0, z: 0 }, 1: { x: 0, y: 8, z: 0 }, 2: { x: 0, y: 16, z: 0 } };
  interface Internals { captureMissionCheckpoint(): void }

  it('restores identical x/z checkpoint positions at y0, y8 and y16 on retry and in a resumed campaign file', () => {
    const saves: CampaignState[] = [];
    const sq = squad(STACK, { mission: MISSION, onCampaignSave: (s) => saves.push(s) });
    sq.run(2);
    sq.say({ kind: 'Order', order: 'move', address: { to: 'all' }, point: { x: 0, y: 16, z: 0 }, target: null });
    (sq.session as unknown as Internals).captureMissionCheckpoint();
    const saved = [0, 1, 2].map((i) => ({ x: sq.session.slots[i]!.state.x, y: sq.session.slots[i]!.state.y, z: sq.session.slots[i]!.state.z }));
    expect(saved.map((p) => p.y)).toEqual([0, 8, 16]);
    for (const p of saved) expect(flat(p, { x: 0, z: 0 })).toBeLessThan(.5);
    for (const slot of sq.session.slots) slot.state = createMoveState(AWAY.x, 0, AWAY.z);
    for (const slot of sq.session.slots) Object.assign(slot.health, { current: 0, downedAt: null, diedAt: 0 });
    sq.run(2);
    expect(sq.session.mission!.state).toBe('failed');
    sq.session.retryMission();
    for (const i of [0, 1, 2]) expect(sq.session.slots[i]!.state).toMatchObject(saved[i]!);
    // The bots go back to following (orders do not survive a retry), but nobody is snapped to another storey.
    sq.run(30);
    for (const [i, y] of [[0, 0], [1, 8], [2, 16]] as const) expect(sq.session.slots[i]!.state.y).toBeCloseTo(y, 1);

    const file = JSON.parse(JSON.stringify(saves.at(-1)!)) as CampaignState;
    expect(file.checkpoint!.spawns.slice(0, 3).map((p) => p.y)).toEqual([0, 8, 16]);
    const resumed = squad(null, { mission: MISSION, campaign: file });
    for (const i of [0, 1, 2]) expect(resumed.session.slots[i]!.state).toMatchObject(saved[i]!);
    resumed.run(30);
    for (const [i, y] of [[0, 0], [1, 8], [2, 16]] as const) expect(resumed.session.slots[i]!.state.y).toBeCloseTo(y, 1);
  });

  it('keeps an escort move goal on its floor through the checkpoint file', () => {
    const saves: CampaignState[] = [];
    const sq = squad({}, { mission: MISSION, onCampaignSave: (s) => saves.push(s) });
    sq.run(2);
    sq.session.spawnEnemy('pow', { x: 0, y: 8, z: 0 });
    sq.say({ kind: 'Order', order: 'move', address: { to: 'all' }, point: { x: 1, y: 8, z: 1 }, target: null });
    (sq.session as unknown as Internals).captureMissionCheckpoint();
    const world = saves.at(-1)!.checkpoint!.world as { enemies: { archetype: string; y: number; escortOrder?: { point: { y: number } | null } }[] };
    const pow = world.enemies.find((e) => e.archetype === 'pow')!;
    expect(pow.y).toBeCloseTo(8, 1);
    expect(pow.escortOrder?.point?.y).toBeGreaterThan(7.5);
  });
});
