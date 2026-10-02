import { beforeAll, describe, expect, it } from 'vitest';
import { encounterFor, missionFor, parseMission, checkMission, requireWorld, scriptFor, TICK_SECONDS } from '@sandline/shared';
import { initNav } from '../ai/nav/NavMesh.ts';
import { loadWorldNavMesh } from '../ai/nav/bakedNav.ts';
import { Session } from './Session.ts';
import { buildTree } from '@sandline/shared';
import { createBrainRegistry } from '../ai/Brain.ts';
const world = requireWorld('qalat-road');
const encounter = encounterFor(world.id)!;
const mission = missionFor(world.id)!;
beforeAll(initNav);
function play() {
  const mesh = loadWorldNavMesh(world.id);
  const session = new Session(undefined, '', world, { brainTree: buildTree('friendly', createBrainRegistry()), encounter, mission, events: scriptFor(world.id)!, navMesh: mesh, testHumanCount: 0 });
  let now = 0;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      for (const e of session.enemies) if (!e.def.friendly) Object.assign(e.health, { current: 0, diedAt: now / 1000 });
      now += TICK_SECONDS * 1000;
      session.step(now);
    }
  };
  const place = (x: number, z: number) => {
    for (const s of session.slots) {
      s.state = { ...s.state, x, y: 0, z };
      session.orderFrom(0, { order: 'hold', address: { to: 'slot', index: s.index }, point: { x, y: 0, z }, target: null });
    }
  };
  const pow = () => session.enemies.find((e) => e.def.friendly)!;
  return { session, step, place, pow, mesh };
}
describe('U-094 Qalat mission', () => {
  it('validates its stages and rejects invalid captive rescue/checkpoint data', () => {
    expect(() => checkMission(mission, encounter, world)).not.toThrow();
    expect(mission.objectives.map((o) => o.stage)).toEqual([0, 1, 1, 2, 2]);
    const bad = { ...mission, objectives: [{ type: 'rescue', group: 'garrison', label: 'bad', holdSeconds: 3, reachM: 2 }] };
    expect(() => checkMission(parseMission(bad), encounter, world)).toThrow(/captive/);
    expect(() => parseMission({ ...bad, objectives: [{ ...bad.objectives[0], slot: 0 }] })).toThrow(/instead of a slot/);
    expect(() => parseMission({ ...bad, objectives: [{ ...bad.objectives[0], checkpoint: 'no' }] })).toThrow(/checkpoint/);
  });
  it('frees the held escort using actual bot interact, and restores him at the rescue checkpoint', () => {
    const p = play();
    p.step(5);
    expect(p.pow().captive).toBe(true);
    p.place(-6, 177);
    p.step(5);
    expect(p.session.mission!.objective).toBe(1);
    // A retry before rescue keeps the POW captive at his original position.
    p.session.retryMission(true);
    expect(p.pow().captive).toBe(true);
    expect(p.pow().state.z).toBeCloseTo(178, 0);
    p.place(-6, 177);
    p.step(160);
    expect(p.pow().captive).toBe(false);
    expect(p.session.mission!.objective).toBe(3);
    const saved = { ...p.pow().state };
    p.pow().health.current = 0;
    p.pow().health.diedAt = 10;
    p.step();
    expect(p.session.mission!.state).toBe('failed');
    p.session.retryMission();
    expect(p.pow().captive).toBe(false);
    expect(p.pow().health.diedAt).toBeNull();
    expect(Math.hypot(p.pow().state.x - saved.x, p.pow().state.z - saved.z)).toBeLessThan(4);
    p.mesh.destroy();
  });
  it('does not complete extraction before tank destruction or without the seventh person', () => {
    const p = play();
    p.step(5); p.place(-6, 177); p.step(160);
    p.place(0, -6);
    p.step();
    expect(p.session.mission!.state).toBe('progress');
    p.step(30 * 25);
    expect(p.session.spawner!.fired('tank')).toBe(true);
    expect(p.session.mission!.state).toBe('progress');
    // Extraction still needs the living POW in the circle after the tank is dead.
    p.pow().state = { ...p.pow().state, x: 0, z: -6 };
    p.step(3);
    expect(p.session.mission!.state).toBe('complete');
    p.mesh.destroy();
  });
});
