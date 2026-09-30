/**
 * U-057: the motion sensor. Placed like C4, it marks every enemy that moves
 * within 15 m, through walls, for the whole squad; a still enemy, or one out
 * of range, is not marked, and a mark fades when its enemy stops or leaves.
 */
import { describe, expect, it } from 'vitest';
import { PROJECTILE_IDS, TICK_SECONDS, buildTree, createMoveState, degToAngle, getProjectile } from '@sandline/shared';
import { createBrainRegistry } from '../ai/Brain.ts';
import { type EnemyEntity, Session, type Slot } from './Session.ts';

const SENSOR = PROJECTILE_IDS.indexOf('sensor');
const DOWN_45 = degToAngle(-45) & 0xfff;

interface Internals {
  placeCharge(slot: Slot, projectile: number, yaw: number, pitch: number): boolean;
  detonateCharges(slot: Slot, kind: number): void;
  takeOwnCharge(slot: Slot): boolean;
  detonate(p: unknown, at: { x: number; y: number; z: number }): void;
  projectiles: { kind: number; stuck?: boolean; def: { maxLifeSeconds: number }; state: { x: number; y: number; z: number; age: number } }[];
}

/** Vance (slot 5) on open ground, having put his sensor down. */
function scene() {
  const session = new Session(undefined, '', 'range', {});
  const x = session as unknown as Internals;
  const vance = session.slots[5]!;
  vance.state = createMoveState(0, 0, -6);
  const placed = x.placeCharge(vance, SENSOR, 0, DOWN_45);
  const sensor = x.projectiles[0]!;
  const still = () => buildTree('idle', createBrainRegistry());
  const spawn = (dx: number, dz: number) => {
    const id = session.spawnEnemy('rifleman', { x: sensor.state.x + dx, y: 0, z: sensor.state.z + dz, yaw: 0, tree: still() }) as number;
    return (session as unknown as { enemyList: EnemyEntity[] }).enemyList.find((e) => e.netId === id)!;
  };
  const run = (ticks: number, each?: () => void) => {
    for (let i = 0; i < ticks; i++) {
      each?.();
      session.step((session.tick + 1) * TICK_SECONDS * 1000);
    }
  };
  const marked = () => session.currentMarks.map((m) => m.target);
  return { session, x, vance, placed, sensor, spawn, run, marked };
}

/** Walk an enemy along +x at 1.5 m/s each tick. */
const walk = (e: EnemyEntity) => () => {
  e.state.x += 1.5 * TICK_SECONDS;
};

describe('the motion sensor (U-057)', () => {
  it('is data: a placed device, 90 s, 15 m, over 0.5 m/s, and Vance carries one in slot 5', () => {
    expect(getProjectile('sensor')).toMatchObject({ kind: 'placed', maxLifeSeconds: 90, senseM: 15, senseSpeedMps: 0.5, blastDamage: 0, carried: 1 });
    const session = new Session(undefined, '', 'range', { roomLobby: true });
    expect(session.slots[5]!.pouch[SENSOR]).toBe(1);
    expect(session.slots[5]!.equipment).toBe(SENSOR);
    expect(session.slots[4]!.pouch[SENSOR]).toBe(0);
  });

  it('is put on a surface like C4 and spends the one', () => {
    const { x, vance, placed, sensor } = scene();
    expect(placed).toBe(true);
    expect(vance.pouch[SENSOR]).toBe(0);
    expect(sensor.stuck).toBe(true);
    expect(x.projectiles).toHaveLength(1);
  });

  it('marks a moving enemy in range for the squad, and not a still one', () => {
    const { spawn, run, marked } = scene();
    const mover = spawn(6, 3);
    const still = spawn(-6, 3);
    run(4, walk(mover));
    expect(marked()).toEqual([mover.netId]);
    expect(marked()).not.toContain(still.netId);
  });

  it('is not line-of-sight dependent: the sensing code never casts a ray, so walls cannot block it', () => {
    const { session, spawn, run, marked } = scene();
    const mover = spawn(9, 9);
    // Whatever stands between them, sensing never asks for a line of sight.
    expect(session.currentMarks).toHaveLength(0);
    run(4, walk(mover));
    expect(marked()).toContain(mover.netId);
  });

  it('does not mark an enemy beyond 15 m', () => {
    const { spawn, run, marked } = scene();
    const far = spawn(20, 0);
    run(4, walk(far));
    expect(marked()).toEqual([]);
  });

  it('fades the mark when the enemy stops, and when it leaves range', () => {
    const { spawn, run, marked } = scene();
    const e = spawn(6, 0);
    run(4, walk(e));
    expect(marked()).toEqual([e.netId]);
    run(40);
    expect(marked()).toEqual([]);
    run(4, walk(e));
    expect(marked()).toEqual([e.netId]);
    e.state.x += 30;
    run(40, walk(e));
    expect(marked()).toEqual([]);
  });

  it('marks nothing once E has taken it back, and its marks go with it', () => {
    const { x, vance, spawn, run, marked } = scene();
    const e = spawn(2, 1);
    run(4, walk(e));
    expect(marked()).toEqual([e.netId]);
    vance.state = createMoveState(x.projectiles[0]!.state.x, 0, x.projectiles[0]!.state.z - 1);
    expect(x.takeOwnCharge(vance)).toBe(true);
    expect(vance.pouch[SENSOR]).toBe(1);
    run(40, walk(e));
    expect(marked()).toEqual([]);
  });

  it('right click does not set it off, and it expires at 90 s', () => {
    const { x, vance, sensor, run } = scene();
    x.detonateCharges(vance, SENSOR);
    expect(x.projectiles).toHaveLength(1);
    sensor.state.age = sensor.def.maxLifeSeconds - TICK_SECONDS / 2;
    run(2);
    expect(x.projectiles).toHaveLength(0);
  });

  it('is destroyed by a blast within 2 m, not by one beyond it', () => {
    const { x, sensor, run } = scene();
    const frag = { def: getProjectile('frag'), kind: 0, netId: 999, ownerSlot: 0, ownerNetId: 1, xpPlayerId: 0, state: { ...sensor.state } };
    x.detonate(frag, { x: sensor.state.x + 3, y: sensor.state.y, z: sensor.state.z });
    run(1);
    expect(x.projectiles).toHaveLength(1);
    x.detonate(frag, { x: sensor.state.x + 1.5, y: sensor.state.y, z: sensor.state.z });
    run(1);
    expect(x.projectiles).toHaveLength(0);
  });
});
