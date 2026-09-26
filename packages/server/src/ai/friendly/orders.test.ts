/**
 * Bots carry out orders (T-3.28), headless, on real `Session`s over the
 * range's navmesh and baked cover, the friendly tree in every bot slot and a
 * human over loopback giving the orders (T-3.27's path, untouched).
 *
 * One test per order kind — the bot does the thing and reports how it went —
 * and: an unreachable move reports failure at once; a hold survives contact;
 * a marked enemy is engaged before a closer unmarked one; an order given over
 * another reports the first as replaced.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ClientConnection,
  type Message,
  buildTree,
  createLoopbackPair,
  createMoveState,
  formationBand,
  parseTreeDef,
  rememberSeen,
} from '@sandline/shared';
import { type BrainMemory, type BrainTree, createBrainRegistry } from '../Brain.ts';
import { type NavMesh, initNav } from '../nav/NavMesh.ts';
import { bakedCoverFor, loadWorldNavMesh } from '../nav/bakedNav.ts';
import { type EnemyEntity, type OrderReport, Session } from '../../session/Session.ts';
import { MOVE_COVER_M } from './orders.ts';
import { SQUAD } from '@sandline/shared';

const SQUAD_UNDER_FIRE_M = SQUAD.bot.underFire.coverWithinM;

const TICK_MS = 1000 / 30;
/** Where the human lead stands: far off in a corner, so the bots it leads are out of every test's way. */
const LEAD_AT = { x: 40, z: -40 };

let mesh: NavMesh;
beforeAll(async () => {
  await initNav();
  mesh = loadWorldNavMesh('range');
});

interface Squad {
  session: Session;
  /** Send one message as the lead. */
  say(msg: Message): void;
  /** Step `ticks`, the lead standing (so it is not timed out), `each` after every step. */
  run(ticks: number, each?: (t: number) => void): void;
  reports(slot: number): OrderReport[];
  /** T-2.49: every OrderFailed the lead was sent. */
  failed: Extract<Message, { kind: 'OrderFailed' }>[];
}

/** A session with the lead in slot 0 and the bots where `at` puts them (slot index → x, z). */
function squad(at: Record<number, { x: number; z: number }>): Squad {
  const session = new Session(undefined, '', 'range', {
    navMesh: mesh,
    cover: bakedCoverFor('range'),
    brainTree: buildTree('friendly', createBrainRegistry()),
  });
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  let tick = 0;
  const failed: Extract<Message, { kind: 'OrderFailed' }>[] = [];
  const client = new ClientConnection(pair.b, { onOrderFailed: (m) => failed.push(m) });
  client.join('lead');
  pair.settle();
  session.slots.forEach((s, i) => {
    const p = i === 0 ? LEAD_AT : (at[i] ?? { x: LEAD_AT.x - 2 - i, z: LEAD_AT.z - 2 });
    s.state = createMoveState(p.x, 0, p.z);
  });
  return {
    session,
    say(msg) {
      client.send(msg);
      pair.settle();
    },
    run(ticks, each) {
      for (let t = 0; t < ticks; t++) {
        client.send({ kind: 'Input', tick: ++tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0 });
        pair.settle();
        session.step((session.tick + 1) * TICK_MS);
        pair.settle();
        each?.(t);
      }
    },
    reports: (slot) => session.orderReports.filter((r) => r.slot === slot),
    failed,
  };
}

function idle(): BrainTree {
  return buildTree('idle', createBrainRegistry());
}

/** An enemy whose one leaf fires at `netId` every think. */
function firingAt(netId: number): BrainTree {
  const registry = createBrainRegistry().action('want', ({ blackboard }) => {
    blackboard.set('fireAt' as keyof BrainMemory, netId as never);
    return 'running';
  });
  return buildTree(parseTreeDef({ id: 'test-fire', root: { type: 'action', name: 'want' } }), registry);
}

function enemy(session: Session, id: number): EnemyEntity {
  return session.enemies.find((e) => e.netId === id)!;
}

const heal = (session: Session, slots: number[]) => {
  for (const i of slots) Object.assign(session.slots[i]!.health, { current: 100, downedAt: null, diedAt: null });
};

describe('a move order (T-3.28)', () => {
  it('goes to the point, into cover there facing the threat, reports done, and stays', () => {
    const sq = squad({ 1: { x: -3, z: -8 } });
    const { session } = sq;
    const bot = session.slots[1]!;
    const foe = session.spawnEnemy('rifleman', { x: 7, y: 0, z: 25, tree: idle() }) as number;
    const point = { x: 7, y: 0, z: -5.5 };
    sq.say({ kind: 'Order', order: 'move', address: { to: 'slot', index: 1 }, point, target: null });
    let doneAt: number | null = null;
    sq.run(30 * 10, (t) => {
      // It knows where the rifleman is, as though it had seen it: the question is where it takes cover.
      // The rifleman lives through it (a bot in cover fires at what it sees).
      rememberSeen(bot.memory, foe, { x: 7, y: 0, z: 25 }, session.tick / 30, false);
      Object.assign(enemy(session, foe).health, { current: 100, downedAt: null, diedAt: null });
      if (doneAt === null && sq.reports(1).some((r) => r.outcome === 'done')) doneAt = t;
    });
    expect(doneAt).not.toBeNull();
    const held = session.cover!.heldPoint(bot.netId)!;
    expect(held).not.toBeNull();
    console.log(`move: done after ${(doneAt! / 30).toFixed(1)} s, in cover ${Math.hypot(held.x - point.x, held.z - point.z).toFixed(1)} m from the point (${sq.reports(1)[0]!.reason})`);
    expect(Math.hypot(held.x - point.x, held.z - point.z)).toBeLessThanOrEqual(MOVE_COVER_M);
    expect(Math.hypot(bot.state.x - held.x, bot.state.z - held.z)).toBeLessThanOrEqual(0.5);
    expect(session.cover!.stillProtects(bot.netId, [{ x: 7, y: 1.6, z: 25 }])).toBe(true);
    // Still under the order, holding there.
    const where = { x: bot.state.x, z: bot.state.z };
    sq.run(30 * 3, () => {
      rememberSeen(bot.memory, foe, { x: 7, y: 0, z: 25 }, session.tick / 30, false);
      Object.assign(enemy(session, foe).health, { current: 100, downedAt: null, diedAt: null });
    });
    expect(session.orderFor(1)?.order).toBe('move');
    expect(Math.hypot(bot.state.x - where.x, bot.state.z - where.z)).toBeLessThan(0.5);
    expect(sq.reports(1).map((r) => r.outcome)).toEqual(['done']);
    expect(sq.failed).toEqual([]);
  });

  it('to somewhere it cannot reach reports failure at once, rather than standing there saying nothing', () => {
    const sq = squad({ 1: { x: -3, z: -8 } });
    const { session } = sq;
    sq.say({ kind: 'Order', order: 'move', address: { to: 'slot', index: 1 }, point: { x: 0, y: 0, z: 500 }, target: null });
    sq.run(15);
    expect(sq.reports(1)).toEqual([expect.objectContaining({ order: 'move', outcome: 'failed', reason: 'unreachable' })]);
    expect(session.orderFor(1)).toBeNull();
    // T-2.49: and the lead is told, so the bot can say it cannot get there.
    expect(sq.failed).toEqual([{ kind: 'OrderFailed', slot: 1, order: 'move' }]);
  });
});

describe('an attack order (T-3.28)', () => {
  it('goes round to a firing position on an enemy it cannot see, kills it, and reports done', () => {
    // Slot 1 south of the tall west wall (x −14..−9, z 4, 2.4 m); the rifleman north of it.
    const sq = squad({ 1: { x: -11.5, z: 0 } });
    const { session } = sq;
    const bot = session.slots[1]!;
    const foe = session.spawnEnemy('rifleman', { x: -11.5, y: 0, z: 8, tree: idle() }) as number;
    sq.say({ kind: 'Order', order: 'attack', address: { to: 'slot', index: 1 }, point: null, target: foe });
    let doneAt: number | null = null;
    let movedByFirstRound = null as number | null;
    sq.run(30 * 25, (t) => {
      heal(session, [1]);
      if (movedByFirstRound === null && bot.weaponState.shotIndex > 0) movedByFirstRound = Math.hypot(bot.state.x + 11.5, bot.state.z);
      if (doneAt === null && sq.reports(1).length > 0) doneAt = t;
    });
    // It had to go round the wall to get a shot: it had moved well off its start by its first round.
    expect(movedByFirstRound).toBeGreaterThan(1.5);
    console.log(`attack: ${sq.reports(1).map((r) => `${r.outcome} (${r.reason})`).join(', ')} after ${doneAt === null ? 'never' : `${(doneAt / 30).toFixed(1)} s`}; first round ${movedByFirstRound?.toFixed(1)} m from its start; ${bot.weaponState.shotIndex} rounds`);
    expect(enemy(session, foe)?.health.current ?? 0).toBe(0);
    expect(sq.reports(1)).toEqual([expect.objectContaining({ order: 'attack', outcome: 'done', reason: 'target down' })]);
    expect(session.orderFor(1)).toBeNull();
    expect(bot.weaponState.shotIndex).toBeGreaterThan(0);
  });
});

describe('an attack order under fire (T-5.06)', () => {
  it('shot at by another enemy on the way, it goes to cover hidden from the shooter near where it was, and does not walk on in the open', () => {
    const sq = squad({ 1: { x: -11.5, z: 0 } });
    const { session } = sq;
    const bot = session.slots[1]!;
    const foe = session.spawnEnemy('rifleman', { x: -11.5, y: 0, z: 8, tree: idle() }) as number;
    const shooter = session.spawnEnemy('rifleman', { x: 14, y: 0, z: -2, yaw: 0, tree: firingAt(bot.netId) }) as number;
    sq.say({ kind: 'Order', order: 'attack', address: { to: 'slot', index: 1 }, point: null, target: foe });
    let inCoverTicks = 0;
    let furthest = 0;
    sq.run(30 * 8, () => {
      heal(session, [1]);
      Object.assign(enemy(session, shooter).health, { current: 100, downedAt: null, diedAt: null });
      Object.assign(enemy(session, foe).health, { current: 100, downedAt: null, diedAt: null });
      furthest = Math.max(furthest, Math.hypot(bot.state.x + 11.5, bot.state.z));
      const held = session.cover?.heldPoint(bot.netId) ?? null;
      if (held && Math.hypot(bot.state.x - held.x, bot.state.z - held.z) <= 0.5) inCoverTicks++;
    });
    console.log(`attack under fire: in cover ${(inCoverTicks / 30).toFixed(1)} s of 8, furthest ${furthest.toFixed(1)} m from its start; shooter fired ${enemy(session, shooter).weaponState.shotIndex}`);
    expect(enemy(session, shooter).weaponState.shotIndex).toBeGreaterThan(0);
    expect(inCoverTicks).toBeGreaterThan(30 * 2);
    expect(furthest).toBeLessThanOrEqual(SQUAD_UNDER_FIRE_M + 1);
    expect(session.orderFor(1)?.order).toBe('attack');
  });
});

describe('a hold order (T-3.28)', () => {
  it('survives contact: under fire it stays where it was told and fires back', () => {
    const sq = squad({ 1: { x: 16, z: 0 } });
    const { session } = sq;
    const bot = session.slots[1]!;
    const foe = session.spawnEnemy('rifleman', { x: 16, y: 0, z: -18, yaw: 0, tree: firingAt(bot.netId) }) as number;
    sq.say({ kind: 'Order', order: 'hold', address: { to: 'slot', index: 1 }, point: null, target: null });
    let furthest = 0;
    const from = bot.weaponState.shotIndex;
    sq.run(30 * 10, () => {
      heal(session, [1]);
      Object.assign(enemy(session, foe).health, { current: 100, downedAt: null, diedAt: null });
      furthest = Math.max(furthest, Math.hypot(bot.state.x - 16, bot.state.z - 0));
    });
    console.log(`hold: strayed at most ${furthest.toFixed(2)} m under fire, fired ${bot.weaponState.shotIndex - from} rounds back`);
    expect(enemy(session, foe).weaponState.shotIndex).toBeGreaterThan(0);
    expect(furthest).toBeLessThan(0.6);
    expect(bot.weaponState.shotIndex - from).toBeGreaterThan(0);
    expect(session.orderFor(1)?.order).toBe('hold');
    expect(sq.reports(1)).toEqual([]);
  });
});

describe('a regroup order (T-3.28)', () => {
  it('returns to its formation place and reports done, the order then off it', () => {
    const sq = squad({ 1: { x: 10, z: -30 } });
    const { session } = sq;
    const bot = session.slots[1]!;
    sq.say({ kind: 'Order', order: 'hold', address: { to: 'slot', index: 1 }, point: null, target: null });
    sq.run(30);
    expect(Math.hypot(bot.state.x - 10, bot.state.z + 30)).toBeLessThan(0.6);
    sq.say({ kind: 'Order', order: 'regroup', address: { to: 'slot', index: 1 }, point: null, target: null });
    let doneAt: number | null = null;
    sq.run(30 * 15, (t) => {
      if (doneAt === null && sq.reports(1).some((r) => r.order === 'regroup')) doneAt = t;
    });
    const place = session.formationPlace(1)!;
    console.log(`regroup: done after ${doneAt === null ? 'never' : `${(doneAt / 30).toFixed(1)} s`}, ${Math.hypot(bot.state.x - place.goal.x, bot.state.z - place.goal.z).toFixed(2)} m from its place`);
    expect(sq.reports(1).map((r) => `${r.order} ${r.outcome}`)).toEqual(['hold replaced', 'regroup done']);
    expect(Math.hypot(bot.state.x - place.goal.x, bot.state.z - place.goal.z)).toBeLessThanOrEqual(formationBand(place.offset));
    expect(session.orderFor(1)).toBeNull();
  });
});

describe('a revive order (T-3.28)', () => {
  it('goes to the named squadmate and revives it through the human path, then reports done', () => {
    const sq = squad({ 1: { x: -5, z: -6 }, 2: { x: 5, z: -6 } });
    const { session } = sq;
    const mate = session.slots[2]!;
    Object.assign(mate.health, { current: 0, downedAt: 0, diedAt: null });
    sq.say({ kind: 'Order', order: 'revive', address: { to: 'slot', index: 1 }, point: null, target: mate.netId });
    let lockedBy = -1;
    sq.run(30 * 10, () => {
      if (mate.reviveBySlot >= 0) lockedBy = mate.reviveBySlot;
    });
    expect(lockedBy).toBe(1);
    expect(mate.health.downedAt).toBeNull();
    expect(sq.reports(1)).toEqual([expect.objectContaining({ order: 'revive', outcome: 'done', reason: 'up' })]);
  });

  it('of a squadmate who dies first reports failure', () => {
    const sq = squad({ 1: { x: -5, z: -6 }, 2: { x: 20, z: -30 } });
    const { session } = sq;
    const mate = session.slots[2]!;
    Object.assign(mate.health, { current: 0, downedAt: 0, diedAt: null });
    sq.say({ kind: 'Order', order: 'revive', address: { to: 'slot', index: 1 }, point: null, target: mate.netId });
    sq.run(10);
    mate.health.diedAt = session.tick / 30;
    sq.run(10);
    expect(sq.reports(1)).toEqual([expect.objectContaining({ order: 'revive', outcome: 'failed', reason: 'died' })]);
  });
});

describe('a mark (T-3.28)', () => {
  it('puts a marked enemy before a closer unmarked one', () => {
    const run = (mark: boolean) => {
      const sq = squad({ 1: { x: 16, z: 0 } });
      const { session } = sq;
      const bot = session.slots[1]!;
      const near = session.spawnEnemy('rifleman', { x: 18, y: 0, z: -9, tree: idle() }) as number;
      const far = session.spawnEnemy('rifleman', { x: 15, y: 0, z: -22, tree: idle() }) as number;
      if (mark) sq.say({ kind: 'Mark', point: { x: 15, y: 0, z: -22 }, target: far });
      // It has seen both: the question is which it takes on first.
      for (const [id, x, z] of [[near, 18, -9], [far, 15, -22]] as const) rememberSeen(bot.memory, id, { x, y: 0, z }, 0, false);
      let firstAim: number | null = null;
      sq.run(30 * 6, () => {
        for (const id of [near, far]) Object.assign(enemy(session, id).health, { current: 100, downedAt: null, diedAt: null });
        if (firstAim === null && bot.weaponState.shotIndex > 0) firstAim = bot.aim?.netId ?? null;
      });
      return { near, far, firstAim, target: bot.target };
    };
    const plain = run(false);
    const marked = run(true);
    console.log(`mark: unmarked, the first round went at the ${plain.firstAim === plain.near ? 'near' : 'far'} one; marked, at the ${marked.firstAim === marked.far ? 'marked far' : 'near'} one`);
    expect(plain.firstAim).toBe(plain.near);
    expect(marked.firstAim).toBe(marked.far);
    expect(marked.target).toBe(marked.far);
  });
});

describe('an order over another (T-3.28)', () => {
  it('reports the first replaced, whoever gave either', () => {
    const sq = squad({ 1: { x: -3, z: -8 } });
    sq.say({ kind: 'Order', order: 'move', address: { to: 'slot', index: 1 }, point: { x: 10, y: 0, z: -20 }, target: null });
    sq.run(5);
    sq.say({ kind: 'Order', order: 'hold', address: { to: 'slot', index: 1 }, point: null, target: null });
    expect(sq.reports(1)).toEqual([expect.objectContaining({ order: 'move', outcome: 'replaced' })]);
    expect(sq.session.orderFor(1)?.order).toBe('hold');
  });
});
