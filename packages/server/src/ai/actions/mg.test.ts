/**
 * The MG on the session (T-3.23): it fires only once deployed — still for its
 * archetype's `deploy.seconds` — and packs up whenever it moves; every enemy
 * fires in bursts of its archetype's length. The fight as a whole, against
 * the rifleman, is `pnpm sim-run --scenario mg` (tools/src/scenarios).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { TREE_DEFS, buildTree, createMoveState, getEnemy, parseTreeDef } from '@sandline/shared';
import { type BrainMemory, type BrainTree, createBrainRegistry } from '../Brain.ts';
import { type NavMesh, initNav } from '../nav/NavMesh.ts';
import { loadWorldNavMesh } from '../nav/bakedNav.ts';
import { type EnemyEntity, Session } from '../../session/Session.ts';

const TICK_MS = 1000 / 30;
const MG = getEnemy('mg');
const RIFLEMAN = getEnemy('rifleman');

let mesh: NavMesh;
beforeAll(async () => {
  await initNav();
  mesh = loadWorldNavMesh('range');
});

/** A fixture tree of one action that writes `memory` onto the blackboard every think. */
function wants(memory: () => Partial<BrainMemory>): BrainTree {
  const registry = createBrainRegistry().action('want', ({ blackboard }) => {
    for (const [k, v] of Object.entries(memory())) blackboard.set(k as keyof BrainMemory, v as never);
    return 'running';
  });
  return buildTree(parseTreeDef({ id: 'test-want', root: { type: 'action', name: 'want' } }), registry);
}

/** A range with slot 0 standing in the open at the south end of a clear lane (x = 16, between the posts), every other slot parked. */
function lane() {
  const session = new Session(undefined, '', 'range', { navMesh: mesh });
  session.slots.forEach((s, i) => (s.state = i === 0 ? createMoveState(16, 0, -18) : createMoveState(-60 + i * 4, 0, -95)));
  const target = session.slots[0]!;
  const step = (ticks: number, each?: (t: number) => void) => {
    for (let i = 0; i < ticks; i++) {
      session.step((session.tick + 1) * TICK_MS);
      // The target lives through it: this is about when the gun fires, not what it does.
      Object.assign(target.health, { current: 100, downedAt: null, diedAt: null });
      each?.(session.tick);
    }
  };
  return { session, target, step };
}

function spawn(session: Session, archetype: string, tree: BrainTree, at = { x: 16, z: 0 }): EnemyEntity {
  const id = session.spawnEnemy(archetype, { x: at.x, y: 0, z: at.z, yaw: 512, tree }) as number;
  return session.enemies.find((e) => e.netId === id)!;
}

describe('the MG archetype (T-3.23)', () => {
  it('runs its own committed tree, which binds to the server registry', () => {
    expect(TREE_DEFS.has('mg')).toBe(true);
    expect(() => buildTree(MG.tree, createBrainRegistry())).not.toThrow();
    expect(MG.deploy).not.toBeNull();
    expect(RIFLEMAN.deploy).toBeNull();
  });

  it('does not fire while it moves, nor until it has stood still its deploy time; then it does', () => {
    const { session, target, step } = lane();
    let goal: { x: number; y: number; z: number } | null = { x: 16, y: 0, z: 8 };
    const mg = spawn(
      session,
      'mg',
      wants(() => ({ fireAt: target.netId, intent: goal ? { goal, pace: 'walk' } : null })),
    );
    let movingShots = 0;
    let lastMoved = -1;
    const watch = (tick: number) => {
      if (mg.speed > MG.deploy!.movingSpeedMps) lastMoved = tick;
    };
    step(60, (tick) => {
      watch(tick);
      if (mg.speed > 0.5) movingShots = mg.weaponState.shotIndex;
    });
    // It walked, aiming at a soldier in plain view the whole way, and never fired.
    expect(mg.state.z).toBeGreaterThan(2);
    expect(movingShots).toBe(0);
    expect(session.deployed(mg)).toBe(false);
    goal = null;
    // From the last tick it moved, nothing for deploy.seconds; then it fires.
    let firstShot: number | null = null;
    step(Math.ceil((MG.deploy!.seconds + 1.5) * 30), (tick) => {
      watch(tick);
      if (firstShot === null && mg.weaponState.shotIndex > 0) firstShot = tick;
    });
    expect(firstShot).not.toBeNull();
    expect(lastMoved).toBeGreaterThan(0);
    expect((firstShot! - lastMoved) / 30).toBeGreaterThanOrEqual(MG.deploy!.seconds);
    expect(session.deployed(mg)).toBe(true);
    // And moving again packs it up.
    goal = { x: 16, y: 0, z: -4 };
    const before = mg.weaponState.shotIndex;
    step(45);
    expect(session.deployed(mg)).toBe(false);
    expect(mg.weaponState.shotIndex - before).toBeLessThan(MG.accuracy.burstRounds);
  });

  it('fires in bursts of its archetype’s length, pausing between them — the MG’s far longer than the rifleman’s', () => {
    for (const def of [RIFLEMAN, MG]) {
      const { session, target, step } = lane();
      const e = spawn(session, def.id, wants(() => ({ fireAt: target.netId })));
      const shotTicks: number[] = [];
      let last = 0;
      step(30 * 6, (tick) => {
        const fired = e.weaponState.shotIndex - last;
        last = e.weaponState.shotIndex;
        for (let i = 0; i < fired; i++) shotTicks.push(tick);
      });
      expect(shotTicks.length).toBeGreaterThan(def.accuracy.burstRounds);
      // Runs of shots split wherever the gap is the pause or longer (a reload is longer still).
      const pauseTicks = Math.floor(def.accuracy.burstPauseSeconds * 30);
      const bursts: number[] = [1];
      for (let i = 1; i < shotTicks.length; i++) {
        if (shotTicks[i]! - shotTicks[i - 1]! >= pauseTicks) bursts.push(1);
        else bursts[bursts.length - 1]!++;
      }
      console.log(`${def.id}: bursts of ${bursts.join(', ')} rounds in 6 s`);
      // No burst runs past the archetype's length.
      expect(Math.max(...bursts)).toBeLessThanOrEqual(def.accuracy.burstRounds);
    }
    expect(MG.accuracy.burstRounds).toBeGreaterThanOrEqual(RIFLEMAN.accuracy.burstRounds * 3);
  });
});
