/**
 * Orders and marks on the wire (T-3.27): the four messages round-trip, the
 * decoder refuses what no encoder writes, and `orderProblem` is the one rule
 * of what a well-formed order is.
 */
import { describe, expect, it } from 'vitest';
import { BitWriter } from '../net/BitStream.ts';
import { MessageType, PROTOCOL_VERSION, ProtocolError, decodeMessage, encodeMessage, type Message } from '../net/protocol.ts';
import RAW_ORDERS from '../data/orders.json' with { type: 'json' };
import { MAX_MARKS, MAX_MARKS_PER_PLAYER, ORDERS, ORDER_KINDS, type OrderSpec, alongFacing, orderProblem, parseOrdersConfig } from './orders.ts';

const P = { x: 12.5, y: 0.25, z: -30.75 };

function roundTrip(msg: Message): Message {
  return decodeMessage(encodeMessage(msg));
}

describe('orders on the wire (T-3.27)', () => {
  it('bumps the protocol', () => {
    // 21 brought orders; mission/map/resume/objective changes made 22–25, T-4.15's scripted-event replication is 26, T-4.22's identity token 27, and T-4.19's room ready-up/quick-join wire is 28.
    // T-4.24 added private soldier progression as 29; T-4.27's class pick and the roster's class are 30; T-4.28's scoreboard is 31.
    // U-025's bot commanders on the roster and the AssignCommander request are 34; U-026's switch is 35;
    // U-024's pouch counts on the Weapon component are 36; U-028's Reload and magazine count are 37; U-009's upload objective and its phase are 38; U-010's lever pull on an enemy's Health is 39; U-017's pickups (the Pickup component, the pickup netId band) are 40; U-018's primary on the Weapon component is 41.
    // The knife is a new wire weapon and moves the pouch indexes (42); spectator requests and acknowledgements are 43.
    // 68 combines U-133's finite-cache messages and U-143's incompatible-restore gate. U-153's squad stance orders are 70.
    // U-154's order facing (on an Order and on each of the Orders broadcast) is 71.
    expect(PROTOCOL_VERSION).toBe(72);
  });

  it('round-trips every order kind to every kind of addressee', () => {
    for (const order of ORDER_KINDS) {
      for (const address of [{ to: 'slot', index: 4 }, { to: 'fireteam', index: 1 }, { to: 'all' }] as const) {
        const msg: Message = { kind: 'Order', order, address, point: order === 'move' ? P : null, target: order === 'attack' ? 2003 : null };
        expect(roundTrip(msg)).toEqual(msg);
      }
    }
  });

  it('round-trips a mark, the squad’s orders and the standing marks', () => {
    const mark: Message = { kind: 'Mark', point: P, target: 2001 };
    expect(roundTrip(mark)).toEqual(mark);
    expect(roundTrip({ kind: 'Mark', point: P, target: null })).toEqual({ kind: 'Mark', point: P, target: null });
    const orders: Message = {
      kind: 'Orders',
      orders: [
        { slot: 1, order: 'move', point: P, target: null, from: 0 },
        { slot: 4, order: 'attack', point: null, target: 2002, from: 3 },
        { slot: 5, order: 'regroup', point: null, target: null, from: 0 },
      ],
    };
    expect(roundTrip(orders)).toEqual(orders);
    expect(roundTrip({ kind: 'Orders', orders: [] })).toEqual({ kind: 'Orders', orders: [] });
    const marks: Message = { kind: 'Marks', marks: [{ id: 7, from: 2, point: P, target: null, expiresTick: 900 }] };
    expect(roundTrip(marks)).toEqual(marks);
  });

  it('round-trips a move or hold’s facing on the order and the broadcast, every wire yaw exactly, and leaves a faceless order faceless (U-154)', () => {
    for (const facing of [0, 1, 255, 512, 1023]) {
      for (const order of ['move', 'hold'] as const) {
        const msg: Message = { kind: 'Order', order, address: { to: 'fireteam', index: 1 }, point: P, target: null, facing };
        expect(roundTrip(msg)).toEqual(msg);
      }
    }
    const hold: Message = { kind: 'Order', order: 'hold', address: { to: 'all' }, point: null, target: null, facing: 700 };
    expect(roundTrip(hold)).toEqual(hold);
    const faceless = roundTrip({ kind: 'Order', order: 'move', address: { to: 'all' }, point: P, target: null });
    expect(faceless).not.toHaveProperty('facing');
    const orders: Message = {
      kind: 'Orders',
      orders: [
        { slot: 1, order: 'move', point: P, target: null, from: 0, facing: 1023 },
        { slot: 2, order: 'hold', point: null, target: null, from: 0, facing: 0 },
        { slot: 3, order: 'move', point: P, target: null, from: 0 },
      ],
    };
    const back = roundTrip(orders);
    expect(back).toEqual(orders);
    if (back.kind !== 'Orders') throw new Error('expected Orders');
    expect(back.orders[2]).not.toHaveProperty('facing');
    // A facing is ten bits more than a faceless order: never more than two bytes.
    const bytes = (m: Message) => encodeMessage(m).length;
    expect(bytes(hold) - bytes({ kind: 'Order', order: 'hold', address: { to: 'all' }, point: null, target: null })).toBeLessThanOrEqual(2);
  });

  it('keeps the AI debug family working under the same tag', () => {
    expect(roundTrip({ kind: 'AiDebugRequest', on: true })).toEqual({ kind: 'AiDebugRequest', on: true });
    expect(roundTrip({ kind: 'AiDebug', tick: 5, brains: [] })).toEqual({ kind: 'AiDebug', tick: 5, brains: [] });
  });

  it('refuses garbage: an order kind past the last, an addressee that is none, a sub-kind nobody sends, too many marks', () => {
    const ext = (sub: number, fill: (w: BitWriter) => void) => {
      const w = new BitWriter();
      w.writeBits(MessageType.Ext, 4);
      w.writeBits(sub, 3);
      fill(w);
      return w.toUint8Array();
    };
    // Order with kind 7.
    expect(() => decodeMessage(ext(2, (w) => w.writeBits(7, 3)))).toThrow(ProtocolError);
    // Order with addressee kind 3.
    expect(() =>
      decodeMessage(
        ext(2, (w) => {
          w.writeBits(0, 3);
          w.writeBits(3, 2);
          w.writeBits(0, 3);
          w.writeBool(false);
          w.writeBool(false);
        }),
      ),
    ).toThrow(ProtocolError);
    expect(() => decodeMessage(ext(7, () => {}))).toThrow(ProtocolError);
    expect(() => decodeMessage(ext(5, (w) => w.writeVarUint(MAX_MARKS + 1)))).toThrow(ProtocolError);
    // A truncated order is malformed, not an order.
    expect(() => decodeMessage(ext(2, (w) => w.writeBits(0, 3)))).toThrow(ProtocolError);
  });
});

describe('what a well-formed order is (T-3.27)', () => {
  const spec = (s: Partial<OrderSpec>): OrderSpec => ({ order: 'hold', address: { to: 'all' }, point: null, target: null, ...s });

  it('takes each kind with what it needs and nothing else', () => {
    expect(orderProblem(spec({ order: 'move', point: P }), 2)).toBeNull();
    expect(orderProblem(spec({ order: 'attack', target: 2000 }), 2)).toBeNull();
    expect(orderProblem(spec({ order: 'hold' }), 2)).toBeNull();
    expect(orderProblem(spec({ order: 'hold', point: P }), 2)).toBeNull();
    expect(orderProblem(spec({ order: 'regroup' }), 2)).toBeNull();
    expect(orderProblem(spec({ order: 'revive', target: 3 }), 2)).toBeNull();
  });

  it.each([
    ['a move with nowhere to go', spec({ order: 'move' }), /needs a point/],
    ['an attack on nobody', spec({ order: 'attack' }), /needs a target/],
    ['an attack at a point', spec({ order: 'attack', target: 2000, point: P }), /takes no point/],
    ['a regroup with a target', spec({ order: 'regroup', target: 2000 }), /takes no target/],
    ['a revive of netId 0', spec({ order: 'revive', target: 0 }), /not a netId/],
    ['slot 6', spec({ address: { to: 'slot', index: 6 } }), /no slot/],
    ['fireteam 2 of 2', spec({ address: { to: 'fireteam', index: 2 } }), /no fireteam/],
    ['a point at infinity', spec({ order: 'move', point: { x: Infinity, y: 0, z: 0 } }), /not finite/],
    ['an order nobody knows', spec({ order: 'dance' as never }), /unknown order/],
    ['an attack with a facing (U-154)', spec({ order: 'attack', target: 2000, facing: 5 }), /takes no facing/],
    ['a regroup with a facing (U-154)', spec({ order: 'regroup', facing: 5 }), /takes no facing/],
    ['a revive with a facing (U-154)', spec({ order: 'revive', target: 3, facing: 5 }), /takes no facing/],
    ['a facing of a whole turn (U-154)', spec({ order: 'hold', facing: 1024 }), /not a wire yaw/],
    ['a negative facing (U-154)', spec({ order: 'move', point: P, facing: -1 }), /not a wire yaw/],
    ['a fractional facing (U-154)', spec({ order: 'move', point: P, facing: 1.5 }), /not a wire yaw/],
  ])('refuses %s', (_label, s, message) => {
    expect(orderProblem(s, 2)).toMatch(message);
  });

  it('takes a facing on a move or a hold, from the first wire yaw to the last (U-154)', () => {
    for (const facing of [0, 511, 1023]) {
      expect(orderProblem(spec({ order: 'move', point: P, facing }), 2)).toBeNull();
      expect(orderProblem(spec({ order: 'hold', facing }), 2)).toBeNull();
      expect(orderProblem(spec({ order: 'hold', point: P, facing }), 2)).toBeNull();
    }
  });
});

describe('alongFacing (U-154)', () => {
  it('points along a wire yaw as a soldier faces it — 0 down +z, a quarter turn down +x — at the same height', () => {
    const from = { x: 1, y: 1.6, z: -2 };
    const close = (p: { x: number; y: number; z: number }, x: number, z: number) => {
      expect(p.x).toBeCloseTo(x, 6);
      expect(p.y).toBe(1.6);
      expect(p.z).toBeCloseTo(z, 6);
    };
    close(alongFacing(from, 0, 10), 1, 8);
    close(alongFacing(from, 256, 10), 11, -2);
    close(alongFacing(from, 512, 10), 1, -12);
    close(alongFacing(from, 768, 10), -9, -2);
  });
});

describe('orders.json (T-3.27)', () => {
  it('parses, and refuses unknown keys and marks the wire cannot carry', () => {
    expect(ORDERS.markSeconds).toBeGreaterThan(0);
    expect(ORDERS.marksPerPlayer).toBeLessThanOrEqual(MAX_MARKS_PER_PLAYER);
    expect(() => parseOrdersConfig({ ...RAW_ORDERS, colour: 1 })).toThrow(/colour/);
    expect(() => parseOrdersConfig({ ...RAW_ORDERS, marksPerPlayer: MAX_MARKS_PER_PLAYER + 1 })).toThrow(/marksPerPlayer/);
    expect(() => parseOrdersConfig({ ...RAW_ORDERS, marksPerPlayer: 1.5 })).toThrow(/whole/);
    expect(() => parseOrdersConfig({ ...RAW_ORDERS, markSeconds: 0 })).toThrow(/markSeconds/);
  });
});
