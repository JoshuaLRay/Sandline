import { beforeAll, describe, expect, it } from 'vitest';
import { encounterFor, missionFor, parseEncounter, parseEventScript, requireWorld, scriptFor, TICK_SECONDS } from '@sandline/shared';
import { initNav } from '../ai/nav/NavMesh.ts';
import { loadWorldNavMesh } from '../ai/nav/bakedNav.ts';
import { Session } from './Session.ts';
import { EventRun } from './events.ts';
const world = requireWorld('qalat-road');
const encounter = encounterFor(world.id)!;
beforeAll(initNav);
function play(early: boolean, lane = -40) {
  const mesh = loadWorldNavMesh(world.id);
  const raw = scriptFor(world.id)!;
  const script = parseEventScript({ ...raw, events: [...raw.events, { id: 'test-free', trigger: { kind: 'time', seconds: 2 }, actions: [{ kind: 'set-flag', flag: 'pow-freed', value: true }] }] }, encounter, world, missionFor(world.id)!);
  const session = new Session(undefined, '', world, { encounter, events: script, navMesh: mesh, testHumanCount: 0 });
  let now = 0;
  const step = (n: number) => {
    for (let i = 0; i < n; i++) {
      now += TICK_SECONDS * 1000;
      for (const slot of session.slots) {
        Object.assign(slot.health, { max: 1e6, current: 1e6 });
        slot.state = { ...slot.state, x: lane, z: 20 };
      }
      for (const enemy of session.enemies) {
        if (enemy.def.friendly) Object.assign(enemy.health, { max: 1e6, current: 1e6 });
        if (!early && session.spawner!.spawnedBy('radio-operator').includes(enemy.netId)) Object.assign(enemy.health, { current: 0, diedAt: now / 1000 });
      }
      session.step(now);
    }
  };
  // Establish the operator group independently of the squad's route.
  session.spawner!.activate('radio-operator', 0);
  return { session, step, mesh, tanks: () => session.enemies.filter((e) => e.def.vehicle) };
}
describe('U-093 Qalat encounter', { timeout: 30000 }, () => {
  it('rejects invalid encounter and delayed-event authoring', () => {
    for (const patch of [{ captive: true }, { fixedCount: 3 }, { path: [{ x: 0, z: 0 }] }]) {
      expect(() => parseEncounter({ ...encounter, groups: [{ ...encounter.groups[0], ...patch }] }, () => world)).toThrow();
    }
    const raw = scriptFor(world.id)!;
    for (const patch of [{ delaySeconds: -1 }, { ifGroupAlive: 'missing' }, { unlessFlag: '' }]) {
      expect(() => parseEventScript({ ...raw, events: [{ ...raw.events[0], ...patch }] }, encounter, world, missionFor(world.id)!)).toThrow();
    }
  });
  it('keeps the prisoner captive and the garrison inactive before the squad approaches', () => {
    const mesh = loadWorldNavMesh(world.id);
    const session = new Session(undefined, '', world, { encounter, navMesh: mesh, testHumanCount: 0 });
    for (let i = 1; i <= 90; i++) session.step(i * TICK_SECONDS * 1000);
    const pow = session.enemies.find((e) => e.def.friendly)!;
    expect(pow.captive).toBe(true);
    expect(Math.abs(pow.state.z - 178)).toBeLessThan(.5);
    expect(session.spawner!.fired('garrison')).toBe(false);
    expect(session.spawner!.spawnedBy('road-patrol')).toHaveLength(3);
    expect(session.spawner!.spawnedBy('river-patrol')).toHaveLength(3);
    expect(session.spawner!.spawnedBy('terrace-post')).toHaveLength(1);
    mesh.destroy();
  });
  it.each([-40, 40])('delays the tank 20 seconds with the radio dead, and drives to extraction from lane %s', (lane) => {
    const p = play(false, lane);
    p.step(30 * 21);
    expect(p.tanks()).toHaveLength(0);
    p.step(31);
    expect(p.tanks(), p.session.spawner!.describe()).toHaveLength(1);
    p.step(30 * 180);
    const tank = p.tanks()[0]!;
    expect(tank.drive!.phase, JSON.stringify({ at: tank.state, drive: tank.drive })).toBe('arrived');
    expect(Math.hypot(tank.state.x, tank.state.z + 6)).toBeLessThan(2);
    expect(p.session.spawner!.spawnedBy('tank')).toEqual([tank.netId]);
    expect(p.session.enemies.filter((e) => e.health.diedAt === null && !e.def.friendly).length).toBeLessThanOrEqual(encounter.aliveCap);
    p.mesh.destroy();
  });
  it('arrives after 5 seconds with the operator alive and sends no second tank at 20 seconds', () => {
    const p = play(true);
    p.step(30 * 6);
    expect(p.tanks()).toHaveLength(0);
    p.step(31);
    expect(p.tanks(), p.session.spawner!.describe()).toHaveLength(1);
    p.step(30 * 20);
    expect(p.tanks(), p.session.spawner!.describe()).toHaveLength(1);
    p.mesh.destroy();
  });
  it('restores a pending delayed event across a checkpoint', () => {
    const p = play(false);
    p.step(30 * 4);
    const run = (p.session as unknown as { eventRun: EventRun }).eventRun;
    const snapshot = run.checkpoint();
    expect(snapshot.pending).toContainEqual(['tank-delayed', 22]);
    run.reset(); run.restore(snapshot);
    p.step(30 * 19);
    expect(p.tanks(), p.session.spawner!.describe()).toHaveLength(1);
    p.mesh.destroy();
  });
});
