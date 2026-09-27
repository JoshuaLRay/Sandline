/**
 * U-010: the enemy's lever, on a real `Session` on greybox-01 with its baked
 * navmesh and the enemy's own trees, a human over loopback starting the
 * upload at the terminal (U-009).
 *
 * - One enemy of the lever's group walks to it, kneels and pulls; its pull
 *   is replicated (an enemy's Health carries it) and the upload is cut once,
 *   to every client; an ally restarts it at the terminal with its progress.
 * - Killed or pushed off mid-pull, it has cut nothing: the pull starts over,
 *   and the next one is sent.
 * - A lever nobody can walk to sends nobody for ever: each is tried, barred
 *   a while and tried again, and the upload runs out untouched.
 * - A wipe and a retry bring the group back and the lever free: one user
 *   again, never two, and the cut still lands once.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  COMPONENT_IDS,
  ClientConnection,
  type Message,
  type MissionDef,
  type ObjectiveDef,
  SnapshotStore,
  TICK_SECONDS,
  buildTree,
  createLoopbackPair,
  decodeMessage,
  parseEncounter,
  requireWorld,
} from '@sandline/shared';
import { createBrainRegistry } from '../ai/Brain.ts';
import { type NavMesh, initNav } from '../ai/nav/NavMesh.ts';
import { bakedCoverFor, loadWorldNavMesh } from '../ai/nav/bakedNav.ts';
import { LEVER_BAR_SECONDS, Session } from './Session.ts';

const WORLD = requireWorld('greybox-01');
const TICK_MS = 1000 / 30;
const ticks = (seconds: number) => Math.round(seconds / TICK_SECONDS);
const E = 0b1000;
const TERMINAL = { x: 10, y: 1.2, z: 12.5 };
const FRONT = { x: 10, z: 11.6 };
/** Open ground between the enemy's spawn zone (0, 86) and the compound: a walk of about sixteen metres. */
const LEVER = { x: 12, y: 1.0, z: 75 };
const USE = 3;

let mesh: NavMesh;
beforeAll(async () => {
  await initNav();
  mesh = loadWorldNavMesh('greybox-01');
});

const upload = (at = LEVER, seconds = 60): ObjectiveDef => ({
  type: 'upload',
  label: 'the relay',
  terminal: TERMINAL,
  reachM: 2,
  seconds,
  onInterrupt: 'keep-progress',
  lever: { at, reachM: 1.8, useSeconds: USE, group: 'cutters' },
});

const ENCOUNTER = parseEncounter({
  world: 'greybox-01',
  aliveCap: 6,
  probes: [0.3, 1, 1.7],
  areas: {},
  groups: [{ id: 'cutters', members: [{ archetype: 'rifleman', count: 2 }], zone: 'behind-objective', posture: { kind: 'hold' }, trigger: { kind: 'start' } }],
});

function room(objectives: ObjectiveDef[]) {
  const mission: MissionDef = { id: 'lever-test', world: 'greybox-01', respawn: false, objectives };
  const session = new Session(undefined, '', WORLD, { encounter: ENCOUNTER, mission, navMesh: mesh, cover: bakedCoverFor('greybox-01'), testHumanCount: 6 });
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  const seen: Message[] = [];
  const store = new SnapshotStore();
  /** Each enemy's replicated lever pull, as this client last saw it. */
  const pull = new Map<number, number>();
  let slot = -1;
  const client = new ClientConnection(pair.b, { onJoinAck: (_n, s) => (slot = s) });
  pair.b.onMessage((bytes) => {
    let msg: Message;
    try {
      msg = decodeMessage(bytes);
    } catch {
      return;
    }
    seen.push(msg);
    if (msg.kind !== 'Delta') return;
    const res = store.applyDelta(msg.tick, msg.baselineTick, msg.payload);
    if (!res.ok || !res.snapshot) return;
    for (const e of res.snapshot.entities) if (e.components[COMPONENT_IDS.Enemy]) pull.set(e.netId, (e.components[COMPONENT_IDS.Health]?.[4] as number) ?? 0);
  });
  client.join('me');
  pair.settle();
  let now = 0;
  let tick = 0;
  let buttons = 0;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      tick += 1;
      now += TICK_MS;
      client.send({ kind: 'Input', tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons });
      if (tick % 3 === 0) client.send({ kind: 'Ack', tick: store.lastAppliedTick });
      pair.settle();
      session.step(now);
      pair.settle();
    }
  };
  const place = (at: { x: number; z: number }) => {
    const s = session.slots[slot]!;
    s.state = { ...s.state, x: at.x, y: 0, z: at.z, vy: 0 };
  };
  /** Start (or restart) the upload at the terminal, then walk back out of the way. */
  const startUpload = () => {
    place(FRONT);
    buttons = E;
    step(1);
    buttons = 0;
    step(1);
    place({ x: 0, z: -6 });
  };
  /** Step until `done`, at most `seconds`; true when it came. */
  const until = (done: () => boolean, seconds: number) => {
    for (let i = 0; i < ticks(seconds); i++) {
      if (done()) return true;
      step(1);
    }
    return done();
  };
  const missions = () => seen.filter((m): m is Extract<Message, { kind: 'Mission' }> => m.kind === 'Mission');
  const said = (text: string) => seen.filter((m) => m.kind === 'ScriptMessage' && m.text === text).length;
  const send = (msg: Message) => {
    client.send(msg);
    pair.settle();
  };
  return { session, step, send, startUpload, until, missions, said, pull, get mission() { return session.mission!; } };
}

const enemyOf = (session: Session, netId: number) => session.enemies.find((e) => e.netId === netId)!;
const distToLever = (session: Session, netId: number) => {
  const e = enemyOf(session, netId);
  return Math.hypot(e.state.x - LEVER.x, e.state.z - LEVER.z);
};

describe('the enemy at the lever (U-010)', () => {
  it('nobody is sent before the upload runs; then one walks there, kneels, pulls where everyone can see it, and cuts it once', () => {
    const r = room([upload()]);
    expect(r.until(() => r.session.enemies.length === 2, 10)).toBe(true);
    // Idle upload: nobody goes.
    expect(r.session.lever).toBeNull();
    r.startUpload();
    expect(r.mission.phase).toBe('active');
    r.step(1);
    const user = r.session.lever!.netId;
    const start = distToLever(r.session, user);
    // It walks there — merely being near is not a pull: nothing counts until it holds the lever.
    expect(r.until(() => (r.session.lever?.seconds ?? 0) > 0, 20)).toBe(true);
    expect(distToLever(r.session, user)).toBeLessThan(start);
    expect(distToLever(r.session, user)).toBeLessThan(1.8);
    expect(enemyOf(r.session, user).state.crouched).toBe(true);
    // Only ever the one.
    expect(r.session.lever!.netId).toBe(user);
    // Half way: every client sees the pull on that enemy, and only that one.
    r.step(ticks(USE / 2));
    expect(r.pull.get(user)).toBeGreaterThanOrEqual(40);
    for (const [netId, p] of r.pull) if (netId !== user) expect(p).toBe(0);
    expect(r.mission.phase).toBe('active');
    // The pull lands: cut, once, to everyone.
    expect(r.until(() => r.mission.phase === 'interrupted', USE)).toBe(true);
    const kept = r.mission.progress;
    expect(kept).toBeGreaterThan(0);
    r.step(ticks(8));
    expect(r.missions().filter((m) => m.phase === 'interrupted')).toHaveLength(1);
    expect(r.said('The upload was cut at the lever')).toBe(1);
    // Stopped: nobody is sent, and its pull shows nothing.
    expect(r.session.lever).toBeNull();
    expect(r.pull.get(user)).toBe(0);
    expect(r.mission.progress).toBe(kept);
    // An ally restarts it at the terminal (U-009), its progress kept — and the enemy goes again.
    r.startUpload();
    expect(r.mission).toMatchObject({ phase: 'active' });
    expect(r.mission.progress).toBeGreaterThanOrEqual(kept);
    r.step(1);
    expect(r.session.lever).not.toBeNull();
  });

  it('killed or pushed off mid-pull, it has cut nothing: the pull starts over, and the next is sent', () => {
    const r = room([upload()]);
    expect(r.until(() => r.session.enemies.length === 2, 10)).toBe(true);
    r.startUpload();
    r.step(1);
    const first = r.session.lever!.netId;
    expect(r.until(() => (r.session.lever?.seconds ?? 0) > USE / 2, 25)).toBe(true);
    // Pushed off: five metres away. The pull is gone; it has to come back and start again.
    const e = enemyOf(r.session, first);
    e.state = { ...e.state, x: e.state.x + 5 };
    r.step(1);
    expect(r.session.lever).toMatchObject({ netId: first, seconds: 0 });
    expect(r.until(() => (r.session.lever?.seconds ?? 0) > USE / 2, 20)).toBe(true);
    // Shot mid-pull: the upload runs on, and the other one is sent from nothing.
    Object.assign(enemyOf(r.session, first).health, { current: 0, diedAt: r.session.tick * TICK_SECONDS });
    r.step(2);
    expect(r.mission.phase).toBe('active');
    const second = r.session.lever!.netId;
    expect(second).not.toBe(first);
    expect(r.session.lever!.seconds).toBe(0);
    expect(r.missions().filter((m) => m.phase === 'interrupted')).toHaveLength(0);
    // Both down: nobody left to send, and the upload is safe.
    Object.assign(enemyOf(r.session, second).health, { current: 0, diedAt: r.session.tick * TICK_SECONDS });
    r.step(ticks(USE + 2));
    expect(r.session.lever).toBeNull();
    expect(r.mission.phase).toBe('active');
  });

  it('a lever nobody can walk to: each is tried and barred a while, nobody waits on it, and the upload runs out untouched', () => {
    const r = room([upload({ x: 200, y: 1, z: 0 }, 30)]);
    r.step(ticks(3));
    r.startUpload();
    r.step(1);
    // Nobody can get there, so nobody is sent.
    expect(r.session.lever).toBeNull();
    // After the bar they are tried again (and barred again) — never stuck holding the job.
    r.step(ticks(LEVER_BAR_SECONDS + 1));
    expect(r.session.lever).toBeNull();
    expect(r.until(() => r.mission.state === 'complete', 40)).toBe(true);
    expect(r.missions().filter((m) => m.phase === 'interrupted')).toHaveLength(0);
  });

  it('a wipe and a retry bring the group back and the lever free: one user again, and the cut still lands once', () => {
    const r = room([{ type: 'survive', label: 'the wait', seconds: 1 } as ObjectiveDef, upload()]);
    r.step(ticks(1) + 3);
    expect(r.mission).toMatchObject({ objective: 1, type: 'upload', phase: 'idle' });
    r.startUpload();
    expect(r.until(() => (r.session.lever?.seconds ?? 0) > 0.5, 25)).toBe(true);
    // Wiped mid-pull.
    for (const s of r.session.slots) Object.assign(s.health, { current: 0, diedAt: r.session.tick * TICK_SECONDS });
    r.step(2);
    expect(r.mission.state).toBe('failed');
    expect(r.session.lever).toBeNull();
    // P: the retry. The group comes back, the upload waits at its terminal, nobody is at the lever.
    r.send({ kind: 'MissionRestart' });
    r.step(ticks(2));
    expect(r.mission).toMatchObject({ state: 'progress', objective: 1, phase: 'idle' });
    expect(r.session.lever).toBeNull();
    // (The retry's fresh director sizes the wave by the humans seated — one here — so one comes back.)
    expect(r.until(() => r.session.enemies.some((e) => e.health.current > 0), 5)).toBe(true);
    expect(r.session.spawner!.status()[0]).toMatchObject({ id: 'cutters', wavesSent: 1 });
    // Started again: one user, and one cut.
    r.startUpload();
    r.step(1);
    const users = new Set<number>();
    expect(
      r.until(() => {
        if (r.session.lever) users.add(r.session.lever.netId);
        return r.mission.phase === 'interrupted';
      }, 30),
    ).toBe(true);
    expect(users.size).toBe(1);
    const cuts = r.missions().filter((m) => m.phase === 'interrupted');
    expect(cuts).toHaveLength(1);
    expect(r.said('The upload was cut at the lever')).toBe(1);
  });
});

describe('a friendly bot at the terminal (U-011)', () => {
  const QUIET = parseEncounter({
    world: 'greybox-01',
    aliveCap: 6,
    probes: [0.3, 1, 1.7],
    areas: {},
    groups: [{ id: 'cutters', members: [{ archetype: 'rifleman', count: 1 }], zone: 'behind-objective', posture: { kind: 'hold' }, trigger: { kind: 'script' } }],
  });

  function squad() {
    const mission: MissionDef = { id: 'bot-upload', world: 'greybox-01', respawn: false, objectives: [upload(LEVER, 60)] };
    const session = new Session(undefined, '', WORLD, { encounter: QUIET, mission, navMesh: mesh, cover: bakedCoverFor('greybox-01'), brainTree: buildTree('friendly', createBrainRegistry()) });
    const pair = createLoopbackPair();
    session.addConnection(pair.a, 0);
    const client = new ClientConnection(pair.b, {});
    client.join('lead');
    pair.settle();
    let now = 0;
    let tick = 0;
    const step = (n: number) => {
      for (let i = 0; i < n; i++) {
        tick += 1;
        now += TICK_MS;
        client.send({ kind: 'Input', tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0 });
        pair.settle();
        session.step(now);
        pair.settle();
      }
    };
    return { session, step };
  }

  it('held at a waiting upload\'s terminal, it starts it (the same checks as a press); held anywhere else, it does not', () => {
    const { session, step } = squad();
    const bot = session.slots.findIndex((s) => s.isBot);
    step(ticks(2));
    // Held a few metres off the terminal: nothing.
    session.orderFrom(0, { order: 'hold', address: { to: 'slot', index: bot }, point: { x: 10, y: 0, z: 8 }, target: null });
    step(ticks(15));
    expect(session.mission!.phase).toBe('idle');
    // Held at the terminal: it walks there and starts the upload.
    session.orderFrom(0, { order: 'hold', address: { to: 'slot', index: bot }, point: { x: TERMINAL.x, y: 0, z: FRONT.z }, target: null });
    let started = false;
    for (let i = 0; i < ticks(20) && !started; i++) {
      step(1);
      started = session.mission!.phase === 'active';
    }
    expect(started).toBe(true);
    const s = session.slots[bot]!.state;
    expect(Math.hypot(s.x - TERMINAL.x, s.z - TERMINAL.z)).toBeLessThan(2);
  });
});
