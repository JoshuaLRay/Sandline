/**
 * U-027: a bot that ends up on top of the large rubble pile still answers
 * its next order. On a real `Session` on the kit gallery (where the pile
 * stands, x −18 z 24: a 2.2 × 1.6 m box, 1.0 m high), the friendly tree in
 * every bot slot, the gallery's baked navmesh, and a human lead giving
 * orders over loopback.
 *
 * What went wrong (reproduced before the fix): the navmesh has a walkable
 * island on the pile's top, and the only links to it were one-way vaults up
 * from the ground — a vault carries 1.5 m, the pile is 1.6 m deep, so every
 * vault at it lands on top. Nothing led down. A bot sent onto the pile got
 * there and could not path anywhere again: every later order found no route
 * off the island, and the bot stood on the pile for good.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ClientConnection,
  type Message,
  buildTree,
  createLoopbackPair,
  createMoveState,
} from '@sandline/shared';
import { createBrainRegistry } from '../Brain.ts';
import { type NavMesh, initNav } from '../nav/NavMesh.ts';
import { bakedCoverFor, loadWorldNavMesh } from '../nav/bakedNav.ts';
import { type OrderReport, Session } from '../../session/Session.ts';

const TICK_MS = 1000 / 30;
/** The pile's top, and ground well clear of it to the east. */
const PILE = { x: -18, z: 24 };
const PILE_TOP_Y = 1.0;
const AWAY = { x: -10, y: 0, z: 24 };

let mesh: NavMesh;
beforeAll(async () => {
  await initNav();
  mesh = loadWorldNavMesh('kit-gallery');
});

function gallery(botAt: { x: number; y: number; z: number }) {
  const session = new Session(undefined, '', 'kit-gallery', {
    navMesh: mesh,
    cover: bakedCoverFor('kit-gallery'),
    brainTree: buildTree('friendly', createBrainRegistry()),
  });
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  let tick = 0;
  const failed: Extract<Message, { kind: 'OrderFailed' }>[] = [];
  const client = new ClientConnection(pair.b, { onOrderFailed: (m) => failed.push(m) });
  client.join('lead');
  pair.settle();
  // The lead far off in a corner; the other bots out of the way; slot 1 where the test says.
  session.slots.forEach((s, i) => {
    const p = i === 1 ? botAt : { x: 20 + i, y: 0, z: -20 };
    s.state = createMoveState(p.x, p.y, p.z);
  });
  const bot = session.slots[1]!;
  return {
    session,
    bot,
    failed,
    order(point: { x: number; y: number; z: number }) {
      client.send({ kind: 'Order', order: 'move', address: { to: 'slot', index: 1 }, point, target: null });
      pair.settle();
    },
    run(ticks: number) {
      for (let t = 0; t < ticks; t++) {
        client.send({ kind: 'Input', tick: ++tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0 });
        pair.settle();
        session.step((session.tick + 1) * TICK_MS);
        pair.settle();
      }
    },
    reports: (): OrderReport[] => session.orderReports.filter((r) => r.slot === 1),
    onPile: () => Math.abs(bot.state.x - PILE.x) < 1.1 && Math.abs(bot.state.z - PILE.z) < 0.8 && bot.state.y > PILE_TOP_Y - 0.1,
  };
}

describe('bots and the large rubble pile (U-027)', () => {
  it('sent onto the pile, a bot climbs it; ordered away, it comes down and goes', () => {
    const g = gallery({ x: -18, y: 0, z: 19 });
    g.order({ x: PILE.x, y: PILE_TOP_Y, z: PILE.z });
    g.run(30 * 12);
    console.log(`[U-027] ordered onto the pile: at (${g.bot.state.x.toFixed(2)}, ${g.bot.state.y.toFixed(2)}, ${g.bot.state.z.toFixed(2)}); reports ${JSON.stringify(g.reports().map((r) => [r.outcome, r.reason]))}`);
    expect(g.onPile()).toBe(true);

    g.order(AWAY);
    g.run(30 * 15);
    console.log(`[U-027] ordered away: at (${g.bot.state.x.toFixed(2)}, ${g.bot.state.y.toFixed(2)}, ${g.bot.state.z.toFixed(2)}); reports ${JSON.stringify(g.reports().map((r) => [r.outcome, r.reason]))}`);
    expect(g.onPile()).toBe(false);
    expect(Math.hypot(g.bot.state.x - AWAY.x, g.bot.state.z - AWAY.z)).toBeLessThan(2);
    expect(g.reports().at(-1)).toMatchObject({ order: 'move', outcome: 'done' });
  });

  it('left standing on the pile (a player who switched away), a bot still answers its first order', () => {
    const g = gallery({ x: PILE.x, y: PILE_TOP_Y, z: PILE.z });
    g.run(10);
    expect(g.onPile()).toBe(true);
    g.order(AWAY);
    g.run(30 * 15);
    expect(g.onPile()).toBe(false);
    expect(Math.hypot(g.bot.state.x - AWAY.x, g.bot.state.z - AWAY.z)).toBeLessThan(2);
    expect(g.reports().at(-1)).toMatchObject({ order: 'move', outcome: 'done' });
  });

  it('given somewhere it cannot reach, a bot says so and still answers the next order', () => {
    const g = gallery({ x: -18, y: 0, z: 19 });
    g.order({ x: 0, y: 0, z: 500 });
    g.run(15);
    expect(g.reports().at(-1)).toMatchObject({ outcome: 'failed', reason: 'unreachable' });
    expect(g.failed).toHaveLength(1);
    g.order(AWAY);
    g.run(30 * 15);
    expect(Math.hypot(g.bot.state.x - AWAY.x, g.bot.state.z - AWAY.z)).toBeLessThan(2);
    expect(g.reports().at(-1)).toMatchObject({ order: 'move', outcome: 'done' });
  });
});
