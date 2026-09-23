/**
 * AI grenades on the session (T-3.22): a rifleman's brain throws through the
 * path a human's Throw takes — its own pouch, its own cooldown — and the
 * grenade the server flies lands where the search said it would.
 *
 * The thrower runs a fixture tree of the two grenade leaves and nothing else,
 * so what is measured is the throw, not the rest of the fight. Its target is
 * slot 0, crouched behind the low wall (x −12..−6, z −1, 1.0 m tall), and it
 * is told where that is on every tick, as though seen: the question is what
 * it does with the knowledge, not whether it can get it.
 */
import { describe, expect, it } from 'vitest';
import { buildTree, createMoveState, getProjectile, isDowned, parseTreeDef, rememberSeen } from '@sandline/shared';
import { type BrainTree, createBrainRegistry } from '../Brain.ts';
import { type EnemyEntity, Session } from '../../session/Session.ts';
import { THROW } from '../throw.ts';

const TICK_MS = 1000 / 30;
const FRAG = getProjectile('frag');
const FRAG_INDEX = 0;
const BEHIND_WALL = { x: -9, y: 0, z: -1.6 };

/** Throw when there is a grenade target and a throw that reaches it; otherwise stand. */
function grenadier(): BrainTree {
  return buildTree(
    parseTreeDef({
      id: 'test-grenadier',
      root: {
        type: 'selector',
        reactive: true,
        children: [
          { type: 'sequence', reactive: true, children: [{ type: 'condition', name: 'grenadeTarget' }, { type: 'action', name: 'throwGrenade' }] },
          { type: 'action', name: 'idle' },
        ],
      },
    }),
    createBrainRegistry(),
  );
}

interface Throw {
  netId: number;
  /** Seconds, the tick it was first in the air. */
  at: number;
  /** Where it was on its last tick in the air: where it went off. */
  landing: { x: number; y: number; z: number };
  done: boolean;
}

interface Range {
  session: Session;
  thrower: EnemyEntity;
  throws: Throw[];
  /** Step `ticks`, moving the target to `where(t)` (seconds) and keeping it crouched. */
  run(ticks: number, where?: (t: number) => { x: number; z: number }): void;
}

function range(opts: { from?: { x: number; z: number }; friend?: { x: number; z: number } } = {}): Range {
  const session = new Session(undefined, '', 'range');
  session.slots.forEach((s, i) => {
    if (i > 0) s.state = createMoveState(-60 + i * 4, 0, -95);
  });
  const target = session.slots[0]!;
  target.state = { ...createMoveState(BEHIND_WALL.x, BEHIND_WALL.y, BEHIND_WALL.z), crouched: true };
  const from = opts.from ?? { x: -9, z: 20 };
  const group = opts.friend ? { group: 1 } : {};
  const id = session.spawnEnemy('rifleman', { x: from.x, y: 0, z: from.z, yaw: 512, tree: grenadier(), ...group }) as number;
  if (opts.friend) session.spawnEnemy('rifleman', { x: opts.friend.x, y: 0, z: opts.friend.z, tree: buildTree('idle', createBrainRegistry()), ...group });
  const thrower = session.enemies.find((e) => e.netId === id)!;
  const throws: Throw[] = [];
  const run = (ticks: number, where?: (t: number) => { x: number; z: number }) => {
    for (let i = 0; i < ticks; i++) {
      const now = (session.tick * TICK_MS) / 1000;
      if (where) {
        const p = where(now);
        target.state = { ...target.state, x: p.x, z: p.z };
      }
      target.state = { ...target.state, crouched: true };
      target.input.crouch = true;
      rememberSeen(thrower.memory, target.netId, { x: target.state.x, y: target.state.y, z: target.state.z }, now, isDowned(target.health));
      session.step((session.tick + 1) * TICK_MS);
      const flying = session.projectilesNow().filter((p) => p.ownerNetId === id);
      for (const t of throws) if (!flying.some((p) => p.netId === t.netId)) t.done = true;
      for (const p of flying) {
        let t = throws.find((x) => x.netId === p.netId);
        if (!t) throws.push((t = { netId: p.netId, at: (session.tick * TICK_MS) / 1000, landing: p, done: false }));
        t.landing = { x: p.x, y: p.y, z: p.z };
      }
    }
  };
  return { session, thrower, throws, run };
}

describe('an AI grenade (T-3.22)', () => {
  it('thrown at a crouched target still behind the low wall, lands within blast reach of it and hurts it', () => {
    const r = range();
    // Long enough for one throw to go off, not for a second to follow it (againSeconds).
    r.run(30 * (THROW.staticSeconds + FRAG.fuseSeconds + 1));
    expect(r.throws.length).toBe(1);
    const t = r.throws[0]!;
    expect(t.done).toBe(true);
    const miss = Math.hypot(t.landing.x - BEHIND_WALL.x, t.landing.z - BEHIND_WALL.z);
    console.log(`AI grenade: thrown at ${t.at.toFixed(2)} s, went off ${miss.toFixed(2)} m from the target, target at ${r.session.slots[0]!.health.current} hp`);
    expect(t.at).toBeGreaterThanOrEqual(THROW.staticSeconds);
    expect(miss).toBeLessThan(FRAG.blastRadiusM);
    expect(r.session.slots[0]!.health.current).toBeLessThan(100);
    // The thrower is untouched: it chose a throw clear of itself.
    expect(r.thrower.health.current).toBe(r.thrower.health.max);
  });

  it('is not thrown where it would catch a group member beside the target', () => {
    const r = range({ friend: { x: -7, z: -4 } });
    r.run(30 * (THROW.staticSeconds + 6));
    expect(r.throws).toEqual([]);
    // With the friend back out of reach, the same thrower throws.
    const far = range({ friend: { x: 10, z: 10 } });
    far.run(30 * (THROW.staticSeconds + 3));
    expect(far.throws.length).toBe(1);
  });

  it('comes out of its own pouch, on its own cooldown', () => {
    const r = range();
    // Harmless, so the target lives; and slower to repeat than the brain asks (againSeconds), so the cooldown shows.
    const cooldown = THROW.againSeconds + 3;
    r.session.tuneProjectile(FRAG_INDEX, { ...FRAG, blastDamage: 0, cooldownSeconds: cooldown });
    expect(r.thrower.pouch[FRAG_INDEX]).toBe(FRAG.carried);
    r.run(30 * (THROW.staticSeconds + cooldown * FRAG.carried + 5));
    const times = r.throws.map((t) => t.at);
    console.log(`AI grenades thrown at ${times.map((s) => s.toFixed(2)).join(', ')} s`);
    expect(r.throws.length).toBe(FRAG.carried);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(cooldown - 1e-9);
    expect(r.thrower.pouch[FRAG_INDEX]).toBe(0);
    // A slot's pouch is its own.
    expect(r.session.slots[0]!.pouch[FRAG_INDEX]).toBe(FRAG.carried);
  });

  it('is not thrown at a target moving behind the wall — until it stops', () => {
    const r = range();
    // Two metres a second, back and forth along the wall.
    const pace = (t: number) => ({ x: -11 + Math.abs(((t * 2) % 8) - 4), z: BEHIND_WALL.z });
    r.run(30 * 12, pace);
    expect(r.throws).toEqual([]);
    r.run(30 * (THROW.staticSeconds + 1.5));
    expect(r.throws.length).toBe(1);
  });
});
