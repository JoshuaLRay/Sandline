/**
 * U-069: the tank in mission-01, on the committed mission, encounter and event script. The upload actually running
 * brings one tank down the west road to the compound's gap; reaching the objective does not, a restarted upload
 * adds none, a retry from before it recreates it once, a checkpoint keeps it as it was, and the finished upload
 * sends a survivor out the way it came (a wreck stays and blocks nothing).
 *
 * Played by hand like `encounterPressure.test.ts`: groups killed where they stand and the squad kept on its feet,
 * so what is measured is the tank's lifecycle. Soldiers other than the tank die as they appear; the tank is left
 * to the script.
 */
import { describe, expect, it } from 'vitest';
import { TICK_SECONDS, encounterFor, missionFor, requireWorld } from '@sandline/shared';
import { Session } from './Session.ts';

const TICK_MS = TICK_SECONDS * 1000;
const ENCOUNTER = encounterFor('mission-01')!;
const MISSION = missionFor('mission-01')!;
const WORLD = requireWorld('mission-01');
const START = WORLD.mission!.start;
const OBJECTIVE = WORLD.mission!.objective;
const ASSAULT_ENTRY = ENCOUNTER.areas['assault-entry']!;
const UPLOAD = MISSION.objectives.findIndex((o) => o.type === 'upload');
const UPLOAD_SECONDS = (MISSION.objectives[UPLOAD] as { seconds: number }).seconds;
/** The last waypoint of the authored road (mission-01.json `tank-arrives`). */
const FIRING_POINT = { x: -16, z: 70.2 };

interface Internals {
  missionRun: { startUpload(): boolean; interruptUpload(): boolean };
}

function play() {
  const session = new Session(undefined, '', 'mission-01', { encounter: ENCOUNTER, testHumanCount: 1 });
  const run = (session as unknown as Internals).missionRun;
  let now = 0;
  const seconds = () => session.tick * TICK_SECONDS;
  const tanks = () => session.enemies.filter((e) => e.def.id === 'tank');
  const livingTanks = () => tanks().filter((e) => e.health.diedAt === null);
  const step = (ticks = 1) => {
    for (let i = 0; i < ticks; i++) {
      now += TICK_MS;
      session.step(now);
      // The squad is not what is measured, and a shell would kill a soldier outright: very tough, and kept so.
      for (const s of session.slots) if (s.health.diedAt === null) Object.assign(s.health, { max: 1e6, current: 1e6 });
      // Everything but the tank dies on sight: the road is the subject, not the infantry.
      for (const e of session.enemies) if (e.def.id !== 'tank' && e.health.diedAt === null) Object.assign(e.health, { current: 0, diedAt: now / 1000 });
    }
  };
  const put = (at: { x: number; z: number }) => {
    session.slots.forEach((s, i) => (s.state = { ...s.state, x: at.x + (i % 3) - 1, z: at.z + Math.floor(i / 3) - 0.5 }));
  };
  const killGroup = (group: string) => {
    for (const e of session.enemies) if (session.spawner!.spawnedBy(group).includes(e.netId)) Object.assign(e.health, { current: 0, diedAt: now / 1000 });
  };
  const until = (done: () => boolean, maxSeconds: number) => {
    for (let t = 0; t < maxSeconds / TICK_SECONDS && !done(); t++) step(1);
    expect(done(), `still waiting after ${maxSeconds} s — mission ${JSON.stringify(session.mission)}`).toBe(true);
  };
  /** Objectives 0 to 2 by hand, the squad left in the compound with the upload waiting at its terminal. */
  const toUpload = () => {
    step(2);
    killGroup('overwatch-patrol');
    until(() => session.mission!.objective === 1, 2);
    put(ASSAULT_ENTRY);
    until(() => session.spawner!.spawnedBy('assault-hold').length > 0, 2);
    killGroup('assault-hold');
    until(() => session.mission!.objective === 2, 2);
    put(OBJECTIVE);
    killGroup('garrison');
    until(() => session.mission!.objective === UPLOAD, 300);
    step(2);
  };
  const wipe = () => {
    for (const s of session.slots) Object.assign(s.health, { current: 0, diedAt: now / 1000 });
    step(1);
  };
  return { session, run, step, put, until, toUpload, tanks, livingTanks, seconds, wipe, now: () => now / 1000 };
}

describe('the upload brings one tank (U-069)', () => {
  it('sends none while the upload only waits, and exactly one when it starts, at the squad start end of the road', () => {
    const m = play();
    m.toUpload();
    m.step(60);
    expect(m.session.mission).toMatchObject({ objective: UPLOAD, phase: 'idle' });
    expect(m.tanks()).toHaveLength(0);

    expect(m.run.startUpload()).toBe(true);
    m.step(2);
    expect(m.livingTanks()).toHaveLength(1);
    const tank = m.livingTanks()[0]!;
    expect(tank.drive).not.toBeNull();
    // Near the squad start, on the west road, not in the compound.
    expect(Math.abs(tank.state.x - -22)).toBeLessThan(2);
    expect(tank.state.z).toBeLessThan(START.z + 10);
    expect(tank.state.z).toBeGreaterThan(START.z - 20);
  });

  it('adds none when the upload is cut and started again', () => {
    const m = play();
    m.toUpload();
    m.run.startUpload();
    m.step(30);
    expect(m.livingTanks()).toHaveLength(1);
    expect(m.run.interruptUpload()).toBe(true);
    m.step(30);
    expect(m.run.startUpload()).toBe(true);
    m.step(90);
    expect(m.tanks()).toHaveLength(1);
  });

  it('drives the whole road, round the low walls, to the gap and holds there', () => {
    const m = play();
    m.toUpload();
    m.run.startUpload();
    m.until(() => m.livingTanks()[0]?.drive?.phase === 'arrived', 150);
    const tank = m.livingTanks()[0]!;
    expect(Math.hypot(tank.state.x - FIRING_POINT.x, tank.state.z - FIRING_POINT.z)).toBeLessThan(2);
    expect(tank.drive!.next).toBe(tank.drive!.path.length);
  });

  it('withdraws a survivor on the upload completing, and takes it off the map', () => {
    const m = play();
    m.toUpload();
    m.run.startUpload();
    m.until(() => m.livingTanks()[0]?.drive?.phase === 'arrived', 150);
    m.until(() => m.session.mission!.objective > UPLOAD, UPLOAD_SECONDS + 30);
    // The script hears of the finished upload on the next tick.
    m.step(2);
    const tank = m.livingTanks()[0]!;
    expect(tank.drive!.withdrawing).toBe(true);
    m.until(() => m.tanks().length === 0, 150);
    expect(m.session.mission!.state).toBe('progress');
  });

  it('leaves a destroyed tank where it fell, and its wreck is not withdrawn', () => {
    const m = play();
    m.toUpload();
    m.run.startUpload();
    m.until(() => m.livingTanks()[0]?.drive?.phase === 'arrived', 150);
    const tank = m.livingTanks()[0]!;
    Object.assign(tank.health, { current: 0, diedAt: m.now() });
    const at = { x: tank.state.x, z: tank.state.z };
    m.until(() => m.session.mission!.objective > UPLOAD, UPLOAD_SECONDS + 30);
    m.step(30 * 60);
    expect(m.tanks()).toHaveLength(1);
    expect(m.tanks()[0]!.state).toMatchObject(at);
    expect(m.tanks()[0]!.drive!.withdrawing).toBe(false);
  });

  it('holds its fire on the way out', () => {
    const m = play();
    m.toUpload();
    m.run.startUpload();
    m.until(() => m.livingTanks()[0]?.drive?.phase === 'arrived', 150);
    m.until(() => m.session.mission!.objective > UPLOAD, UPLOAD_SECONDS + 30);
    m.step(2);
    const tank = m.livingTanks()[0]!;
    expect(tank.tell).toBeNull();
    const ready = tank.cannonReadyAt;
    m.step(30 * 10);
    expect(tank.cannonReadyAt).toBe(ready);
  });
});

describe('a retry and a checkpoint with the tank (U-069)', () => {
  it('recreates the tank once after a retry from before the upload, and not before the upload starts again', () => {
    const m = play();
    m.toUpload();
    m.run.startUpload();
    m.step(30 * 20);
    expect(m.livingTanks()).toHaveLength(1);

    m.wipe();
    expect(m.session.mission!.state).toBe('failed');
    m.session.retryMission();
    m.step(30 * 30);
    expect(m.session.mission).toMatchObject({ state: 'progress', objective: UPLOAD });
    expect(m.tanks()).toHaveLength(0);

    m.run.startUpload();
    m.step(30 * 30);
    expect(m.livingTanks()).toHaveLength(1);
    // Cut and restarted again: still the one.
    m.run.interruptUpload();
    m.step(30);
    m.run.startUpload();
    m.step(30 * 30);
    expect(m.tanks()).toHaveLength(1);
  });

  it('puts the tank back as a checkpoint saw it: its place on the road, heading, turret, health and cannon', () => {
    const m = play();
    m.toUpload();
    m.run.startUpload();
    m.step(30 * 25);
    const before = m.livingTanks()[0]!;
    before.health.current = 640;
    const saved = {
      x: before.state.x,
      z: before.state.z,
      next: before.drive!.next,
      heading: before.drive!.heading,
      turretYaw: before.turretYaw,
      cannonIn: Math.max(0, before.cannonReadyAt - m.now()),
    };
    expect(saved.next).toBeGreaterThan(0);
    (m.session as unknown as { captureMissionCheckpoint(): void }).captureMissionCheckpoint();

    m.step(30 * 20);
    m.wipe();
    m.session.retryMission();
    const after = m.livingTanks();
    expect(after).toHaveLength(1);
    expect(after[0]!.health.current).toBe(640);
    expect(after[0]!.state.x).toBeCloseTo(saved.x, 6);
    expect(after[0]!.state.z).toBeCloseTo(saved.z, 6);
    expect(after[0]!.drive!.next).toBe(saved.next);
    expect(after[0]!.drive!.heading).toBeCloseTo(saved.heading, 6);
    expect(after[0]!.turretYaw).toBe(saved.turretYaw);
    expect(after[0]!.cannonReadyAt - m.now()).toBeCloseTo(saved.cannonIn, 1);

    // And it goes on along the road from there, a tank still alone.
    m.step(30 * 5);
    expect(m.tanks()).toHaveLength(1);
    expect(after[0]!.drive!.next).toBeGreaterThanOrEqual(saved.next);
  });

  it('keeps a withdrawing tank withdrawing across the checkpoint the finished upload saves', () => {
    const m = play();
    m.toUpload();
    m.run.startUpload();
    m.until(() => m.livingTanks()[0]?.drive?.phase === 'arrived', 150);
    m.until(() => m.session.mission!.objective > UPLOAD, UPLOAD_SECONDS + 30);
    m.step(2);
    expect(m.livingTanks()[0]!.drive!.withdrawing).toBe(true);

    m.wipe();
    m.session.retryMission();
    // The checkpoint was saved the tick the upload finished, before the script heard: it hears again, and once.
    m.step(2);
    const back = m.livingTanks();
    expect(back).toHaveLength(1);
    expect(back[0]!.drive!.withdrawing).toBe(true);
    m.until(() => m.tanks().length === 0, 150);
  });
});
