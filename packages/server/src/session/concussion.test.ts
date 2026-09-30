/**
 * U-056: the concussion grenade. Thrown like a frag, it does no damage but
 * suppresses the other side inside its own radius, harder than a frag's
 * blast does; the squad is not suppressed by its own.
 */
import { describe, expect, it } from 'vitest';
import { PROJECTILE_IDS, SUPPRESSION, blastSuppression, buildTree, createProjectileState, getProjectile, suppressionLevel } from '@sandline/shared';
import { createBrainRegistry } from '../ai/Brain.ts';
import { type EnemyEntity, Session } from './Session.ts';

const CONCUSSION = PROJECTILE_IDS.indexOf('concussion');
const FRAG = PROJECTILE_IDS.indexOf('frag');
const TICK_MS = 1000 / 30;

interface Internals {
  detonate(p: unknown, at: { x: number; y: number; z: number }): void;
}

function scene() {
  const session = new Session(undefined, '', 'range', { roomLobby: true });
  const still = () => buildTree('idle', createBrainRegistry());
  const spawn = (x: number, z: number) => session.spawnEnemy('rifleman', { x, y: 0, z, yaw: 0, tree: still() }) as number;
  const enemy = (id: number) => (session as unknown as { enemyList: EnemyEntity[] }).enemyList.find((e) => e.netId === id)!;
  const level = (id: number) => suppressionLevel(enemy(id).suppression, session.tick * (TICK_MS / 1000));
  const blow = (kind: number, at: { x: number; y: number; z: number }) => {
    const def = getProjectile(PROJECTILE_IDS[kind]!);
    const owner = session.slots[0]!;
    (session as unknown as Internals).detonate(
      { netId: 99999, def, kind, ownerSlot: 0, ownerNetId: owner.netId, xpPlayerId: null, state: createProjectileState(at, { x: 0, y: 0, z: 0 }) },
      at,
    );
  };
  return { session, spawn, enemy, level, blow };
}

describe('the concussion grenade (U-056)', () => {
  it('is data: no damage, 8 m, its own suppression, 4 carried, and Preach carries them in slot 5', () => {
    const def = getProjectile('concussion');
    expect(def).toMatchObject({ kind: 'thrown', blastDamage: 0, blastRadiusM: 8, suppression: 1, carried: 4, fuseSeconds: 2.5 });
    expect(getProjectile('frag').suppression).toBe(0);
    const session = new Session(undefined, '', 'range', { roomLobby: true });
    expect(session.slots[0]!.pouch[CONCUSSION]).toBe(4);
    expect(session.slots[0]!.equipment).toBe(CONCUSSION);
  });

  it('suppresses an enemy inside 8 m harder than a frag\'s blast at that distance, falling to nothing at the edge, and hurts no one', () => {
    const { session, spawn, enemy, level, blow } = scene();
    const near = spawn(0, 10);
    const mid = spawn(4, 10);
    const far = spawn(0, 25);
    const at = { x: 0, y: 0, z: 10 };
    const before = [near, mid, far].map((id) => enemy(id).health.current);
    blow(CONCUSSION, at);
    expect(level(near)).toBeGreaterThan(0.85);
    expect(level(mid)).toBeCloseTo(0.5, 1);
    expect(level(mid)).toBeGreaterThan(blastSuppression(4));
    expect(level(far)).toBe(0);
    expect([near, mid, far].map((id) => enemy(id).health.current)).toEqual(before);
    expect(session.slots.every((s) => s.health.current === s.health.max)).toBe(true);
  });

  it('a frag still uses the shared curve, so nothing else changed', () => {
    const { spawn, level, blow } = scene();
    const id = spawn(0, 10);
    // Five metres off, so the frag hurts it without killing it (a dead enemy is not suppressed).
    blow(FRAG, { x: 0, y: 0, z: 15 });
    expect(level(id)).toBeCloseTo(SUPPRESSION.blast * (1 - 5.1 / SUPPRESSION.blastRadiusM), 1);
  });

  it('does not suppress the squad that threw it', () => {
    const { session, blow } = scene();
    const mate = session.slots[1]!;
    blow(CONCUSSION, { x: mate.state.x, y: mate.state.y, z: mate.state.z });
    expect(suppressionLevel(mate.suppression, session.tick * (TICK_MS / 1000))).toBe(0);
  });
});
