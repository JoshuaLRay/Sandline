/**
 * U-059: a retry puts the campaign back as it was when the checkpoint was saved — the enemies still alive
 * (where they stood, as hurt), what had been sent and what was queued, each soldier's health, the devices they
 * had placed — and no checkpoint is saved while a soldier is downed: it is queued until the squad is up.
 */
import { describe, expect, it } from 'vitest';
import {
  ClientConnection,
  type Message,
  type MissionDef,
  PROJECTILE_IDS,
  TICK_SECONDS,
  createLoopbackPair,
  parseEncounter,
  requireWorld,
} from '@sandline/shared';
import { Session } from './Session.ts';

const TICK_MS = 1000 / 30;
const world = requireWorld('greybox-01');

/** Group `a` comes first and is the first objective; group `b` is sent at the start too, and outlives it. */
const ENCOUNTER = parseEncounter({
  world: 'greybox-01',
  aliveCap: 10,
  probes: [0.3, 1.0, 1.7],
  areas: {},
  groups: [
    { id: 'a', members: [{ archetype: 'rifleman', count: 2 }], zone: 'behind-objective', posture: { kind: 'garrison', at: 'objective' }, trigger: { kind: 'start' } },
    { id: 'b', members: [{ archetype: 'rifleman', count: 3 }], zone: 'behind-objective', posture: { kind: 'garrison', at: 'objective' }, trigger: { kind: 'start' } },
  ],
});

const MISSION: MissionDef = {
  id: 'test',
  world: 'greybox-01',
  respawn: false,
  objectives: [
    { type: 'destroy', label: 'group a', group: 'a' },
    { type: 'survive', label: 'the night', seconds: 600 },
  ],
};

interface Internals {
  missionCheckpointState: { enemies?: { netId: number; x: number; z: number; health: number; group: string | null }[]; spawner?: unknown } | null;
  queuedCheckpoint: unknown;
  missionRun: { checkpoint: number };
  projectiles: unknown[];
  someoneDowned(): boolean;
}

function play() {
  const session = new Session(undefined, '', world, { encounter: ENCOUNTER, mission: MISSION, testHumanCount: 1 });
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  const client = new ClientConnection(pair.b, { onMission: (_m: Extract<Message, { kind: 'Mission' }>) => {} });
  client.join('lead');
  pair.settle();
  let now = 0;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      now += TICK_MS;
      if (i % 30 === 0) client.send({ kind: 'Ping', id: 1, clientTime: 0 });
      pair.settle();
      session.step(now);
      pair.settle();
    }
  };
  const kill = (health: { current: number; diedAt: number | null }) => Object.assign(health, { current: 0, diedAt: now / 1000 });
  const x = session as unknown as Internals;
  const living = (group: string) => session.enemies.filter((e) => !e.health.diedAt && session.spawner!.spawnedBy(group).includes(e.netId));
  /** Group `a` beaten: the first objective completes and the checkpoint is asked for. */
  const beatA = () => {
    for (const e of session.enemies) if (session.spawner!.spawnedBy('a').includes(e.netId)) kill(e.health);
    step(2);
  };
  const wipe = () => {
    for (const s of session.slots) kill(s.health);
    step(1);
  };
  return { session, x, step, kill, living, beatA, wipe, now: () => now / 1000 };
}

describe('a retry restores the world as the checkpoint saw it (U-059)', () => {
  it('brings back the enemies that were alive, where they stood and as hurt, once, with the sent groups still sent', () => {
    const m = play();
    m.step(90);
    // The director sizes the waves, so count what was sent rather than what the file asks.
    const sent = m.living('b').length;
    expect(sent).toBeGreaterThan(1);
    m.living('b')[0]!.health.current = 33;
    m.beatA();
    expect(m.session.mission).toMatchObject({ state: 'progress', objective: 1 });
    const saved = m.x.missionCheckpointState!.enemies!.filter((e) => e.group === 'b');
    expect(saved).toHaveLength(sent);
    expect(saved.some((e) => e.health === 33)).toBe(true);

    m.step(60);
    m.wipe();
    expect(m.session.mission!.state).toBe('failed');
    m.session.retryMission();
    expect(m.session.mission).toMatchObject({ state: 'progress', objective: 1, attempt: 2 });

    const back = m.living('b');
    expect(back).toHaveLength(sent);
    expect(back.map((e) => Math.round(e.health.current)).sort()).toEqual(saved.map((e) => Math.round(e.health)).sort());
    for (const e of saved) expect(back.some((b) => Math.abs(b.state.x - e.x) < 1e-6 && Math.abs(b.state.z - e.z) < 1e-6)).toBe(true);
    // Group a stays beaten, group b is not sent a second time.
    expect(m.session.spawner!.dead('a')).toBe(true);
    m.step(30 * 5);
    expect(m.session.spawner!.spawnedBy('b')).toHaveLength(sent);
    expect(m.session.enemies.filter((e) => !e.health.diedAt)).toHaveLength(sent);
  });

  it('keeps the mission clock going from the checkpoint, so what the spawner kept still means something', () => {
    const m = play();
    m.step(30);
    m.beatA();
    const savedSeconds = (m.x.missionCheckpointState as unknown as { seconds: number }).seconds;
    expect(savedSeconds).toBeGreaterThan(1);
    m.step(90);
    m.wipe();
    m.session.retryMission();
    m.step(1);
    const now = ((m.session as unknown as { currentTick: number; missionStartTick: number }).currentTick - (m.session as unknown as { missionStartTick: number }).missionStartTick) * TICK_SECONDS;
    expect(Math.abs(now - savedSeconds)).toBeLessThan(0.2);
  });

  it('gives each soldier back the health it had, and the devices it had placed', () => {
    const m = play();
    m.step(2);
    m.session.slots[1]!.health.current = 41;
    const c4 = PROJECTILE_IDS.indexOf('c4');
    const def = m.session.projectileDef(c4)!;
    (m.x.projectiles as unknown[]).push({
      xpPlayerId: null,
      netId: 9000,
      def,
      kind: c4,
      ownerSlot: 0,
      ownerNetId: m.session.slots[0]!.netId,
      state: { x: 3, y: 0.2, z: 4, vx: 0, vy: 0, vz: 0, age: 1, bounces: 0, resting: true },
      stuck: true,
    });
    m.beatA();
    m.step(30);
    m.wipe();
    m.session.retryMission();
    expect(m.session.slots[1]!.health.current).toBe(41);
    expect(m.session.slots[0]!.health.current).toBe(m.session.slots[0]!.health.max);
    const placed = m.session.projectilesNow().filter((p) => p.kind === c4);
    expect(placed).toHaveLength(1);
    expect([placed[0]!.x, placed[0]!.z, placed[0]!.ownerNetId]).toEqual([3, 4, m.session.slots[0]!.netId]);
  });
});

describe('no checkpoint is saved while a soldier is downed (U-059)', () => {
  it('queues it, sends a retry to the last saved one, and takes it once the squad is up', () => {
    const m = play();
    m.step(2);
    // Someone is down when group a falls.
    m.session.slots[2]!.health.downedAt = m.now();
    m.beatA();
    expect(m.session.mission).toMatchObject({ state: 'progress', objective: 1 });
    expect(m.x.missionCheckpointState).toBeNull();
    expect(m.x.queuedCheckpoint).not.toBeNull();
    expect(m.x.missionRun.checkpoint).toBe(0);

    // Up again: the checkpoint is taken, at the objective the squad is on.
    m.session.slots[2]!.health.downedAt = null;
    m.step(2);
    expect(m.x.queuedCheckpoint).toBeNull();
    expect(m.x.missionCheckpointState).not.toBeNull();
    expect(m.x.missionRun.checkpoint).toBe(1);
  });

  it('a failure while it is still queued goes back to the last saved checkpoint, not the unsaved one', () => {
    const m = play();
    m.step(2);
    m.session.slots[2]!.health.downedAt = m.now();
    m.beatA();
    m.wipe();
    expect(m.session.mission!.state).toBe('failed');
    m.session.retryMission();
    expect(m.session.mission).toMatchObject({ state: 'progress', objective: 0, attempt: 2 });
    expect(m.x.queuedCheckpoint).toBeNull();
  });
});
