/**
 * A friendly bot with health kits heals a hurt squadmate (U-053), through the
 * same host path a human's kit takes (`Session.updateKits`): it walks to them,
 * holds the use for the kit's time, and spends one. A downed mate is still the
 * revive's (faster), a healthy one is left alone, and with no kits it does not go.
 *
 * U-084: and a hurt bot with a kit and nobody else to heal uses it on itself where it stands, under no order or a hold,
 * but not while it is on its way somewhere under a move order, nor with no kits.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ClientConnection, DAMAGE, buildTree, createLoopbackPair, createMoveState } from '@sandline/shared';
import { createBrainRegistry } from '../Brain.ts';
import { type NavMesh, initNav } from '../nav/NavMesh.ts';
import { loadWorldNavMesh } from '../nav/bakedNav.ts';
import { Session } from '../../session/Session.ts';

const TICK_MS = 1000 / 30;

let mesh: NavMesh;
beforeAll(async () => {
  await initNav();
  mesh = loadWorldNavMesh('range');
});

/** A human standing still in slot 0 (the first join), and the session with the friendly tree on the rest. */
function room() {
  const session = new Session(undefined, '', 'range', { navMesh: mesh, brainTree: buildTree('friendly', createBrainRegistry()) });
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  let tick = 0;
  const client = new ClientConnection(pair.b, {});
  client.join('hurt');
  pair.settle();
  session.slots.forEach((s, i) => (s.state = i === 0 ? createMoveState(0, 0, -6) : i === 1 ? createMoveState(6, 0, -6) : createMoveState(-60 + i * 4, 0, -95)));
  const run = (ticks: number, until?: () => boolean): number => {
    for (let t = 0; t < ticks; t++) {
      client.send({ kind: 'Input', tick: ++tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0 });
      pair.settle();
      session.step((session.tick + 1) * TICK_MS);
      if (until?.()) return t + 1;
    }
    return ticks;
  };
  return { session, run };
}

describe('a friendly bot heals (U-053)', () => {
  it('walks to a hurt mate, holds the use for the kit\'s time, and spends one kit', () => {
    const { session, run } = room();
    const hurt = session.slots[0]!;
    const bot = session.slots[1]!;
    hurt.health.current = 20;
    const kits = bot.kits;
    expect(kits).toBe(3);
    const took = run(30 * 40, () => hurt.health.current === hurt.health.max);
    expect(hurt.health.current).toBe(hurt.health.max);
    expect(bot.kits).toBe(kits - 1);
    // The kit's own time (10 s, 8 s for the support) plus a short walk: not instant, not endless.
    expect(took / 30).toBeGreaterThan(DAMAGE.kit.seconds);
    expect(took / 30).toBeLessThan(DAMAGE.kit.seconds + 12);
  });

  it('leaves a mate who is only a little hurt alone, and goes nowhere with no kits', () => {
    const a = room();
    a.session.slots[0]!.health.current = 80; // above the share a bot heals below
    a.run(30 * 15);
    expect(a.session.slots[1]!.kits).toBe(3);
    expect(a.session.slots[0]!.health.current).toBe(80);

    const b = room();
    b.session.slots[0]!.health.current = 20;
    b.session.slots[1]!.kits = 0;
    b.run(30 * 15);
    expect(b.session.slots[0]!.health.current).toBe(20);
  });

  it('a downed mate is revived, not given a kit', () => {
    const { session, run } = room();
    const downed = session.slots[0]!;
    Object.assign(downed.health, { current: 0, downedAt: (session.tick * TICK_MS) / 1000, diedAt: null });
    run(30 * 20, () => downed.health.downedAt === null && downed.health.current > 0);
    expect(downed.health.downedAt).toBeNull();
    expect(session.slots[1]!.kits).toBe(3);
  });
});

describe('a friendly bot heals itself (U-084)', () => {
  it('uses a kit on itself where it stands when it is hurt and nobody else is', () => {
    const { session, run } = room();
    const bot = session.slots[1]!;
    bot.health.current = 30;
    const at = { x: bot.state.x, z: bot.state.z };
    run(30 * 20, () => bot.health.current === bot.health.max);
    expect(bot.health.current).toBe(bot.health.max);
    expect(bot.kits).toBe(2);
    expect(Math.hypot(bot.state.x - at.x, bot.state.z - at.z)).toBeLessThan(1.5);
  });

  it('does so on a hold order too, and stays at its post', () => {
    const { session, run } = room();
    const bot = session.slots[1]!;
    session.orderFrom(0, { order: 'hold', address: { to: 'slot', index: 1 }, point: null, target: null });
    bot.health.current = 30;
    run(30 * 20, () => bot.health.current === bot.health.max);
    expect(bot.health.current).toBe(bot.health.max);
    expect(bot.kits).toBe(2);
    expect(session.orderFor(1)?.order).toBe('hold');
  });

  it('does not stop for it on the way somewhere under a move order, nor with no kits', () => {
    const moving = room();
    const walker = moving.session.slots[1]!;
    moving.session.orderFrom(0, { order: 'move', address: { to: 'slot', index: 1 }, point: { x: 6, y: 0, z: 30 }, target: null });
    walker.health.current = 30;
    moving.run(30 * 4);
    expect(walker.kits).toBe(3);
    expect(walker.state.z).toBeGreaterThan(-6 + 5);

    const bare = room();
    const none = bare.session.slots[1]!;
    none.kits = 0;
    none.health.current = 30;
    bare.run(30 * 15);
    expect(none.health.current).toBe(30);
  });
});
