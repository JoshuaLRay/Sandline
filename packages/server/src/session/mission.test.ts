/**
 * The mission's objective (T-3.34): the rule on its own, then a real
 * `Session` on the grey-box map with a human over loopback — completion
 * when the area is clear and held, failure when every slot is dead, and a
 * restart that puts the world back to the start state.
 */
import { describe, expect, it } from 'vitest';
import {
  ClientConnection,
  MISSION,
  type Message,
  SPAWN_POINTS,
  TICK_SECONDS,
  buildTree,
  createLoopbackPair,
  parseEncounter,
  requireWorld,
} from '@sandline/shared';
import { createBrainRegistry } from '../ai/Brain.ts';
import { Session } from './Session.ts';
import { MissionRun } from './mission.ts';

const HOLD_TICKS = Math.round(MISSION.holdSeconds / TICK_SECONDS);
const TICK_MS = 1000 / 30;

describe('the objective rule (T-3.34)', () => {
  it('holds while clear with the squad inside, pauses when it steps out, resets when an enemy is inside, and completes at the hold', () => {
    const run = new MissionRun();
    const tick = (enemiesInside: number, squadInside: number, wiped = false) => run.step({ enemiesInside, squadInside, wiped });
    tick(1, 3);
    expect(run.current).toMatchObject({ state: 'progress', clear: false, heldTicks: 0 });
    for (let i = 0; i < 90; i++) tick(0, 1);
    expect(run.current.heldTicks).toBe(90);
    // Out of the area, still clear: paused, not lost.
    for (let i = 0; i < 30; i++) tick(0, 0);
    expect(run.current.heldTicks).toBe(90);
    // An enemy back inside: back to nothing.
    tick(1, 1);
    expect(run.current).toMatchObject({ clear: false, heldTicks: 0 });
    for (let i = 0; i < HOLD_TICKS - 1; i++) tick(0, 1);
    expect(run.current.state).toBe('progress');
    tick(0, 1);
    expect(run.current).toMatchObject({ state: 'complete', heldTicks: HOLD_TICKS });
    // Over is over: nothing moves it until a restart.
    tick(3, 0, true);
    expect(run.current.state).toBe('complete');
    run.reset();
    expect(run.current).toMatchObject({ state: 'progress', heldTicks: 0, attempt: 2 });
    tick(0, 0, true);
    expect(run.current.state).toBe('failed');
  });

  it('says a change happened only when a client would show one: the state, clearness, or a whole second', () => {
    const run = new MissionRun();
    expect(run.step({ enemiesInside: 0, squadInside: 0, wiped: false })).toBe(true); // becomes clear
    const changes = Array.from({ length: 90 }, () => run.step({ enemiesInside: 0, squadInside: 1, wiped: false })).filter(Boolean).length;
    expect(changes).toBe(3);
  });
});

/* -- On a real session ------------------------------------------------------------ */

const world = requireWorld('greybox-01');
const objective = world.mission!.objective;

/** One group that comes at the start and waits in the objective, idle: something to clear. */
const ENCOUNTER = parseEncounter({
  world: 'greybox-01',
  aliveCap: 10,
  probes: [0.3, 1.0, 1.7],
  areas: {},
  groups: [{ id: 'g', members: [{ archetype: 'rifleman', count: 2 }], zone: 'behind-objective', posture: { kind: 'garrison', at: 'objective' }, trigger: { kind: 'start' } }],
});

function mission() {
  const session = new Session(undefined, '', world, { encounter: ENCOUNTER });
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  const seen: Extract<Message, { kind: 'Mission' }>[] = [];
  let orders: unknown = null;
  const client = new ClientConnection(pair.b, {
    onMission: (m) => seen.push(m),
    onOrders: (o) => (orders = o),
  });
  client.join('lead');
  pair.settle();
  let now = 0;
  const step = (ticks = 1) => {
    for (let i = 0; i < ticks; i++) {
      now += TICK_MS;
      if (i % 30 === 0) client.send({ kind: 'Ping', id: 1, clientTime: 0 });
      pair.settle();
      session.step(now);
      pair.settle();
    }
  };
  return {
    session,
    seen,
    get orders() {
      return orders;
    },
    step,
    send: (msg: Message) => {
      client.send(msg);
      pair.settle();
    },
    /** Kill an enemy or a slot where it stands, as a finishing shot would. */
    kill: (health: { current: number; diedAt: number | null }) => Object.assign(health, { current: 0, diedAt: now / 1000 }),
  };
}

describe('the mission on a session (T-3.34)', () => {
  it('is sent on seating, in progress on its first attempt', () => {
    const m = mission();
    expect(m.seen[0]).toMatchObject({ kind: 'Mission', state: 'progress', heldTicks: 0, holdTicks: HOLD_TICKS, attempt: 1 });
  });

  it('completes when the area is clear and held — and not while an enemy is in it', () => {
    const m = mission();
    m.step(1);
    const enemies = m.session.enemies;
    expect(enemies.length).toBeGreaterThan(0);
    // The squad walks in with the enemies still there (their garrison stands inside the objective).
    for (const e of enemies) e.state = { ...e.state, x: objective.x + 1, z: objective.z };
    const lead = m.session.slots[0]!;
    lead.state = { ...lead.state, x: objective.x - 1, z: objective.z };
    m.step(60);
    expect(m.session.mission).toMatchObject({ state: 'progress', clear: false, heldTicks: 0 });
    // Clear it: the hold starts, and runs to completion with the lead standing in it.
    for (const e of m.session.enemies) m.kill(e.health);
    m.step(1);
    expect(m.session.mission!.clear).toBe(true);
    m.step(HOLD_TICKS + 5);
    console.log(`[mission] complete after ${HOLD_TICKS} held ticks; ${m.seen.length} Mission messages sent`);
    expect(m.session.mission!.state).toBe('complete');
    expect(m.seen.at(-1)).toMatchObject({ state: 'complete', clear: true, heldTicks: HOLD_TICKS });
    // A message a second while holding, not one a tick.
    expect(m.seen.length).toBeLessThan(HOLD_TICKS * TICK_SECONDS + 10);
  });

  it('fails when every slot is dead, and nobody respawns into a failed mission', () => {
    const m = mission();
    m.step(1);
    for (const s of m.session.slots.slice(1)) m.kill(s.health);
    m.step(5);
    expect(m.session.mission!.state).toBe('progress');
    m.kill(m.session.slots[0]!.health);
    m.step(1);
    expect(m.session.mission!.state).toBe('failed');
    expect(m.seen.at(-1)!.state).toBe('failed');
    // Long past the respawn timer: still dead, still failed (mission.json respawn false).
    m.step(30 * 20);
    expect(m.session.slots.every((s) => s.health.diedAt !== null)).toBe(true);
    expect(m.session.mission!.state).toBe('failed');
  });

  it('restarts only once it is over, and then puts the world back to the start', () => {
    const m = mission();
    m.step(1);
    const firstWave = [...m.session.spawner!.spawnedBy('g')];
    // A bot under an order, a stranger enemy, a squad scattered and hurt.
    m.send({ kind: 'Order', order: 'hold', address: { to: 'all' }, point: null, target: null });
    m.session.spawnEnemy('rifleman', { x: 0, y: 0, z: 30, tree: buildTree('idle', createBrainRegistry()) });
    // Asked mid-mission: refused.
    m.send({ kind: 'MissionRestart' });
    m.step(1);
    expect(m.session.mission!.attempt).toBe(1);
    for (const s of m.session.slots) {
      s.state = { ...s.state, x: 20, z: 40 };
      m.kill(s.health);
    }
    m.step(2);
    expect(m.session.mission!.state).toBe('failed');
    m.send({ kind: 'MissionRestart' });
    // In progress again, attempt two, everyone told.
    expect(m.session.mission).toMatchObject({ state: 'progress', heldTicks: 0, attempt: 2 });
    expect(m.seen.at(-1)).toMatchObject({ state: 'progress', attempt: 2 });
    // Every slot alive on its own spawn point, full health, nothing ordered.
    m.session.slots.forEach((s, i) => {
      expect(s.health.diedAt).toBeNull();
      expect(s.health.current).toBe(s.health.max);
      expect([s.state.x, s.state.z]).toEqual([SPAWN_POINTS[i]!.x, SPAWN_POINTS[i]!.z]);
    });
    expect(m.orders).toEqual([]);
    // No enemy left from before; the encounter plays again from its first tick.
    expect(m.session.enemies).toHaveLength(0);
    m.step(1);
    const again = m.session.spawner!.spawnedBy('g');
    expect(again.length).toBe(firstWave.length);
    expect(again.some((id) => firstWave.includes(id))).toBe(false);
    expect(m.session.spawner!.log[0]!.seconds).toBe(0);
  });

  it('has no mission without an encounter, and sends none', () => {
    const session = new Session(undefined, '', world);
    expect(session.mission).toBeNull();
  });
});
