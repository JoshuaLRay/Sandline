/**
 * Enemies do not shoot a downed soldier (U-031): the target is dropped the
 * moment the soldier goes down and is not picked up again while it is down.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { buildTree, createMoveState } from '@sandline/shared';
import { createBrainRegistry } from '../ai/Brain.ts';
import { type NavMesh, initNav } from '../ai/nav/NavMesh.ts';
import { loadWorldNavMesh } from '../ai/nav/bakedNav.ts';
import { type EnemyEntity, Session } from './Session.ts';

const TICK_MS = 1000 / 30;
let mesh: NavMesh;
beforeAll(async () => {
  await initNav();
  mesh = loadWorldNavMesh('range');
});

function run(session: Session, ticks: number): void {
  for (let i = 0; i < ticks; i++) session.step((session.tick + 1) * TICK_MS);
}

describe('a downed soldier is not a target (U-031)', () => {
  it('shoots the standing soldier, drops the target when it goes down, and never resumes on it', () => {
    const session = new Session(undefined, '', 'range', { navMesh: mesh });
    session.slots.forEach((s, i) => {
      if (i > 0) s.state = createMoveState(-60 + i * 4, 0, -95);
    });
    const victim = session.slots[0]!;
    victim.state = createMoveState(-2, 0, -4);
    const id = session.spawnEnemy('rifleman', { x: -6, y: 0, z: 22, yaw: 512, tree: buildTree('rifleman', createBrainRegistry()) }) as number;
    const foe = (): EnemyEntity => session.enemies.find((e) => e.netId === id)!;
    const keepUp = () => Object.assign(victim.health, { current: victim.health.max, downedAt: null, diedAt: null });

    // Standing and healthy: it is the target and the enemy fires at it.
    for (let i = 0; i < 30 * 6; i++) {
      keepUp();
      run(session, 1);
    }
    expect(foe().target).toBe(victim.netId);
    expect(foe().weaponState.shotIndex).toBeGreaterThan(0);

    // Down it goes: the enemy drops it and fires no more, for as long as it is down.
    const shotsWhenDowned = foe().weaponState.shotIndex;
    Object.assign(victim.health, { current: 0, downedAt: (session.tick * TICK_MS) / 1000 });
    run(session, 30 * 6);
    expect(foe().target).toBeNull();
    expect(foe().weaponState.shotIndex - shotsWhenDowned).toBeLessThanOrEqual(1);
    expect(victim.health.diedAt).toBeNull();
  });
});
