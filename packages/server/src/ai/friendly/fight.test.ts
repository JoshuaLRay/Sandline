/**
 * Friendly bots fight and revive (T-3.26), on real `Session`s over the range's
 * navmesh and baked cover.
 *
 * - A bot revives a downed human through the human's held-interact path, in
 *   the same time a human reviver takes.
 * - A bot never fires with a squadmate's capsule on the line to its target.
 * - A bot under fire takes cover within its formation band.
 *
 * The squad-against-riflemen fight as a whole is `pnpm sim-run --scenario
 * squad` (tools/src/scenarios).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ClientConnection,
  DAMAGE,
  buildTree,
  createLoopbackPair,
  createMoveState,
  formationBand,
  parseTreeDef,
} from '@sandline/shared';
import { type BrainMemory, type BrainTree, createBrainRegistry } from '../Brain.ts';
import { type NavMesh, initNav } from '../nav/NavMesh.ts';
import { bakedCoverFor, loadWorldNavMesh } from '../nav/bakedNav.ts';
import { Session } from '../../session/Session.ts';

const TICK_MS = 1000 / 30;

let mesh: NavMesh;
beforeAll(async () => {
  await initNav();
  mesh = loadWorldNavMesh('range');
});

/** A human over loopback: joins on creation; `hold` sends one tick of standing still, E held or not. */
function human(session: Session, name: string) {
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  let slot = -1;
  let tick = 0;
  const client = new ClientConnection(pair.b, {
    onJoinAck: (_netId, s) => {
      slot = s;
    },
  });
  client.join(name);
  pair.settle();
  return {
    get slot() {
      return slot;
    },
    hold(interact = false) {
      client.send({ kind: 'Input', tick: ++tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: interact ? 0b1000 : 0 });
      pair.settle();
    },
  };
}

function down(session: Session, slotIndex: number): void {
  const slot = session.slots[slotIndex]!;
  Object.assign(slot.health, { current: 0, downedAt: (session.tick * TICK_MS) / 1000, diedAt: null });
}

/** Ticks from the revive lock being taken to the target standing again, or null. */
function reviveTicks(session: Session, target: number, each: () => void, limit = 30 * 20): { lockAfter: number | null; took: number | null } {
  let locked: number | null = null;
  for (let t = 0; t < limit; t++) {
    each();
    session.step((session.tick + 1) * TICK_MS);
    const slot = session.slots[target]!;
    if (locked === null && slot.reviveBySlot >= 0) locked = t;
    if (slot.health.downedAt === null && slot.health.current > 0) return { lockAfter: locked, took: locked === null ? null : t - locked + 1 };
  }
  return { lockAfter: locked, took: null };
}

describe('a friendly bot revives (T-3.26)', () => {
  it('a downed human, through the held-interact path, in the time a human reviver takes', () => {
    // A bot doing it: slot 0 is the downed human, slot 1 a bot 6 m away running the friendly tree.
    const withBot = new Session(undefined, '', 'range', { navMesh: mesh, brainTree: buildTree('friendly', createBrainRegistry()) });
    const downed = human(withBot, 'downed');
    withBot.slots.forEach((s, i) => (s.state = i === 0 ? createMoveState(0, 0, -6) : i === 1 ? createMoveState(6, 0, -6) : createMoveState(-60 + i * 4, 0, -95)));
    down(withBot, 0);
    const byBot = reviveTicks(withBot, 0, () => downed.hold());
    expect(withBot.slots[0]!.reviveBySlot).toBe(-1);
    expect(byBot.took).not.toBeNull();

    // A human doing it: the same two slots, both human, the reviver holding E beside it from the start.
    const withHuman = new Session(undefined, '', 'range', { navMesh: mesh });
    const downed2 = human(withHuman, 'downed');
    const reviver = human(withHuman, 'reviver');
    withHuman.slots.forEach((s, i) => (s.state = i === 0 ? createMoveState(0, 0, -6) : i === 1 ? createMoveState(0.8, 0, -6) : createMoveState(-60 + i * 4, 0, -95)));
    down(withHuman, 0);
    const byHuman = reviveTicks(withHuman, 0, () => {
      downed2.hold();
      reviver.hold(true);
    });
    console.log(`revive: a bot took the lock after ${(byBot.lockAfter! / 30).toFixed(2)} s and revived in ${byBot.took} ticks; a human in ${byHuman.took}`);
    expect(byHuman.took).not.toBeNull();
    expect(byBot.took).toBe(byHuman.took);
    expect(byBot.took! / 30).toBeCloseTo(DAMAGE.downed.reviveSeconds, 1);
  });
});

/**
 * A tree that has the body with netId `shooterNetId` fire at `target()` every
 * think and every other body stand — or, with `always`, whoever runs it fire
 * at that netId.
 */
function firingAt(shooterNetId: number, target: () => number, always?: number): BrainTree {
  const registry = createBrainRegistry().action('want', ({ ctx, blackboard }) => {
    const mine: Partial<BrainMemory> = always !== undefined ? { fireAt: always } : ctx.netId === shooterNetId ? { fireAt: target() } : { fireAt: null };
    for (const [k, v] of Object.entries(mine)) blackboard.set(k as keyof BrainMemory, v as never);
    return 'running';
  });
  return buildTree(parseTreeDef({ id: 'test-fire', root: { type: 'action', name: 'want' } }), registry);
}

describe('a friendly bot holds fire (T-3.26)', () => {
  it('never while a squadmate is on the line to its target, and fires once the line is clear', () => {
    let enemyId = -1;
    // Slot 1 (netId 2) shoots; the rifleman stands in the open down a clear lane (x = 16).
    const session = new Session(undefined, '', 'range', { navMesh: mesh, brainTree: firingAt(2, () => enemyId) });
    session.slots.forEach((s, i) => (s.state = i === 1 ? createMoveState(16, 0, 0) : createMoveState(-60 + i * 4, 0, -95)));
    enemyId = session.spawnEnemy('rifleman', { x: 16, y: 0, z: -18, tree: buildTree('idle', createBrainRegistry()) }) as number;
    const enemy = session.enemies.find((e) => e.netId === enemyId)!;
    const bot = session.slots[1]!;
    const mate = session.slots[2]!;
    const run = (ticks: number, at: { x: number; z: number }) => {
      let unsafe = 0;
      const from = bot.weaponState.shotIndex;
      for (let t = 0; t < ticks; t++) {
        mate.state = { ...mate.state, x: at.x, z: at.z };
        const before = bot.weaponState.shotIndex;
        session.step((session.tick + 1) * TICK_MS);
        Object.assign(enemy.health, { current: enemy.health.max, downedAt: null, diedAt: null });
        // Every round it fires, checked against the squadmate where it stood.
        if (bot.weaponState.shotIndex > before) {
          const eye = { x: bot.state.x, y: bot.state.y + 1.6, z: bot.state.z };
          if (session.friendOnLine(bot.netId, eye, { x: enemy.state.x, y: enemy.state.y + 1.2, z: enemy.state.z })) unsafe++;
        }
      }
      return { fired: bot.weaponState.shotIndex - from, unsafe };
    };
    // Squarely in the way, and a hand's breadth off the line: nothing.
    expect(run(90, { x: 16, z: -9 })).toEqual({ fired: 0, unsafe: 0 });
    expect(run(90, { x: 16.6, z: -9 })).toEqual({ fired: 0, unsafe: 0 });
    // Well aside: it fires, and never with the squadmate on the line.
    const clear = run(90, { x: 20, z: -9 });
    console.log(`hold fire: ${clear.fired} rounds once the squadmate stepped 4 m aside`);
    expect(clear.fired).toBeGreaterThan(0);
    expect(clear.unsafe).toBe(0);
    expect(session.friendlyHits).toBe(0);
  });
});

describe('a friendly bot under fire (T-3.26)', () => {
  it('takes cover within its formation band', () => {
    const session = new Session(undefined, '', 'range', {
      navMesh: mesh,
      cover: bakedCoverFor('range'),
      brainTree: buildTree('friendly', createBrainRegistry()),
    });
    // The lead, a human, stands just south of the low wall (x −12..−6, z −1), hidden from up range; its wedge closes up
    // behind it. Slot 1 is out in the open north of the wall, where the rifleman up range can see it.
    const lead = human(session, 'lead');
    expect(lead.slot).toBe(0);
    session.slots.forEach((s, i) => (s.state = i === 0 ? createMoveState(-9, 0, -3) : i === 1 ? createMoveState(-10.5, 0, 4) : createMoveState(-60 + i * 4, 0, -95)));
    const bot = session.slots[1]!;
    // A rifleman up range fires at slot 1 and nobody else, and stays up.
    const shooter = session.spawnEnemy('rifleman', { x: -9, y: 0, z: 24, yaw: 512, tree: firingAt(-1, () => -1, bot.netId) }) as number;
    const enemy = session.enemies.find((e) => e.netId === shooter)!;

    let covered: number | null = null;
    for (let t = 0; t < 30 * 12 && covered === null; t++) {
      lead.hold();
      session.step((session.tick + 1) * TICK_MS);
      for (const s of session.slots) Object.assign(s.health, { current: 100, downedAt: null, diedAt: null });
      Object.assign(enemy.health, { current: enemy.health.max, downedAt: null, diedAt: null });
      const point = session.cover!.heldPoint(bot.netId);
      if (point && Math.hypot(bot.state.x - point.x, bot.state.z - point.z) <= 0.4) covered = t;
    }
    expect(covered).not.toBeNull();
    const point = session.cover!.heldPoint(bot.netId)!;
    const place = session.formationPlace(1)!;
    const fromPlace = Math.hypot(point.x - place.goal.x, point.z - place.goal.z);
    console.log(`under fire: in cover after ${(covered! / 30).toFixed(1)} s, ${fromPlace.toFixed(2)} m from its place (band ${formationBand(place.offset).toFixed(2)} m)`);
    expect(bot.target).toBe(enemy.netId);
    expect(fromPlace).toBeLessThanOrEqual(formationBand(place.offset));
    // And the cover hides it from the rifleman.
    expect(session.cover!.stillProtects(bot.netId, [{ x: enemy.state.x, y: enemy.state.y + 1.6, z: enemy.state.z }])).toBe(true);
  });
});
