/**
 * The squad's orders and marks in the world (T-3.29): drawn from what the
 * host broadcast, never from what this client sent. A real in-page session
 * and a real `NetClient`, so "broadcast" means the bytes that came back.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { BotOrder, TargetMark } from '@sandline/shared';
import { initNav } from '@sandline/server/nav';
import { LocalServer } from '../net/LocalServer.ts';
import { NetClient } from '../net/NetClient.ts';
import { type MarkerPositions, markerLines, orderMarkers } from './OrderMarkers.ts';
import { buildMark, buildOrder } from './OrderWheel.ts';

const LAN = { latencyMs: 0, jitterMs: 0, lossRate: 0 };

/** Soldiers drawn at their slot index along x, and one enemy (netId 500) at z 40. */
const WHERE: MarkerPositions = {
  slot: (slot) => ({ x: slot, y: 0, z: 0 }),
  netId: (netId) => (netId === 500 ? { x: 0, y: 0, z: 40 } : netId >= 1 && netId <= 6 ? { x: netId - 1, y: 0, z: 0 } : null),
};

describe('orderMarkers (T-3.29)', () => {
  it('stands each order where its kind says, and each mark on its enemy or its point', () => {
    const orders: BotOrder[] = [
      { slot: 1, order: 'move', point: { x: 5, y: 0, z: 9 }, target: null, from: 0 },
      { slot: 2, order: 'attack', point: null, target: 500, from: 0 },
      { slot: 3, order: 'hold', point: null, target: null, from: 0 },
      { slot: 4, order: 'regroup', point: null, target: null, from: 0 },
      { slot: 5, order: 'revive', point: null, target: 3, from: 0 },
    ];
    const marks: TargetMark[] = [
      { id: 7, from: 0, point: { x: 1, y: 0, z: 39 }, target: 500, expiresTick: 600 },
      { id: 8, from: 1, point: { x: -4, y: 0, z: 20 }, target: null, expiresTick: 600 },
    ];
    const markers = orderMarkers(orders, marks, WHERE);
    expect(markers.map((m) => [m.key, m.kind, m.at])).toEqual([
      ['o1', 'move', { x: 5, y: 0, z: 9 }],
      ['o2', 'attack', { x: 0, y: 0, z: 40 }],
      ['o3', 'hold', { x: 3, y: 0, z: 0 }],
      ['o4', 'regroup', { x: 4, y: 0, z: 0 }],
      ['o5', 'revive', { x: 2, y: 0, z: 0 }],
      ['m7', 'mark', { x: 0, y: 0, z: 40 }],
      ['m8', 'mark', { x: -4, y: 0, z: 20 }],
    ]);
    expect(markers[0]!.bot).toEqual({ x: 1, y: 0, z: 0 });
    // An attack on someone not drawn has nowhere to stand: nothing is drawn.
    expect(orderMarkers([{ slot: 1, order: 'attack', point: null, target: 999, from: 0 }], [], WHERE)).toEqual([]);
    // Every marker is a ring and a pole; an order away from its bot draws the line to it too.
    const { positions } = markerLines(markers);
    expect(positions.length / 6).toBeGreaterThan(markers.length * 17);
  });
});

describe('markers come from the broadcast, not from what was sent (T-3.29)', () => {
  beforeAll(() => initNav());

  function settle(server: LocalServer, from: number): number {
    let t = from;
    for (let i = 0; i < 6; i++) server.step((t += 34));
    return t;
  }

  it('an order is drawn once the host says it stands, and one it drops is never drawn', () => {
    const server = new LocalServer(LAN);
    const net = new NetClient(server.transport, 'me');
    net.join();
    let t = settle(server, 0);
    expect(net.joined).toBe(true);
    expect(net.slot).toBe(0);
    const draw = () => orderMarkers(net.orders, net.marks, WHERE);

    const aim = { point: { x: 4.5, y: 0, z: 12.25 }, netId: null, enemy: false, downedMate: false };
    net.order(buildOrder('move', { to: 'slot', index: 2 }, aim)!);
    // Sent, and nothing drawn: the host has not answered.
    expect(draw()).toEqual([]);
    t = settle(server, t);
    const [marker] = draw();
    expect(marker?.key).toBe('o2');
    expect(marker?.kind).toBe('move');
    expect(marker!.at.x).toBeCloseTo(4.5, 1);
    expect(marker!.at.z).toBeCloseTo(12.25, 1);

    // To this client's own slot: a human is nobody's to order. The host drops it and nothing changes.
    net.order(buildOrder('hold', { to: 'slot', index: 0 }, aim)!);
    t = settle(server, t);
    expect(draw().map((m) => m.key)).toEqual(['o2']);

    // A mark likewise waits for the host.
    net.mark(buildMark(aim));
    expect(draw().filter((m) => m.kind === 'mark')).toEqual([]);
    settle(server, t);
    expect(draw().filter((m) => m.kind === 'mark')).toHaveLength(1);
  });
});
