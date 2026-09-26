/**
 * U-001: mission-01 keeps its enemy pressure. The committed mission, its
 * encounter and its event script on a real `Session` — the one the host's
 * rooms and the in-page session both run — played by hand: groups killed
 * where they stand, the squad put where an objective wants it and kept on
 * its feet, so what is measured is the encounter's lifecycle and nothing
 * else.
 *
 * What the owner saw (2026-09-26): after a checkpoint, or with almost a whole
 * enemy group dead, the map went empty while an objective's timer ran. Two
 * causes, each reproduced here before its fix:
 *
 * 1. A checkpoint retry restored the event script's "already fired" set but
 *    built a fresh spawner: a group sent before the checkpoint and not yet
 *    beaten (the garrison, at objective 1) was never sent again, and what
 *    waited on its death never came.
 * 2. The counterattack was sent on the garrison's death, so it was spent
 *    during the clear-and-hold (whose hold cannot finish while it comes), and
 *    the defend ran its 330 s on an empty map.
 */
import { describe, expect, it } from 'vitest';
import {
  ClientConnection,
  TICK_SECONDS,
  createLoopbackPair,
  encounterFor,
  missionFor,
  requireWorld,
} from '@sandline/shared';
import type { CampaignState } from '../persistence/CampaignDatabase.ts';
import { Session, type SessionOptions } from './Session.ts';

const TICK_MS = TICK_SECONDS * 1000;
const ENCOUNTER = encounterFor('mission-01')!;
const MISSION = missionFor('mission-01')!;
const WORLD = requireWorld('mission-01');
const START = WORLD.mission!.start;
const OBJECTIVE = WORLD.mission!.objective;
const ASSAULT_ENTRY = ENCOUNTER.areas['assault-entry']!;
const DEFEND = MISSION.objectives.findIndex((o) => o.type === 'defend');
const DEFEND_SECONDS = (MISSION.objectives[DEFEND] as { seconds: number }).seconds;

function play(options: SessionOptions = {}) {
  const session = new Session(undefined, '', 'mission-01', { encounter: ENCOUNTER, testHumanCount: 1, ...options });
  let now = 0;
  /** Enemy netId → the mission second it was first seen alive. */
  const born = new Map<number, number>();
  let killAfter: number | null = null;
  let emptyFor = 0;
  let longestEmpty = 0;
  const seconds = () => session.tick * TICK_SECONDS;
  const living = (group?: string) =>
    session.enemies.filter((e) => e.health.diedAt === null && (group === undefined || session.spawner!.spawnedBy(group).includes(e.netId))).map((e) => e.netId);
  const kill = (health: { current: number; diedAt: number | null }) => Object.assign(health, { current: 0, diedAt: now / 1000 });
  const step = (ticks = 1) => {
    for (let i = 0; i < ticks; i++) {
      now += TICK_MS;
      session.step(now);
      for (const s of session.slots) if (s.health.diedAt === null) s.health.current = s.health.max;
      for (const id of living()) if (!born.has(id)) born.set(id, seconds());
      if (killAfter !== null) {
        for (const e of session.enemies) if (e.health.diedAt === null && seconds() - born.get(e.netId)! >= killAfter) kill(e.health);
      }
      const empty = session.mission!.state === 'progress' && session.spawner!.pending === 0 && living().length === 0;
      emptyFor = empty ? emptyFor + TICK_SECONDS : 0;
      longestEmpty = Math.max(longestEmpty, emptyFor);
    }
  };
  const put = (at: { x: number; z: number }) => {
    session.slots.forEach((s, i) => (s.state = { ...s.state, x: at.x + (i % 3) - 1, z: at.z + Math.floor(i / 3) - 0.5 }));
  };
  const killGroup = (group: string) => {
    for (const e of session.enemies) if (session.spawner!.spawnedBy(group).includes(e.netId)) kill(e.health);
  };
  const wipe = () => {
    for (const s of session.slots) kill(s.health);
    step(1);
  };
  const until = (done: () => boolean, maxSeconds: number) => {
    for (let t = 0; t < maxSeconds / TICK_SECONDS && !done(); t++) step(1);
    expect(done(), `still waiting after ${maxSeconds} s: ${session.spawner!.describe()} — mission ${JSON.stringify(session.mission)}`).toBe(true);
  };
  return {
    session,
    step,
    put,
    kill,
    living,
    killGroup,
    wipe,
    until,
    seconds,
    /** From now on, every enemy dies this long after it appears: a squad that wins every fight. */
    killEvery: (s: number | null) => (killAfter = s),
    /** The longest the map has been empty (nothing alive, nothing queued) while the mission ran, since the last reset. */
    longestEmpty: () => longestEmpty,
    resetEmpty: () => ((longestEmpty = 0), (emptyFor = 0)),
    objective: () => session.mission!.objective,
  };
}

type Play = ReturnType<typeof play>;

/** Objectives 0 and 1 beaten, by hand: the west-lane patrol, then the east-lane position once the squad is at the entry. */
function lanes(m: Play) {
  m.step(2);
  m.killGroup('overwatch-patrol');
  m.until(() => m.objective() === 1, 2);
  m.put(ASSAULT_ENTRY);
  m.until(() => m.living('assault-hold').length > 0, 2);
  m.killGroup('assault-hold');
  m.until(() => m.objective() === 2, 2);
}

/** Objective 2: the squad in the compound, the garrison and whatever answers its fall killed as it comes. */
function compound(m: Play) {
  m.put(OBJECTIVE);
  m.killGroup('garrison');
  m.killEvery(3);
  m.until(() => m.objective() === DEFEND, 300);
  // The script hears of the new objective on the next tick.
  m.step(2);
}

describe('mission-01 enemy pressure (U-001)', () => {
  it('a fresh start sends the garrison and the west-lane patrol at once, and the east-lane position when the squad reaches it', () => {
    const m = play();
    m.step(2);
    console.log(`[U-001] fresh start: ${m.session.spawner!.describe()}`);
    expect(m.living('garrison').length).toBeGreaterThan(0);
    expect(m.living('overwatch-patrol').length).toBeGreaterThan(0);
    expect(m.session.spawner!.status().find((g) => g.id === 'assault-hold')).toMatchObject({ state: 'waiting', trigger: 'enter' });
    expect(m.session.spawner!.status().find((g) => g.id === 'counterattack-push')).toMatchObject({ state: 'waiting', trigger: 'script' });
  });

  it('a checkpoint retry brings back the garrison that was alive at the checkpoint, once, and its fall still brings the counterattack', () => {
    const m = play();
    m.step(2);
    const garrison = m.living('garrison').length;
    expect(garrison).toBeGreaterThan(0);

    // Objective 0, the west-lane patrol, beaten: the checkpoint.
    m.killGroup('overwatch-patrol');
    m.step(2);
    expect(m.session.mission).toMatchObject({ state: 'progress', objective: 1 });

    // The squad wiped before the garrison is touched; retry from the checkpoint.
    m.wipe();
    expect(m.session.mission!.state).toBe('failed');
    m.session.retryMission();
    m.step(2);
    console.log(`[U-001] retry at objective 1 (seed-free, 1-human budget): ${m.session.spawner!.describe()}`);
    // The patrol stays beaten; the garrison is back, once.
    expect(m.living('overwatch-patrol')).toHaveLength(0);
    expect(m.session.spawner!.spawnedBy('overwatch-patrol')).toHaveLength(0);
    expect(m.living('garrison')).toHaveLength(garrison);
    expect(m.living()).toHaveLength(garrison);
    m.step(30 * 10);
    expect(m.session.spawner!.spawnedBy('garrison')).toHaveLength(garrison);

    // Beating it still brings the counterattack.
    m.killGroup('garrison');
    m.step(2);
    expect(m.session.spawner!.fired('counterattack')).toBe(true);
  });

  it('the defend is fought for its whole clock, and its waves stop when it is won', () => {
    const m = play();
    lanes(m);
    compound(m);
    // The defend's own counterattack: sent as it starts, not before.
    const defendAt = m.seconds();
    expect(m.session.spawner!.wavesOf('counterattack-push')[0]).toBeGreaterThanOrEqual(defendAt - 1);
    m.resetEmpty();
    m.until(() => m.objective() === DEFEND + 1, DEFEND_SECONDS + 10);
    const wonAt = m.seconds();
    const spawnsInDefend = m.session.spawner!.log.filter((l) => l.seconds >= defendAt - 1 && l.seconds <= wonAt).length;
    console.log(`[U-001] defend: ${(wonAt - defendAt).toFixed(0)} s, ${spawnsInDefend} spawns, longest empty ${m.longestEmpty().toFixed(1)} s; push waves ${m.session.spawner!.wavesOf('counterattack-push').length}`);
    // Before U-001 the defend's longest empty stretch was its whole clock. Now: never longer than a wave's `maxSeconds`.
    const push = ENCOUNTER.groups.find((g) => g.id === 'counterattack-push')!;
    expect(m.longestEmpty()).toBeLessThanOrEqual(push.waves.maxSeconds + 1);
    // Won: no more of its waves, and the exfil ambush on its way.
    m.step(30 * 120);
    const status = m.session.spawner!.status();
    expect(status.find((g) => g.id === 'counterattack-push')!.state).toBe('stopped');
    expect(m.session.spawner!.log.filter((l) => l.group.startsWith('counterattack-') && l.seconds > wonAt + 1)).toHaveLength(0);
    expect(m.session.spawner!.fired('exfil-ambush')).toBe(true);
  });

  it('a retry inside the defend sends the defend again once; a retry after it does not, and the ambush comes back', () => {
    const m = play();
    lanes(m);
    compound(m);
    m.step(30 * 30);
    const firstWave = m.session.spawner!.log.filter((l) => l.group === 'counterattack-push' && l.wave === 1).length;
    expect(firstWave).toBeGreaterThan(0);
    m.killEvery(null);
    m.wipe();
    m.session.retryMission();
    expect(m.session.mission).toMatchObject({ state: 'progress', objective: DEFEND });
    m.step(2);
    const retried = m.session.spawner!.log.filter((l) => l.group === 'counterattack-push');
    console.log(`[U-001] retry in the defend: ${m.session.spawner!.describe()}`);
    expect(retried.filter((l) => l.wave === 1)).toHaveLength(firstWave);
    expect(retried.every((l) => l.wave === 1)).toBe(true);
    expect(m.session.spawner!.spawnedBy('garrison')).toHaveLength(0);
    expect(m.session.spawner!.dead('garrison')).toBe(true);

    m.killEvery(3);
    m.until(() => m.objective() === DEFEND + 1, DEFEND_SECONDS + 10);
    m.step(30 * 5);
    expect(m.session.spawner!.fired('exfil-ambush')).toBe(true);
    m.killEvery(null);
    m.wipe();
    m.session.retryMission();
    m.step(30 * 60);
    console.log(`[U-001] retry at the fall-back: ${m.session.spawner!.describe()}`);
    expect(m.session.spawner!.spawnedBy('counterattack-push')).toHaveLength(0);
    expect(m.session.spawner!.status().find((g) => g.id === 'counterattack-push')!.state).toBe('stopped');
    expect(m.living('exfil-ambush').length).toBeGreaterThan(0);
  });

  it('one garrison survivor nobody can find does not hold back the counterattack for longer than the straggler rule allows', () => {
    const m = play();
    lanes(m);
    m.put(OBJECTIVE);
    const [hidden, ...rest] = m.living('garrison');
    for (const e of m.session.enemies) if (rest.includes(e.netId)) m.kill(e.health);
    // Put the survivor where nobody is, and keep it there.
    const survivor = m.session.enemies.find((e) => e.netId === hidden)!;
    const lostAt = m.seconds();
    m.until(() => {
      survivor.state = { ...survivor.state, x: START.x + 60, z: START.z - 40 };
      return m.session.spawner!.fired('counterattack');
    }, ENCOUNTER.stragglers.seconds + 2);
    const waited = m.seconds() - lostAt;
    console.log(`[U-001] a lone garrison survivor held the counterattack ${waited.toFixed(1)} s (rule ${ENCOUNTER.stragglers.alive} alive for ${ENCOUNTER.stragglers.seconds} s)`);
    expect(waited).toBeGreaterThanOrEqual(ENCOUNTER.stragglers.seconds - 1);
    expect(m.session.spawner!.dead('garrison')).toBe(false);
    expect(m.session.spawner!.broken('garrison')).toBe(true);
  });

  it('a hosted room restored from a saved checkpoint sends what the checkpoint had in play, as a started session does', () => {
    const saves: CampaignState[] = [];
    const m = play({ onCampaignSave: (s) => saves.push(s) });
    m.step(2);
    m.killGroup('overwatch-patrol');
    m.step(2);
    const saved = saves.at(-1)!;
    expect(saved.checkpoint).toMatchObject({ objective: 1, completedGroups: ['overwatch-patrol'] });

    // A started session built from it (no lobby) …
    const direct = play({ campaign: saved });
    direct.step(2);
    expect(direct.living('garrison').length).toBeGreaterThan(0);
    expect(direct.session.spawner!.spawnedBy('overwatch-patrol')).toHaveLength(0);

    // … and a hosted room, once its one human is ready.
    const room = play({ campaign: saved, roomLobby: true });
    const pair = createLoopbackPair();
    room.session.addConnection(pair.a, 0);
    const client = new ClientConnection(pair.b, {});
    client.join('lead');
    pair.settle();
    room.put(START);
    client.send({ kind: 'RoomCommand', command: 'ready', ready: true });
    pair.settle();
    expect(room.session.started).toBe(true);
    room.step(2);
    expect(room.living('garrison').length).toBe(direct.living('garrison').length);
    expect(room.session.spawner!.spawnedBy('overwatch-patrol')).toHaveLength(0);
  });
});
