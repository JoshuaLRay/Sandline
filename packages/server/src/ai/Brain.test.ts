/**
 * Brains on the session (T-3.08).
 *
 * Real `Session`s, driven the way the host drives them: `step` at 30 Hz with
 * injected time, humans joining and leaving over loopback connections.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ClientConnection, MAX_SLOTS, applyDamage, buildTree, createLoopbackPair, parseTreeDef, spawnFor } from '@sandline/shared';
import { type NavMesh, initNav } from './nav/NavMesh.ts';
import { loadWorldNavMesh } from './nav/bakedNav.ts';
import { Session } from '../session/Session.ts';
import { BRAIN_PERIOD_TICKS, Brain, type BrainTree, brainPhase, createBrainRegistry, defaultBrainTree, freshMemory } from './Brain.ts';

const TICK_MS = 1000 / 30;

/** A human over loopback: joins on creation, `leave` closes the socket. */
function human(session: Session, name: string) {
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  let slot = -1;
  const client = new ClientConnection(pair.b, {
    onJoinAck: (_netId, s) => {
      slot = s;
    },
  });
  client.join(name);
  pair.settle();
  return {
    get slot() {
      return slot;
    },
    input(tick: number, moveX: number, moveY: number) {
      client.send({ kind: 'Input', tick, moveX, moveY, yaw: 0, pitch: 0, buttons: 0 });
      pair.settle();
    },
    leave() {
      pair.b.close('gone');
      pair.settle();
    },
  };
}

/**
 * A tree whose one action logs every thought by netId and, when told to,
 * walks four metres north of the slot's spawn. `halted` logs every halt.
 */
function recordingTree(walk: boolean) {
  const thoughts = new Map<number, number[]>();
  const halted: number[] = [];
  const registry = createBrainRegistry().action('think', {
    tick: ({ tick, ctx, blackboard }) => {
      const log = thoughts.get(ctx.netId) ?? [];
      log.push(tick);
      thoughts.set(ctx.netId, log);
      if (walk) {
        const spawn = spawnFor(ctx.netId - 1);
        blackboard.set('intent', { goal: { x: spawn.x, y: spawn.y, z: spawn.z + 4 }, pace: 'walk' });
      }
      return 'running';
    },
    halt: ({ ctx }) => {
      halted.push(ctx.netId);
    },
  });
  const tree: BrainTree = buildTree(parseTreeDef({ id: 'test-think', root: { type: 'action', name: 'think' } }), registry);
  return { tree, thoughts, halted };
}

function run(session: Session, ticks: number, from = 0): number {
  let now = from;
  for (let i = 0; i < ticks; i++) {
    now += TICK_MS;
    session.step(now);
  }
  return now;
}

describe('brain cadence (T-3.08)', () => {
  it('every bot slot has a brain from the start, running the committed idle tree', () => {
    const session = new Session();
    for (const slot of session.slots) {
      expect(slot.brain).toBeInstanceOf(Brain);
      expect(slot.brain!.tree.tree).toBe(defaultBrainTree());
      expect(slot.brain!.intent).toBeNull();
    }
  });

  it('runs each brain exactly every third tick, on its own phase and never on another', () => {
    const { tree, thoughts } = recordingTree(false);
    const session = new Session(undefined, '', undefined, { brainTree: tree });
    const TICKS = 90;
    run(session, TICKS);
    for (const slot of session.slots) {
      const log = thoughts.get(slot.netId)!;
      const expected = Array.from({ length: TICKS }, (_, t) => t).filter((t) => t % BRAIN_PERIOD_TICKS === brainPhase(slot.netId));
      expect(log).toEqual(expected);
      expect(log.slice(1).every((t, i) => t - log[i]! === BRAIN_PERIOD_TICKS)).toBe(true);
      expect(slot.brain!.thoughtCount).toBe(TICKS / BRAIN_PERIOD_TICKS);
    }
  });

  it('spreads the six brains across all three phases, two on each tick', () => {
    const { tree, thoughts } = recordingTree(false);
    const session = new Session(undefined, '', undefined, { brainTree: tree });
    const phases = session.slots.map((s) => s.brain!.phase);
    expect(new Set(phases)).toEqual(new Set([0, 1, 2]));
    run(session, 30);
    const perTick = new Array<number>(30).fill(0);
    for (const log of thoughts.values()) for (const t of log) perTick[t]!++;
    expect(perTick).toEqual(new Array<number>(30).fill(MAX_SLOTS / BRAIN_PERIOD_TICKS));
  });
});

describe('brains and the slot swap (T-3.08, ADR-001)', () => {
  let mesh: NavMesh;
  beforeAll(async () => {
    await initNav();
    mesh = loadWorldNavMesh('range');
  });

  it('walks the latest intent every tick, not only on the ticks the brain thinks', () => {
    const { tree } = recordingTree(true);
    const session = new Session(undefined, '', undefined, { brainTree: tree, navMesh: mesh });
    let now = run(session, 3);
    const slot = session.slots[0]!;
    let z = slot.state.z;
    // Four metres at walk is ~30 ticks; every one of the first 24 moves it,
    // the two in three the brain does not think on as much as the one it does.
    for (let i = 0; i < 24; i++) {
      now += TICK_MS;
      session.step(now);
      expect(slot.state.z).toBeGreaterThan(z);
      z = slot.state.z;
    }
    run(session, 60, now);
    expect(Math.abs(slot.state.z - (spawnFor(0).z + 4))).toBeLessThan(0.5);
  });

  it('a join stops the brain before its next input; a leave starts a fresh one from where the entity stands', () => {
    const { tree, thoughts, halted } = recordingTree(true);
    const session = new Session(undefined, '', undefined, { brainTree: tree, navMesh: mesh });
    const slot = session.slots[0]!;
    let now = run(session, 12);
    expect(slot.input.moveY).toBeGreaterThan(0);
    applyDamage(slot.health, 30, now / 1000);

    const netId = slot.netId;
    const before = { x: slot.state.x, y: slot.state.y, z: slot.state.z };
    const health = structuredClone(slot.health);
    const oldBrain = slot.brain!;
    const thoughtsBefore = thoughts.get(netId)!.length;

    // Join between two ticks: the brain is stopped there and then.
    const h = human(session, 'alice');
    expect(h.slot).toBe(0);
    expect(slot.isBot).toBe(false);
    expect(slot.brain).toBeNull();
    expect(oldBrain.isStopped).toBe(true);
    expect(oldBrain.intent).toBeNull();
    expect(halted).toEqual([netId]);
    expect(slot.netId).toBe(netId);
    expect(slot.state).toMatchObject(before);
    expect(slot.health).toEqual(health);

    // The next tick runs the human's (absent) input, not the follower's.
    now = run(session, 1, now);
    expect(slot.input.moveX).toBe(0);
    expect(slot.input.moveY).toBe(0);
    // A walker still has momentum to shed; it sheds it rather than walking on.
    const afterJoin = slot.state.z;

    // The human walks the entity somewhere else entirely.
    for (let t = 1; t <= 30; t++) {
      h.input(t, 1, 0);
      now = run(session, 1, now);
    }
    expect(thoughts.get(netId)!.length).toBe(thoughtsBefore);
    expect(Math.abs(slot.state.x - before.x)).toBeGreaterThan(1);
    expect(Math.abs(slot.state.z - afterJoin)).toBeLessThan(0.3);

    const leftAt = { x: slot.state.x, y: slot.state.y, z: slot.state.z };
    const healthAtLeave = structuredClone(slot.health);
    h.leave();
    expect(slot.isBot).toBe(true);
    const fresh = slot.brain!;
    expect(fresh).toBeInstanceOf(Brain);
    expect(fresh).not.toBe(oldBrain);
    expect(fresh.isStopped).toBe(false);
    expect(fresh.thoughtCount).toBe(0);
    expect(fresh.memory).toEqual(freshMemory());
    expect(fresh.startedAt).toEqual(leftAt);
    expect(slot.netId).toBe(netId);
    expect(slot.state).toMatchObject(leftAt);
    expect(slot.health).toEqual(healthAtLeave);

    // The fresh brain thinks on its phase and walks from where it was left.
    now = run(session, BRAIN_PERIOD_TICKS, now);
    expect(fresh.thoughtCount).toBe(1);
    expect(fresh.lastThoughtTick % BRAIN_PERIOD_TICKS).toBe(brainPhase(netId));
    expect(thoughts.get(netId)!.length).toBe(thoughtsBefore + 1);
    expect(slot.input.moveY).toBeGreaterThan(0);
  });

  it('measures what a brain costs', () => {
    const { tree } = recordingTree(true);
    const measure = (opts: ConstructorParameters<typeof Session>[3]) => {
      const session = new Session(undefined, '', undefined, opts);
      const brains = session.slots.map((s) => s.brain!);
      let now = 0;
      let spent = 0;
      const TICKS = 300;
      for (let i = 0; i < TICKS; i++) {
        now += TICK_MS;
        const t0 = performance.now();
        session.step(now);
        spent += performance.now() - t0;
      }
      const thoughts = brains.reduce((n, b) => n + b.thoughtCount, 0);
      session.close();
      return { usPerTick: (spent * 1000) / TICKS, thoughts };
    };
    // Interleaved and the best of five each, so neither side pays for the JIT
    // warming up or for the other's garbage. The walkers arrive after ~30
    // ticks and stand for the rest, still in the crowd.
    const idleRuns: ReturnType<typeof measure>[] = [];
    const walkRuns: ReturnType<typeof measure>[] = [];
    for (let i = 0; i < 5; i++) {
      idleRuns.push(measure({}));
      walkRuns.push(measure({ brainTree: tree, navMesh: mesh }));
    }
    const best = (runs: ReturnType<typeof measure>[]) => runs.reduce((a, b) => (b.usPerTick < a.usPerTick ? b : a));
    const idle = best(idleRuns);
    const walking = best(walkRuns);

    // Direct: one brain's think, in isolation, many times.
    const session = new Session();
    const brain = new Brain(session.slots[0]!);
    const N = 30_000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) brain.think(i * BRAIN_PERIOD_TICKS);
    const usPerThink = ((performance.now() - t0) * 1000) / N;

    console.log(
      `brains: idle think ${usPerThink.toFixed(3)} µs; session step ${idle.usPerTick.toFixed(1)} µs/tick with six idle brains, ` +
        `${walking.usPerTick.toFixed(1)} µs/tick with six walking to a goal (path following + avoidance)`,
    );
    expect(idle.thoughts).toBe(300 * 2);
    expect(walking.thoughts).toBe(300 * 2);
    expect(usPerThink).toBeLessThan(50);
  });
});
