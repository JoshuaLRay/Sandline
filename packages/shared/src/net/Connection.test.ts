import { describe, expect, it } from 'vitest';
import { ServerConnection } from './Connection.ts';
import { PROTOCOL_VERSION, type Message, encodeMessage } from './protocol.ts';
import { createLoopbackPair } from './Transport.ts';

/** A connection that has handshaked at time 0, fed messages at explicit times. */
function joined(key?: string): { conn: ServerConnection; feed: (msg: Message, now: number) => void } {
  const pair = createLoopbackPair();
  const conn = new ServerConnection(pair.a, {}, 0);
  const feed = (msg: Message, now: number): void => conn.receive(encodeMessage(msg), now);
  feed({ kind: 'Join', version: PROTOCOL_VERSION, name: 'p', room: '', ...(key === undefined ? {} : { key }) }, 0);
  return { conn, feed };
}

const still = (tick: number, yaw = 0): Message => ({ kind: 'Input', tick, moveX: 0, moveY: 0, yaw, pitch: 0, buttons: 0 });

describe('ServerConnection activity and age', () => {
  it('carries the offered join key, empty when none was sent', () => {
    expect(joined().conn.key).toBe('');
    expect(joined('hunter2').conn.key).toBe('hunter2');
  });

  it('counts the same still input and pings as idle, however often they arrive', () => {
    const { conn, feed } = joined();
    feed(still(1), 100);
    for (let t = 200; t <= 5000; t += 100) {
      feed(still(t / 100), t);
      feed({ kind: 'Ping', id: t, clientTime: t }, t);
    }
    // Heard from constantly, active only at the first input.
    expect(conn.isTimedOut(5000)).toBe(false);
    expect(conn.isIdle(5000, 4000)).toBe(true);
  });

  it('counts movement, a look, a button or a shot as activity', () => {
    for (const msg of [
      { ...still(2), moveX: 1 },
      still(2, 7),
      { ...still(2), buttons: 1 },
      { kind: 'Fire', tick: 2, yaw: 0, pitch: 0, renderTimeMs: 0, weapon: 0, ads: false } as Message,
    ]) {
      const { conn, feed } = joined();
      feed(still(1), 0);
      feed(msg as Message, 4500);
      expect(conn.isIdle(5000, 4000)).toBe(false);
    }
  });

  it('expires on age regardless of activity, and a zero limit never trips either check', () => {
    const { conn, feed } = joined();
    for (let t = 100; t <= 3000; t += 100) feed(still(t / 100, t), t);
    expect(conn.isExpired(3000, 2000)).toBe(true);
    expect(conn.isExpired(3000, 0)).toBe(false);
    expect(conn.isIdle(1e9, 0)).toBe(false);
  });

  it('restarts both clocks when moved onto a room clock', () => {
    const { conn } = joined();
    conn.resetClock(10);
    expect(conn.isIdle(1000, 2000)).toBe(false);
    expect(conn.isExpired(1000, 2000)).toBe(false);
    expect(conn.isExpired(2011, 2000)).toBe(true);
  });
});

describe('commander supply connection routing (U-146)', () => {
  it('routes a reliable decoded command once, independently from desktop use, and counts activity', () => {
    const pair = createLoopbackPair();
    const commander: Message[] = [];
    const desktop: Message[] = [];
    const conn = new ServerConnection(pair.a, {
      onCommanderSupplySelect: (sender, msg) => { expect(sender).toBe(conn); commander.push(msg); },
      onSupplySelect: (_sender, msg) => desktop.push(msg),
    }, 0);
    pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'p', room: '' }), 'reliable');
    pair.settle();
    conn.setNow(4500);
    const command: Message = { kind: 'CommanderSupplySelect', requestId: 1, slot: 5, cacheId: 'cache', item: { kind: 'health-kit' } };
    pair.b.send(encodeMessage(command), 'reliable');
    pair.settle();
    expect(commander).toEqual([command]);
    expect(desktop).toEqual([]);
    expect(conn.isIdle(5000, 4000)).toBe(false);
    pair.b.send(encodeMessage({ kind: 'SupplySelect', requestId: 1, cacheId: 'cache', item: null }), 'reliable');
    pair.settle();
    expect(commander).toEqual([command]);
    expect(desktop).toHaveLength(1);
  });

  it('never dispatches a commander request before the handshake', () => {
    const pair = createLoopbackPair();
    let calls = 0;
    const conn = new ServerConnection(pair.a, { onCommanderSupplySelect: () => calls++ }, 0);
    pair.b.send(encodeMessage({ kind: 'CommanderSupplySelect', requestId: 1, slot: 0, cacheId: 'cache', item: null }), 'reliable');
    pair.settle();
    expect(calls).toBe(0);
    expect(conn.state).toBe('closed');
  });
});
