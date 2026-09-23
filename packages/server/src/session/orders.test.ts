/**
 * Orders and marks on the session (T-3.27): real `Session`s, humans over
 * loopback. An order from a human reaches the bots it names and nobody else;
 * an order to a human's slot is dropped; the last order to a bot stands and
 * every client sees it; marks expire on their data-set time; and what the
 * wire lets through but the session cannot honour is refused.
 */
import { describe, expect, it } from 'vitest';
import {
  type BotOrder,
  ClientConnection,
  type Message,
  ORDERS,
  PROTOCOL_VERSION,
  SQUAD,
  type TargetMark,
  buildTree,
  createLoopbackPair,
  encodeMessage,
} from '@sandline/shared';
import { createBrainRegistry } from '../ai/Brain.ts';
import { Session } from './Session.ts';

const TICK_MS = 1000 / 30;

/** Every loopback in the test, so a message from one client delivers the host's broadcast to all of them. */
const links: (() => void)[] = [];
// Twice over: a message delivered on one link can raise a broadcast on a link already settled.
const settleAll = () => {
  links.forEach((settle) => settle());
  links.forEach((settle) => settle());
};

/** A human over loopback, remembering the last Orders and Marks the host sent it. */
function human(session: Session, name: string) {
  const pair = createLoopbackPair();
  links.push(() => pair.settle());
  session.addConnection(pair.a, 0);
  let slot = -1;
  let orders: readonly BotOrder[] | null = null;
  let marks: readonly TargetMark[] | null = null;
  let closed = false;
  const client = new ClientConnection(pair.b, {
    onJoinAck: (_netId, s) => {
      slot = s;
    },
    onOrders: (o) => {
      orders = o;
    },
    onMarks: (m) => {
      marks = m;
    },
    onClosed: () => {
      closed = true;
    },
  });
  client.join(name);
  settleAll();
  return {
    get slot() {
      return slot;
    },
    get orders() {
      return orders;
    },
    get marks() {
      return marks;
    },
    get closed() {
      return closed;
    },
    send(msg: Message) {
      client.send(msg);
      settleAll();
    },
    /** Something on the wire, as a live client sends, so the host does not time it out. */
    ping() {
      client.send({ kind: 'Ping', id: 1, clientTime: 0 });
    },
    /** Raw bytes, for what no well-behaved client would send. */
    raw(bytes: Uint8Array) {
      pair.b.send(bytes);
      settleAll();
    },
  };
}

const orderOf = (session: Session) => [0, 1, 2, 3, 4, 5].map((i) => session.orderFor(i)?.order ?? null);

describe('orders (T-3.27)', () => {
  it('reach the bots they name, and no one else', () => {
    const session = new Session();
    const a = human(session, 'a');
    expect(a.slot).toBe(0);
    expect(a.orders).toEqual([]);
    a.send({ kind: 'Order', order: 'move', address: { to: 'slot', index: 2 }, point: { x: 5, y: 0, z: 5 }, target: null });
    expect(orderOf(session)).toEqual([null, null, 'move', null, null, null]);
    expect(session.orderFor(2)).toEqual({ slot: 2, order: 'move', point: { x: 5, y: 0, z: 5 }, target: null, from: 0 });
    // A fireteam: its bots, not its human.
    a.send({ kind: 'Order', order: 'hold', address: { to: 'fireteam', index: 0 }, point: null, target: null });
    expect(orderOf(session)).toEqual([null, 'hold', 'hold', null, null, null]);
    a.send({ kind: 'Order', order: 'regroup', address: { to: 'fireteam', index: 1 }, point: null, target: null });
    expect(orderOf(session)).toEqual([null, 'hold', 'hold', 'regroup', 'regroup', 'regroup']);
    // Everyone: every bot, still never the human.
    a.send({ kind: 'Order', order: 'hold', address: { to: 'all' }, point: null, target: null });
    expect(orderOf(session)).toEqual([null, 'hold', 'hold', 'hold', 'hold', 'hold']);
    expect(a.orders!.map((o) => o.slot)).toEqual([1, 2, 3, 4, 5]);
    expect(SQUAD.fireteams[0]!.slots).toContain(0);
  });

  it('to a human’s slot is dropped, and a join lapses the order its bot was under', () => {
    const session = new Session();
    const a = human(session, 'a');
    a.send({ kind: 'Order', order: 'hold', address: { to: 'slot', index: 1 }, point: null, target: null });
    expect(session.orderFor(1)?.order).toBe('hold');
    const b = human(session, 'b');
    expect(b.slot).toBe(1);
    expect(session.orderFor(1)).toBeNull();
    // Both clients are told, and neither shows an order on a human.
    expect(a.orders).toEqual([]);
    expect(b.orders).toEqual([]);
    const before = a.orders;
    a.send({ kind: 'Order', order: 'move', address: { to: 'slot', index: 1 }, point: { x: 1, y: 0, z: 1 }, target: null });
    b.send({ kind: 'Order', order: 'move', address: { to: 'slot', index: 0 }, point: { x: 1, y: 0, z: 1 }, target: null });
    expect(session.orderFor(0)).toBeNull();
    expect(session.orderFor(1)).toBeNull();
    // Dropped outright: nobody was sent anything new.
    expect(a.orders).toBe(before);
  });

  it('from two humans to the same bot: the later stands, and both clients see it', () => {
    const session = new Session();
    const a = human(session, 'a');
    const b = human(session, 'b');
    a.send({ kind: 'Order', order: 'move', address: { to: 'slot', index: 4 }, point: { x: 10, y: 0, z: 0 }, target: null });
    b.send({ kind: 'Order', order: 'hold', address: { to: 'slot', index: 4 }, point: { x: -3, y: 0, z: 2 }, target: null });
    const standing = { slot: 4, order: 'hold', point: { x: -3, y: 0, z: 2 }, target: null, from: 1 };
    expect(session.orderFor(4)).toEqual(standing);
    expect(a.orders).toEqual([standing]);
    expect(b.orders).toEqual([standing]);
    // And a newcomer is shown it on seating.
    const c = human(session, 'c');
    expect(c.orders).toEqual([standing]);
  });

  it('refuses what the session cannot honour: a bot’s own order, no such target, a malformed order', () => {
    const session = new Session();
    const a = human(session, 'a');
    const enemy = session.spawnEnemy('rifleman', { x: 0, y: 0, z: 30, tree: buildTree('idle', createBrainRegistry()) }) as number;
    // An attack on nobody who exists, and on a squadmate: both dropped.
    a.send({ kind: 'Order', order: 'attack', address: { to: 'slot', index: 1 }, point: null, target: 9999 });
    a.send({ kind: 'Order', order: 'attack', address: { to: 'slot', index: 1 }, point: null, target: session.slots[2]!.netId });
    // A revive of an enemy: dropped. A move without a point: dropped.
    a.send({ kind: 'Order', order: 'revive', address: { to: 'slot', index: 1 }, point: null, target: enemy });
    a.send({ kind: 'Order', order: 'move', address: { to: 'slot', index: 1 }, point: null, target: null });
    // Slot 6 and fireteam 3 get through the wire's three bits, and no further.
    a.send({ kind: 'Order', order: 'hold', address: { to: 'slot', index: 6 }, point: null, target: null });
    a.send({ kind: 'Order', order: 'hold', address: { to: 'fireteam', index: 3 }, point: null, target: null });
    expect(orderOf(session)).toEqual([null, null, null, null, null, null]);
    // The right target is taken.
    a.send({ kind: 'Order', order: 'attack', address: { to: 'slot', index: 1 }, point: null, target: enemy });
    a.send({ kind: 'Order', order: 'revive', address: { to: 'slot', index: 2 }, point: null, target: session.slots[3]!.netId });
    expect(orderOf(session)).toEqual([null, 'attack', 'revive', null, null, null]);
    // Garbage bytes are a protocol error: the sender is dropped, nothing is ordered. (Seating
    // it in slot 1 lapses that bot's attack: a human is nobody's to order.)
    const w = new Uint8Array([0xf0 | 0x0f, 0xff, 0xff]);
    const b = human(session, 'b');
    expect(orderOf(session)).toEqual([null, null, 'revive', null, null, null]);
    b.raw(w);
    expect(b.closed).toBe(true);
    expect(orderOf(session)).toEqual([null, null, 'revive', null, null, null]);
  });

  it('from a connection still handshaking is nothing', () => {
    const session = new Session();
    const pair = createLoopbackPair();
    session.addConnection(pair.a, 0);
    pair.b.send(encodeMessage({ kind: 'Order', order: 'hold', address: { to: 'all' }, point: null, target: null }));
    pair.settle();
    expect(orderOf(session)).toEqual([null, null, null, null, null, null]);
    expect(PROTOCOL_VERSION).toBeGreaterThan(20);
  });
});

describe('marks (T-3.27)', () => {
  it('are shown to everyone, stand for their data-set time, and then go', () => {
    const session = new Session();
    const a = human(session, 'a');
    const b = human(session, 'b');
    a.send({ kind: 'Mark', point: { x: 3, y: 0, z: 40 }, target: null });
    expect(a.marks).toHaveLength(1);
    expect(b.marks).toEqual(a.marks);
    const mark = a.marks![0]!;
    expect(mark.from).toBe(0);
    const life = Math.round(ORDERS.markSeconds * 30);
    expect(mark.expiresTick).toBe(session.tick + life);
    for (let t = 0; t < life - 1; t++) {
      // Both clients stay alive over the mark's life, as live ones do.
      if (t % 30 === 0) {
        a.ping();
        b.ping();
        settleAll();
      }
      session.step((session.tick + 1) * TICK_MS);
    }
    expect(session.currentMarks).toHaveLength(1);
    session.step((session.tick + 1) * TICK_MS);
    settleAll();
    expect(session.currentMarks).toHaveLength(0);
    expect(a.marks).toEqual([]);
    expect(b.marks).toEqual([]);
  });

  it('keep each player to their data-set number, dropping their oldest, and refuse a target that is nobody', () => {
    const session = new Session();
    const a = human(session, 'a');
    const b = human(session, 'b');
    for (let i = 0; i < ORDERS.marksPerPlayer + 2; i++) a.send({ kind: 'Mark', point: { x: i, y: 0, z: 0 }, target: null });
    b.send({ kind: 'Mark', point: { x: 99, y: 0, z: 0 }, target: null });
    const mine = session.currentMarks.filter((m) => m.from === 0);
    expect(mine).toHaveLength(ORDERS.marksPerPlayer);
    expect(mine.map((m) => m.point.x)).toEqual(Array.from({ length: ORDERS.marksPerPlayer }, (_, i) => i + 2));
    expect(session.currentMarks.filter((m) => m.from === 1)).toHaveLength(1);
    const count = session.currentMarks.length;
    a.send({ kind: 'Mark', point: { x: 0, y: 0, z: 0 }, target: 9999 });
    expect(session.currentMarks).toHaveLength(count);
    // On a real enemy, it stands.
    const enemy = session.spawnEnemy('rifleman', { x: 0, y: 0, z: 30, tree: buildTree('idle', createBrainRegistry()) }) as number;
    b.send({ kind: 'Mark', point: { x: 0, y: 0, z: 30 }, target: enemy });
    expect(session.currentMarks.some((m) => m.target === enemy)).toBe(true);
    // A newcomer is shown them all.
    const c = human(session, 'c');
    expect(c.marks).toEqual(session.currentMarks);
  });
});
