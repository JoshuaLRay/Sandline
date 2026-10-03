import { beforeAll, describe, expect, it } from 'vitest';
import { encounterFor, missionFor, parseMission, checkMission, requireWorld, scriptFor, TICK_SECONDS, PROJECTILE_IDS, createMoveState, supportUnder } from '@sandline/shared';
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
  const step = (n = 1, clearTank = true) => {
    for (let i = 0; i < n; i++) {
      for (const e of session.enemies) if (!e.def.friendly && (clearTank || !e.def.vehicle)) Object.assign(e.health, { current: 0, diedAt: now / 1000 });
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
describe('U-094/U-095 Qalat mission', () => {
  it('follows, holds and moves on all-squad orders after rescue, preserving hold on retry', () => {
    const p = play(); p.step(5); p.place(-6, 177); p.step(160);
    p.place(-6, 162); p.step(150);
    expect(p.pow().state.z).toBeLessThan(174);
    p.session.orderFrom(0, { order: 'hold', address: { to: 'all' }, point: null, target: null });
    const held = { ...p.pow().state };
    (p.session as unknown as { captureMissionCheckpoint(): void }).captureMissionCheckpoint();
    p.session.retryMission(true);
    p.place(-6, 150); p.step(90);
    expect(Math.hypot(p.pow().state.x - held.x, p.pow().state.z - held.z)).toBeLessThan(.5);
    p.session.orderFrom(0, { order: 'move', address: { to: 'all' }, point: { x: -6, y: 0, z: 158 }, target: null });
    p.step(180);
    expect(p.pow().state.z).toBeLessThan(held.z - 2);
    p.mesh.destroy();
  });
  it('destroys the spawned tank with real rocket blasts and restores the POW on a retry after it', () => {
    const p = play(); p.step(5); p.place(-6, 177); p.step(160);
    p.step(30 * 21, false);
    const tank = p.session.enemies.find((e) => e.def.vehicle)!;
    expect(tank.health.diedAt).toBeNull();
    const kind = PROJECTILE_IDS.indexOf('rocket');
    const at = { x: tank.state.x + 1.5, y: tank.state.y + 1, z: tank.state.z };
    const detonate = p.session as unknown as { detonate(projectile: unknown, at: { x: number; y: number; z: number }): void };
    for (let i = 0; i < 6; i++) detonate.detonate({ netId: 60000 + i, kind, def: p.session.projectileDef(kind)!, ownerSlot: 0, ownerNetId: p.session.slots[0]!.netId, xpPlayerId: null, state: { ...at, vx: 0, vy: 0, vz: 0, age: 0, bounces: 0, resting: false } }, at);
    expect(tank.health.diedAt).not.toBeNull();
    p.step();
    p.session.slots[0]!.health.diedAt = 30;
    p.step(); expect(p.session.mission!.state).toBe('failed');
    p.session.retryMission();
    expect(p.session.mission!.objective).toBe(4);
    expect(p.pow().captive).toBe(false);
    expect(p.pow().health.diedAt).toBeNull();
    expect(p.session.spawner!.dead('tank')).toBe(true);
    p.place(0, -6); p.pow().state = { ...p.pow().state, x: 0, z: -6 };
    p.session.slots[5]!.health.current = 0;
    p.session.slots[5]!.health.downedAt = 30;
    p.step(); expect(p.session.mission!.state).toBe('progress');
    p.session.slots[5]!.health.current = p.session.slots[5]!.health.max;
    p.session.slots[5]!.health.downedAt = null;
    p.step(); expect(p.session.mission!.state).toBe('complete');
    p.mesh.destroy();
  });

  for (const route of world.mission!.routes) {
    for (const reverse of [false, true]) {
      it(`escorts the rescued POW through ${route.id} ${reverse ? 'south' : 'north'} without stranding`, () => {
        const p = play(); p.step(5); p.place(-6, 177); p.step(160);
        expect(p.pow().captive).toBe(false);
        const points = [world.mission!.start, ...route.via, world.mission!.objective].map((at) => ({ ...at, y: supportUnder(at.x, at.z, 0, Infinity, world.boxes, 0) }));
        if (reverse) points.reverse();
        const first = points[0]!;
        p.pow().state = createMoveState(first.x, first.y, first.z);
        // A controlled fixture starts at a route endpoint; movement thereafter is the live escort AI.
        for (const point of points.slice(1)) {
          p.session.orderFrom(0, { order: 'move', address: { to: 'all' }, point, target: null });
          let arrived = false;
          for (let tick = 0; tick < 2400; tick++) {
            p.step();
            const state = p.pow().state;
            if (Math.hypot(state.x - point.x, state.z - point.z) <= 1.5 && Math.abs(state.y - point.y) < .5) { arrived = true; break; }
          }
          expect(arrived, `${route.id} escort failed at ${JSON.stringify(point)}: ${JSON.stringify(p.pow().state)}`).toBe(true);
          expect(p.pow().health.diedAt).toBeNull();
        }
        p.mesh.destroy();
      }, 30000);
    }
  }
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
