/**
 * U-059: a retry puts the campaign back as it was when the checkpoint was saved — the enemies still alive
 * (where they stood, as hurt), what had been sent and what was queued, each soldier's health, the devices they
 * had placed — and no checkpoint is saved while a soldier is downed: it is queued until the squad is up.
 */
import { describe, expect, it, vi } from 'vitest';
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
import { CHECKPOINT_WORLD_MAX_BYTES, CampaignDatabase, type CampaignState } from '../persistence/CampaignDatabase.ts';
import { Session } from './Session.ts';
import { parseCheckpointWorld } from './checkpointWorld.ts';

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

function play(extra: { campaign?: CampaignState; onCampaignSave?: (s: CampaignState) => void } = {}) {
  const session = new Session(undefined, '', world, { encounter: ENCOUNTER, mission: MISSION, testHumanCount: 1, ...extra });
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

describe('the checkpoint world in the campaign file (U-060)', () => {
  /** Play to a checkpoint with enemies in play, and return what the host saved. */
  function saved() {
    const saves: CampaignState[] = [];
    const m = play({ onCampaignSave: (s) => saves.push(s) });
    m.step(90);
    m.living('b')[0]!.health.current = 27;
    m.beatA();
    const state = saves.at(-1)!;
    return { m, state, sent: m.living('b').length };
  }

  it('carries the world through JSON, and a session built from the file starts in it', () => {
    const { state, sent } = saved();
    expect(state.checkpoint?.world).toBeTruthy();
    const fromFile = JSON.parse(JSON.stringify(state)) as CampaignState;
    const resumed = play({ campaign: fromFile });
    const enemies = (state.checkpoint!.world as { enemies: { x: number; z: number; health: number; group: string | null }[] }).enemies.filter((e) => e.group === 'b');
    expect(enemies).toHaveLength(sent);
    const back = resumed.living('b');
    expect(back).toHaveLength(sent);
    expect(back.map((e) => Math.round(e.health.current)).sort()).toEqual(enemies.map((e) => Math.round(e.health)).sort());
    for (const e of enemies) expect(back.some((b) => Math.abs(b.state.x - e.x) < 1e-6 && Math.abs(b.state.z - e.z) < 1e-6)).toBe(true);
    // Group a stays beaten and group b is not sent again.
    resumed.step(30 * 5);
    expect(resumed.session.spawner!.dead('a')).toBe(true);
    expect(resumed.session.spawner!.spawnedBy('b')).toHaveLength(sent);
  });

  it('an older save with no world loads as it always did', () => {
    const { state } = saved();
    const old = JSON.parse(JSON.stringify(state)) as CampaignState;
    delete (old.checkpoint as { world?: unknown }).world;
    const resumed = play({ campaign: old });
    resumed.step(2);
    expect(resumed.session.mission).toMatchObject({ state: 'progress', objective: 1 });
    expect(resumed.session.spawner!.dead('a')).toBe(true);
  });

  it('refuses a malformed world with a warning and resumes from the basic checkpoint', () => {
    const { state } = saved();
    const bad = JSON.parse(JSON.stringify(state)) as CampaignState;
    (bad.checkpoint as { world: unknown }).world = { version: 1, seconds: 'soon', slots: [], ground: [], enemies: [], spawner: null, placed: [] };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const resumed = play({ campaign: bad });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
    resumed.step(2);
    expect(resumed.session.mission).toMatchObject({ state: 'progress', objective: 1 });
  });

  it('the parser takes what a session writes and refuses anything else', () => {
    const { state } = saved();
    const world = JSON.parse(JSON.stringify(state.checkpoint!.world)) as Record<string, unknown>;
    expect(parseCheckpointWorld(world)).toMatchObject({ version: 1 });
    expect(parseCheckpointWorld({ ...world, version: 2 })).toBeNull();
    expect(parseCheckpointWorld({ ...world, seconds: Number.POSITIVE_INFINITY })).toBeNull();
    expect(parseCheckpointWorld({ ...world, enemies: Array.from({ length: 65 }, () => (world['enemies'] as unknown[])[0]) })).toBeNull();
    expect(parseCheckpointWorld({ ...world, slots: 'none' })).toBeNull();
    expect(parseCheckpointWorld(null)).toBeNull();
    expect(parseCheckpointWorld('nope')).toBeNull();
  });

  it('takes a tank\'s drive through JSON and refuses a malformed one (U-069)', () => {
    const { state } = saved();
    const world = JSON.parse(JSON.stringify(state.checkpoint!.world)) as { enemies: Record<string, unknown>[] };
    const vehicle = { path: [{ x: 1, z: 2 }, { x: 3, z: 4 }], next: 1, heading: 17.5, phase: 'driving', origin: { x: 0, z: 0 }, withdrawing: false, turretYaw: 300, cannonIn: 2.5 };
    const withTank = (v: unknown) => ({ ...world, enemies: [{ ...world.enemies[0]!, vehicle: v }] });
    expect(parseCheckpointWorld(withTank(vehicle))!.enemies[0]!.vehicle).toEqual(vehicle);
    expect(parseCheckpointWorld(withTank({ ...vehicle, origin: null }))!.enemies[0]!.vehicle!.origin).toBeNull();
    expect(parseCheckpointWorld(withTank({ ...vehicle, phase: 'flying' }))).toBeNull();
    expect(parseCheckpointWorld(withTank({ ...vehicle, next: 3 }))).toBeNull();
    expect(parseCheckpointWorld(withTank({ ...vehicle, turretYaw: 1024 }))).toBeNull();
    expect(parseCheckpointWorld(withTank({ ...vehicle, cannonIn: Number.NaN }))).toBeNull();
  });

  it('the database drops a world past its size bound and keeps the basic checkpoint', () => {
    const { state } = saved();
    const db = new CampaignDatabase(':memory:');
    const made = db.createCampaign('owner', 'greybox-01');
    const big = JSON.parse(JSON.stringify(state)) as CampaignState;
    (big.checkpoint as { world: unknown }).world = { filler: 'x'.repeat(CHECKPOINT_WORLD_MAX_BYTES + 1) };
    db.saveCampaign(made.code, big);
    const loaded = db.loadCampaign(made.code)!;
    expect(loaded.state.checkpoint).toMatchObject({ objective: 1 });
    expect(loaded.state.checkpoint).not.toHaveProperty('world');
    db.saveCampaign(made.code, state);
    expect(db.loadCampaign(made.code)!.state.checkpoint?.world).toBeTruthy();
    db.close();
  });
});
