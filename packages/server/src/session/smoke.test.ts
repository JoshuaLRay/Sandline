/**
 * U-058: the smoke grenade. Its pop releases a cloud that lasts, blocks sight
 * for the other side's eyes, thins over its last seconds, and goes quietly;
 * bullets and blasts pass through it as ever.
 */
import { describe, expect, it } from 'vitest';
import { PROJECTILE_IDS, TICK_SECONDS, buildTree, createMoveState, getProjectile } from '@sandline/shared';
import { createBrainRegistry } from '../ai/Brain.ts';
import { type EnemyEntity, Session, type Slot } from './Session.ts';

const SMOKE = PROJECTILE_IDS.indexOf('smoke');
const CLOUD = PROJECTILE_IDS.indexOf('smokecloud');

interface Live {
  kind: number;
  stuck?: boolean;
  state: { x: number; y: number; z: number; age: number };
}
interface Internals {
  detonate(p: unknown, at: { x: number; y: number; z: number }): void;
  projectiles: Live[];
  smokeClouds(): { x: number; y: number; z: number; radiusM: number }[];
  launch(t: Slot, ownerSlot: number, projectile: number, yaw: number, pitch: number): boolean;
}

function scene() {
  const session = new Session(undefined, '', 'range', {});
  const x = session as unknown as Internals;
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) session.step((session.tick + 1) * TICK_SECONDS * 1000);
  };
  const pop = (at = { x: 0, y: 0.1, z: 30 }) => {
    const owner = session.slots[3]!;
    const def = getProjectile('smoke');
    x.detonate({ netId: 88888, def, kind: SMOKE, ownerSlot: 3, ownerNetId: owner.netId, xpPlayerId: null, state: { x: at.x, y: at.y, z: at.z, vx: 0, vy: 0, vz: 0, age: 0, bounces: 0, resting: false } }, at);
    run(1);
  };
  return { session, x, run, pop };
}

const clouds = (x: Internals) => x.projectiles.filter((p) => p.kind === CLOUD);

describe('the smoke grenade (U-058)', () => {
  it('is data: a 2 s thrown canister that does no damage and releases a 5 m cloud lasting 20 s; Ortiz carries 2', () => {
    expect(getProjectile('smoke')).toMatchObject({ kind: 'thrown', fuseSeconds: 2, blastDamage: 0, releases: 'smokecloud', carried: 2 });
    expect(getProjectile('smokecloud')).toMatchObject({ kind: 'placed', smokeM: 5, maxLifeSeconds: 20, releases: '' });
    const session = new Session(undefined, '', 'range', { roomLobby: true });
    expect(session.slots[3]!.pouch[SMOKE]).toBe(2);
    expect(session.slots[3]!.equipment).toBe(SMOKE);
    expect(session.slots[0]!.pouch[SMOKE]).toBe(0);
  });

  it('a pop leaves a cloud where it went off, hurts no one, and is not offered back with E', () => {
    const { session, x, pop } = scene();
    const before = session.slots.map((s) => s.health.current);
    pop();
    expect(clouds(x)).toHaveLength(1);
    expect(clouds(x)[0]!.stuck).toBe(true);
    expect(clouds(x)[0]!.state.z).toBeCloseTo(30, 1);
    expect(session.slots.map((s) => s.health.current)).toEqual(before);
    // The owner beside it cannot take it into her pouch.
    const ortiz = session.slots[3]!;
    ortiz.state = createMoveState(0, 0, 29);
    (session as unknown as { takeOwnCharge(s: Slot): boolean }).takeOwnCharge(ortiz);
    expect(clouds(x)).toHaveLength(1);
  });

  it('lasts 20 s, thins over the last 4 s, and then goes quietly', () => {
    const { x, run, pop } = scene();
    pop();
    const full = x.smokeClouds()[0]!;
    expect(full.radiusM).toBeCloseTo(5, 5);
    run(Math.round(10 / TICK_SECONDS));
    expect(x.smokeClouds()[0]!.radiusM).toBeCloseTo(5, 5);
    run(Math.round(8 / TICK_SECONDS)); // 18 s: two seconds left of the four
    expect(x.smokeClouds()[0]!.radiusM).toBeGreaterThan(1.5);
    expect(x.smokeClouds()[0]!.radiusM).toBeLessThan(3.5);
    run(Math.round(3 / TICK_SECONDS));
    expect(clouds(x)).toHaveLength(0);
    expect(x.smokeClouds()).toHaveLength(0);
  });

  it('conceals a squad soldier from an enemy who could see them, and only while the cloud is between', () => {
    const { session, x, run, pop } = scene();
    const still = () => buildTree('idle', createBrainRegistry());
    const mate = session.slots[0]!;
    mate.state = createMoveState(0, 0, 10);
    const id = session.spawnEnemy('rifleman', { x: 0, y: 0, z: 35, yaw: 512, tree: still() }) as number;
    const enemy = (session as unknown as { enemyList: EnemyEntity[] }).enemyList.find((e) => e.netId === id)!;
    const sees = () => enemy.memory.entries.get(mate.netId)?.visible === true;
    run(150);
    expect(sees()).toBe(true);
    // A cloud between the two, on the line.
    pop({ x: 0, y: 0.1, z: 22 });
    run(90);
    expect(sees()).toBe(false);
    // When it has gone, the enemy sees again.
    run(Math.round(21 / TICK_SECONDS));
    expect(clouds(x)).toHaveLength(0);
    run(90);
    expect(sees()).toBe(true);
  });
});
