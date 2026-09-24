/**
 * The mission's objectives (T-3.34, a sequence of types since T-4.14): each
 * rule on its own against a hand-driven world, then a real `Session` on the
 * grey-box map with a human over loopback — every type's completion and
 * failure, a three-objective mission in order, and a restart that puts the
 * world back to the start state.
 */
import { describe, expect, it } from 'vitest';
import {
  ClientConnection,
  type GroundArea,
  type Message,
  type MissionDef,
  type ObjectiveDef,
  SPAWN_POINTS,
  TICK_SECONDS,
  buildTree,
  createLoopbackPair,
  missionFor,
  parseEncounter,
  requireWorld,
} from '@sandline/shared';
import { createBrainRegistry } from '../ai/Brain.ts';
import { Session } from './Session.ts';
import { MissionRun, type MissionWorld } from './mission.ts';

const GREYBOX = missionFor('greybox-01')!;
const HOLD_TICKS = Math.round((GREYBOX.objectives[0] as Extract<ObjectiveDef, { type: 'clear-and-hold' }>).holdSeconds / TICK_SECONDS);
const TICK_MS = 1000 / 30;
const ticks = (seconds: number) => Math.round(seconds / TICK_SECONDS);

const AREA: GroundArea = { x: 0, z: 0, radius: 5 };
const OTHER: GroundArea = { x: 50, z: 0, radius: 5 };

/** A mission of these objectives, its areas resolved by name ('a' is AREA, 'b' OTHER). */
function runOf(objectives: ObjectiveDef[], respawn = false): MissionRun {
  const def: MissionDef = { id: 'test', world: 'greybox-01', respawn, objectives };
  return new MissionRun(def, (ref) => (ref === 'b' ? OTHER : typeof ref === 'string' ? AREA : ref));
}

/** A world the test sets by hand, one tick at a time. */
function fake() {
  const w = {
    enemies: new Map<GroundArea, number>(),
    squad: new Map<GroundArea, number>(),
    standingAll: 6,
    standing: new Map<GroundArea, number>(),
    wipe: false,
    groups: new Map<string, { dead: boolean; spawned: number; down: number }>(),
  };
  const world: MissionWorld = {
    enemiesIn: (a) => w.enemies.get(a) ?? 0,
    squadIn: (a) => w.squad.get(a) ?? 0,
    standing: () => w.standingAll,
    standingIn: (a) => w.standing.get(a) ?? 0,
    wiped: () => w.wipe,
    group: (id) => w.groups.get(id) ?? { dead: false, spawned: 0, down: 0 },
  };
  return { w, world };
}

describe('each objective type, on its own (T-4.14)', () => {
  it('clear-and-hold: holds while clear with the squad inside, pauses when it steps out, resets when an enemy is inside', () => {
    const run = runOf([{ type: 'clear-and-hold', label: 'x', area: 'a', holdSeconds: 10 }]);
    const { w, world } = fake();
    w.enemies.set(AREA, 1);
    w.squad.set(AREA, 3);
    run.step(world);
    expect(run.current).toMatchObject({ state: 'progress', type: 'clear-and-hold', satisfied: false, progress: 0, goal: ticks(10) });
    w.enemies.set(AREA, 0);
    for (let i = 0; i < 90; i++) run.step(world);
    expect(run.current.progress).toBe(90);
    w.squad.set(AREA, 0);
    for (let i = 0; i < 30; i++) run.step(world);
    expect(run.current.progress).toBe(90);
    w.enemies.set(AREA, 1);
    w.squad.set(AREA, 1);
    run.step(world);
    expect(run.current).toMatchObject({ satisfied: false, progress: 0 });
    w.enemies.set(AREA, 0);
    for (let i = 0; i < ticks(10); i++) run.step(world);
    expect(run.current.state).toBe('complete');
  });

  it('reach all: every standing soldier inside; reach any: one is enough', () => {
    const all = runOf([{ type: 'reach', label: 'x', area: 'a', who: 'all' }]);
    const { w, world } = fake();
    w.standingAll = 4;
    w.standing.set(AREA, 3);
    all.step(world);
    expect(all.current).toMatchObject({ state: 'progress', progress: 3, goal: 4, satisfied: false });
    // One of them goes down: the three still standing are all there.
    w.standingAll = 3;
    all.step(world);
    expect(all.current.state).toBe('complete');
    const any = runOf([{ type: 'reach', label: 'x', area: 'a', who: 'any' }]);
    const f = fake();
    f.w.standing.set(AREA, 0);
    any.step(f.world);
    expect(any.current).toMatchObject({ state: 'progress', goal: 1, progress: 0 });
    f.w.standing.set(AREA, 1);
    any.step(f.world);
    expect(any.current.state).toBe('complete');
  });

  it('destroy: counts the group down, and completes only once the group is dead', () => {
    const run = runOf([{ type: 'destroy', label: 'x', group: 'g' }]);
    const { w, world } = fake();
    w.groups.set('g', { dead: false, spawned: 4, down: 1 });
    run.step(world);
    expect(run.current).toMatchObject({ state: 'progress', progress: 1, goal: 4 });
    // Down to the last, but more are still to come: not dead yet.
    w.groups.set('g', { dead: false, spawned: 4, down: 4 });
    run.step(world);
    expect(run.current.state).toBe('progress');
    w.groups.set('g', { dead: true, spawned: 6, down: 6 });
    run.step(world);
    expect(run.current).toMatchObject({ state: 'complete', progress: 6, goal: 6 });
  });

  it('defend: the clock runs; the area overrun for breachSeconds straight fails it, a squad soldier back in stops the count', () => {
    const run = runOf([{ type: 'defend', label: 'x', area: 'a', seconds: 20, breachSeconds: 3 }]);
    const { w, world } = fake();
    w.enemies.set(AREA, 2);
    for (let i = 0; i < ticks(3) - 1; i++) run.step(world);
    expect(run.current).toMatchObject({ state: 'progress', satisfied: false });
    // Someone gets back in: the breach count starts again.
    w.squad.set(AREA, 1);
    run.step(world);
    expect(run.current.satisfied).toBe(true);
    w.squad.set(AREA, 0);
    for (let i = 0; i < ticks(3) - 1; i++) run.step(world);
    expect(run.current.state).toBe('progress');
    run.step(world);
    expect(run.current.state).toBe('failed');
    // Held: complete when the clock does.
    const held = runOf([{ type: 'defend', label: 'x', area: 'a', seconds: 20, breachSeconds: 3 }]);
    const f = fake();
    for (let i = 0; i < ticks(20); i++) held.step(f.world);
    expect(held.current.state).toBe('complete');
  });

  it('survive: complete when the clock is up; any type fails on a wipe', () => {
    const run = runOf([{ type: 'survive', label: 'x', seconds: 5 }]);
    const { w, world } = fake();
    for (let i = 0; i < ticks(5) - 1; i++) run.step(world);
    expect(run.current.state).toBe('progress');
    run.step(world);
    expect(run.current.state).toBe('complete');
    for (const o of [
      { type: 'clear-and-hold', label: 'x', area: 'a', holdSeconds: 5 },
      { type: 'reach', label: 'x', area: 'a', who: 'any' },
      { type: 'destroy', label: 'x', group: 'g' },
      { type: 'defend', label: 'x', area: 'a', seconds: 5, breachSeconds: 2 },
      { type: 'survive', label: 'x', seconds: 5 },
    ] as ObjectiveDef[]) {
      const r = runOf([o]);
      const f = fake();
      f.w.wipe = true;
      r.step(f.world);
      expect(r.current.state, o.type).toBe('failed');
    }
    void w;
  });

  it('plays a sequence in order: each objective starts the tick the one before completes', () => {
    const run = runOf([
      { type: 'reach', label: 'the ford', area: 'b', who: 'any' },
      { type: 'clear-and-hold', label: 'the compound', area: 'a', holdSeconds: 2 },
      { type: 'survive', label: 'the counterattack', seconds: 3 },
    ]);
    const { w, world } = fake();
    run.step(world);
    expect(run.current).toMatchObject({ objective: 0, objectives: 3, type: 'reach', label: 'the ford' });
    // Standing in the compound does nothing for the first objective.
    w.squad.set(AREA, 1);
    for (let i = 0; i < ticks(5); i++) run.step(world);
    expect(run.current.objective).toBe(0);
    w.standing.set(OTHER, 1);
    run.step(world);
    expect(run.current).toMatchObject({ state: 'progress', objective: 1, type: 'clear-and-hold', progress: 0 });
    for (let i = 0; i < ticks(2); i++) run.step(world);
    expect(run.current).toMatchObject({ objective: 2, type: 'survive', progress: 0 });
    for (let i = 0; i < ticks(3); i++) run.step(world);
    expect(run.current).toMatchObject({ state: 'complete', objective: 2 });
    run.reset();
    expect(run.current).toMatchObject({ state: 'progress', objective: 0, attempt: 2 });
  });

  it('says a change happened only when a client would show one: the objective, its condition, a count or a whole second', () => {
    const run = runOf([{ type: 'clear-and-hold', label: 'x', area: 'a', holdSeconds: 30 }]);
    const { w, world } = fake();
    expect(run.step(world)).toBe(true); // becomes clear
    w.squad.set(AREA, 1);
    const changes = Array.from({ length: 90 }, () => run.step(world)).filter(Boolean).length;
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

function mission(def?: MissionDef, humans?: number) {
  const session = new Session(undefined, '', world, { encounter: ENCOUNTER, ...(def ? { mission: def } : {}), ...(humans ? { testHumanCount: humans } : {}) });
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

describe('the mission on a session (T-3.34, T-4.14)', () => {
  it('is sent on seating, in progress on its first attempt', () => {
    const m = mission();
    expect(m.seen[0]).toMatchObject({ kind: 'Mission', state: 'progress', type: 'clear-and-hold', label: 'the compound', objective: 0, objectives: 1, progress: 0, goal: HOLD_TICKS, attempt: 1 });
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
    expect(m.session.mission).toMatchObject({ state: 'progress', satisfied: false, progress: 0 });
    // Clear it: the hold starts, and runs to completion with the lead standing in it.
    for (const e of m.session.enemies) m.kill(e.health);
    m.step(1);
    expect(m.session.mission!.satisfied).toBe(true);
    m.step(HOLD_TICKS + 5);
    console.log(`[mission] complete after ${HOLD_TICKS} held ticks; ${m.seen.length} Mission messages sent`);
    expect(m.session.mission!.state).toBe('complete');
    expect(m.seen.at(-1)).toMatchObject({ state: 'complete', satisfied: true, progress: HOLD_TICKS });
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
    // Long past the respawn timer: still dead, still failed (the mission's respawn is false).
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
    expect(m.session.mission).toMatchObject({ state: 'progress', objective: 0, progress: 0, attempt: 2 });
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

/** A mission on the grey-box map of just these objectives. */
const def = (...objectives: ObjectiveDef[]): MissionDef => ({ id: 'test', world: 'greybox-01', respawn: false, objectives });
const start = world.mission!.start;

describe('every objective type, on a session (T-4.14)', () => {
  it('reach: completes when the squad gets there (any, then all), and fails on a wipe', () => {
    const any = mission(def({ type: 'reach', label: 'the compound', area: 'objective', who: 'any' }));
    any.step(3);
    expect(any.session.mission).toMatchObject({ state: 'progress', type: 'reach', goal: 1, progress: 0 });
    const lead = any.session.slots[0]!;
    lead.state = { ...lead.state, x: objective.x, z: objective.z };
    any.step(1);
    expect(any.session.mission!.state).toBe('complete');
    expect(any.seen.at(-1)).toMatchObject({ state: 'complete' });
    // All: the squad starts on the start line, so a reach of the start is done at once.
    const all = mission(def({ type: 'reach', label: 'the start', area: 'start', who: 'all' }));
    all.step(1);
    expect(all.session.mission!.state).toBe('complete');
    // A wipe fails it.
    const lost = mission(def({ type: 'reach', label: 'the compound', area: 'objective', who: 'all' }));
    lost.step(1);
    for (const s of lost.session.slots) lost.kill(s.health);
    lost.step(1);
    expect(lost.session.mission!.state).toBe('failed');
    void start;
  });

  it('destroy: counts the group down and completes when it is dead; fails on a wipe', () => {
    // Six humans' worth, so the director sends the whole group.
    const m = mission(def({ type: 'destroy', label: 'the garrison', group: 'g' }), 6);
    m.step(2);
    const placed = m.session.spawner!.spawnedBy('g');
    expect(placed.length).toBe(2);
    expect(m.session.mission).toMatchObject({ state: 'progress', type: 'destroy', progress: 0, goal: placed.length });
    const [first, ...rest] = m.session.enemies;
    m.kill(first!.health);
    m.step(1);
    expect(m.session.mission).toMatchObject({ state: 'progress', progress: 1 });
    for (const e of rest) m.kill(e.health);
    m.step(1);
    expect(m.session.mission).toMatchObject({ state: 'complete', progress: placed.length });
    const lost = mission(def({ type: 'destroy', label: 'the garrison', group: 'g' }));
    lost.step(1);
    for (const s of lost.session.slots) lost.kill(s.health);
    lost.step(1);
    expect(lost.session.mission!.state).toBe('failed');
  });

  it('defend: holds out the clock with the squad in the area; fails when the enemy holds it', () => {
    const held = mission(def({ type: 'defend', label: 'the compound', area: 'objective', seconds: 5, breachSeconds: 2 }));
    held.step(1);
    // The garrison stands inside, but so does the lead: not overrun.
    const lead = held.session.slots[0]!;
    lead.state = { ...lead.state, x: objective.x, z: objective.z };
    for (const e of held.session.enemies) e.state = { ...e.state, x: objective.x + 1, z: objective.z };
    held.step(ticks(5) + 2);
    expect(held.session.mission!.state).toBe('complete');
    const lost = mission(def({ type: 'defend', label: 'the compound', area: 'objective', seconds: 60, breachSeconds: 2 }));
    lost.step(1);
    for (const e of lost.session.enemies) e.state = { ...e.state, x: objective.x + 1, z: objective.z };
    lost.step(ticks(2) + 2);
    expect(lost.session.mission).toMatchObject({ state: 'failed', type: 'defend', satisfied: false });
  });

  it('survive: completes when the clock is up; fails on a wipe', () => {
    const m = mission(def({ type: 'survive', label: 'the night', seconds: 3 }));
    m.step(ticks(3) + 2);
    expect(m.session.mission!.state).toBe('complete');
    const lost = mission(def({ type: 'survive', label: 'the night', seconds: 60 }));
    lost.step(1);
    for (const s of lost.session.slots) lost.kill(s.health);
    lost.step(1);
    expect(lost.session.mission!.state).toBe('failed');
  });

  it('runs a three-objective mission in order, telling everyone each step', () => {
    const m = mission(
      def(
        { type: 'reach', label: 'the compound', area: 'objective', who: 'any' },
        { type: 'destroy', label: 'the garrison', group: 'g' },
        { type: 'survive', label: 'the counterattack', seconds: 2 },
      ),
    );
    m.step(2);
    expect(m.session.mission).toMatchObject({ objective: 0, objectives: 3, type: 'reach' });
    // Killing the garrison first does not skip ahead: the reach comes first.
    for (const e of m.session.enemies) m.kill(e.health);
    m.step(5);
    expect(m.session.mission!.objective).toBe(0);
    const lead = m.session.slots[0]!;
    lead.state = { ...lead.state, x: objective.x, z: objective.z };
    m.step(1);
    // Reached; the garrison is already dead, so the destroy completes on its first tick.
    m.step(1);
    expect(m.session.mission).toMatchObject({ objective: 2, type: 'survive' });
    m.step(ticks(2) + 1);
    expect(m.session.mission).toMatchObject({ state: 'complete', objective: 2 });
    const types = [...new Set(m.seen.map((v) => `${v.objective}:${v.type}`))];
    expect(types).toEqual(['0:reach', '1:destroy', '2:survive']);
  });

  it('refuses a mission that names a place or a group the encounter does not have', () => {
    expect(() => mission(def({ type: 'reach', label: 'x', area: 'nowhere', who: 'any' }))).toThrow(/no place 'nowhere'/);
    expect(() => mission(def({ type: 'destroy', label: 'x', group: 'ghosts' }))).toThrow(/no encounter group 'ghosts'/);
  });
});
