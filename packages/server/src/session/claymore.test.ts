/**
 * U-055: the claymore. Placed on a surface facing where the sniper looks, it
 * goes off by itself when the other side comes into its cone, or by its
 * owner's hand, and hurts only inside that cone.
 */
import { describe, expect, it } from 'vitest';
import { PROJECTILE_IDS, TICK_SECONDS, buildTree, createMoveState, degToAngle, getProjectile } from '@sandline/shared';
import { createBrainRegistry } from '../ai/Brain.ts';
import { type EnemyEntity, Session, type Slot } from './Session.ts';

const CLAYMORE = PROJECTILE_IDS.indexOf('claymore');
const DOWN_45 = degToAngle(-45) & 0xfff;

interface Internals {
  placeCharge(slot: Slot, projectile: number, yaw: number, pitch: number): boolean;
  detonateCharges(slot: Slot, kind: number): void;
  projectiles: { kind: number; stuck?: boolean; facing?: { x: number; z: number }; state: { x: number; z: number } }[];
}

/** Marsh (slot 4) on open ground at the origin, having put his claymore down facing +z (yaw 0). */
function scene(yaw = 0) {
  const session = new Session(undefined, '', 'range', {});
  const x = session as unknown as Internals;
  const marsh = session.slots[4]!;
  marsh.state = createMoveState(0, 0, -6);
  const placed = x.placeCharge(marsh, CLAYMORE, yaw, DOWN_45);
  const still = () => buildTree('idle', createBrainRegistry());
  const spawn = (dx: number, dz: number) => {
    const mine = x.projectiles[0]!;
    const id = session.spawnEnemy('rifleman', { x: mine.state.x + dx, y: 0, z: mine.state.z + dz, yaw: 0, tree: still() }) as number;
    return (session as unknown as { enemyList: EnemyEntity[] }).enemyList.find((e) => e.netId === id)!;
  };
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) session.step((session.tick + 1) * TICK_SECONDS * 1000);
  };
  return { session, x, marsh, placed, spawn, run };
}

describe('the claymore (U-055)', () => {
  it('is data: a placed mine, 60 degrees, 3 m, 150 damage, and Marsh carries one in slot 5', () => {
    expect(getProjectile('claymore')).toMatchObject({ kind: 'placed', coneDeg: 60, triggerM: 3, blastDamage: 150, blastRadiusM: 3, carried: 1 });
    const session = new Session(undefined, '', 'range', { roomLobby: true });
    expect(session.slots[4]!.pouch[CLAYMORE]).toBe(1);
    expect(session.slots[4]!.equipment).toBe(CLAYMORE);
    expect(session.slots[5]!.pouch[CLAYMORE]).toBe(0);
  });

  it('is put on the ground facing the way he looks, and spends the one', () => {
    const { x, marsh, placed } = scene(1024);
    expect(placed).toBe(true);
    expect(marsh.pouch[CLAYMORE]).toBe(0);
    const [mine] = x.projectiles;
    expect(mine!.stuck).toBe(true);
    // Yaw 1024 of 4096 is a quarter turn: facing along +x.
    expect(Math.abs(mine!.facing!.x)).toBeGreaterThan(0.99);
    expect(Math.abs(mine!.facing!.z)).toBeLessThan(0.01);
  });

  it('goes off by itself when an enemy walks into its cone, and hurts it', () => {
    const { x, spawn, run } = scene();
    const inFront = spawn(0, 2);
    const before = inFront.health.current;
    run(3);
    expect(x.projectiles).toHaveLength(0);
    expect(inFront.health.current).toBeLessThan(before);
  });

  it('is not tripped by an enemy behind it, to the side, or beyond 3 m in front', () => {
    const { x, spawn, run } = scene();
    spawn(0, -2);
    spawn(2.5, 0.2);
    spawn(0, 5);
    run(10);
    expect(x.projectiles).toHaveLength(1);
  });

  it('is not tripped by the squad walking past', () => {
    const { session, x, run } = scene();
    const mate = session.slots[1]!;
    const mine = x.projectiles[0]!;
    mate.state = createMoveState(mine.state.x, 0, mine.state.z + 1.5);
    run(10);
    expect(x.projectiles).toHaveLength(1);
  });

  it('by hand it hurts only inside the cone: the one in front, and a mate there, not the one behind', () => {
    const { session, x, marsh, spawn } = scene();
    const front = spawn(0, 1.5);
    const behind = spawn(0, -1.5);
    const mate = session.slots[1]!;
    const mine = x.projectiles[0]!;
    mate.state = createMoveState(mine.state.x + 0.3, 0, mine.state.z + 1.2);
    const [f0, b0, m0] = [front.health.current, behind.health.current, mate.health.current];
    x.detonateCharges(marsh, CLAYMORE);
    expect(x.projectiles).toHaveLength(0);
    expect(front.health.current).toBeLessThan(f0);
    expect(mate.health.current).toBeLessThan(m0);
    expect(behind.health.current).toBe(b0);
  });
});
