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

  it('keeps identical x/z goals on y0, y8 and y16 apart, with a line from a bot beneath its goal (U-123)', () => {
    const stacked: MarkerPositions = { slot: () => ({ x: 30, y: 0, z: 270 }), netId: () => null };
    const orders: BotOrder[] = [0, 8, 16].map((y, i) => ({ slot: i + 1, order: 'move', point: { x: 30, y, z: 270 }, target: null, from: 0 }));
    const markers = orderMarkers(orders, [], stacked);
    expect(markers.map((m) => m.at.y)).toEqual([0, 8, 16]);
    // Ring (16 segments) and pole for each; the line only where the goal is on another floor.
    const segments = (m: typeof markers) => markerLines(m).positions.length / 6;
    expect(segments([markers[0]!])).toBe(17);
    expect(segments([markers[1]!])).toBe(18);
    expect(segments([markers[2]!])).toBe(18);
    const line = markerLines([markers[2]!]).positions.slice(17 * 6);
    expect([line[1], line[4]]).toEqual([0.1, 16.05].map((v) => Math.fround(v)));
  });
});

describe('a faced order’s marker (U-154)', () => {
  it('carries the facing a move or hold was given, and draws an arrow out of its ring that way; a faceless one draws none', () => {
    const orders: BotOrder[] = [
      { slot: 1, order: 'move', point: { x: 5, y: 0, z: 9 }, target: null, from: 0, facing: 256 },
      { slot: 3, order: 'hold', point: null, target: null, from: 0, facing: 512 },
      { slot: 4, order: 'move', point: { x: 1, y: 0, z: 1 }, target: null, from: 0 },
    ];
    const markers = orderMarkers(orders, [{ id: 7, from: 0, point: { x: 1, y: 0, z: 39 }, target: null, expiresTick: 600 }], WHERE);
    expect(markers.map((m) => [m.key, m.facing])).toEqual([['o1', 256], ['o3', 512], ['o4', null], ['m7', null]]);
    const segments = (m: (typeof markers)[number]) => markerLines([m]).positions;
    // Ring, pole and the line from its bot; a facing adds a shaft and two barbs.
    const faceless = segments({ ...markers[0]!, facing: null });
    const faced = segments(markers[0]!);
    expect(faced.length / 6 - faceless.length / 6).toBe(3);
    // The shaft runs east (+x) from the ring's edge, flat on the ground.
    const shaft = faced.slice(faceless.length, faceless.length + 6);
    expect(shaft[0]).toBeCloseTo(5.5, 5);
    expect(shaft[2]).toBeCloseTo(9, 5);
    expect(shaft[3]).toBeGreaterThan(shaft[0]! + 1);
    expect(shaft[5]).toBeCloseTo(9, 5);
    expect(shaft[1]).toBe(shaft[4]);
    // A hold on its bot points the way it was given too: south (−z), from the bot's feet.
    const hold = segments(markers[1]!);
    const holdShaft = hold.slice(hold.length - 18, hold.length - 12);
    expect(holdShaft[0]).toBeCloseTo(3, 5);
    expect(holdShaft[5]).toBeLessThan(-1);
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

    const aim = { point: { x: 4.5, y: 0, z: 12.25 }, feet: { x: 4.5, y: 0, z: 12.25 }, netId: null, enemy: false, downedMate: false, facing: null };
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
