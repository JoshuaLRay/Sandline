/**
 * U-024 (B-18): the page's grenade and rocket counts follow the server's.
 *
 * Unit: `ThrowQA.reconcile` holds our own throw against a lagging server
 * count, lets the server take it without counting it twice, lets a refused
 * one lapse, and takes a refill as the server's. Headless end to end: a
 * hosted room with class loadouts (a real `Session`, a real `NetClient`
 * over loopback, the page's `ThrowQA`), through the reset key, a throw, a
 * respawn and a page that comes back after a drop.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DAMAGE, PROJECTILE_IDS, TICK_SECONDS, classById, createLoopbackPair, encodeMessage, getProjectile, type Message } from '@sandline/shared';
import { initNav } from '@sandline/server/nav';
import { Session } from '@sandline/server/session';
import { NetClient } from '../net/NetClient.ts';
import { PENDING_HOLD_SECONDS, ThrowQA } from './ThrowQA.ts';

const FRAG = PROJECTILE_IDS.indexOf('frag');
const ROCKET = PROJECTILE_IDS.indexOf('rocket');
const EYE = { x: 0, y: 1.55, z: 0 };
const FULL = PROJECTILE_IDS.map((id) => getProjectile(id).carried);

describe('the page follows the server\'s pouch (U-024)', () => {
  it('a throw of ours stays spent while the server has not seen it, and is not counted twice once it has', () => {
    const throws = new ThrowQA();
    throws.reconcile([2, 1], 0);
    expect(throws.count(FRAG)).toBe(2);
    expect(throws.throwFrom(EYE, 0, 0, 1)).not.toBeNull();
    expect(throws.count(FRAG)).toBe(1);
    // The server's next few snapshots were sent before our throw reached it.
    throws.reconcile([2, 1], 1.05);
    throws.reconcile([2, 1], 1.1);
    expect(throws.count(FRAG)).toBe(1);
    expect(throws.pendingThrows).toBe(1);
    // It takes the throw: one, not two, fewer.
    throws.reconcile([1, 1], 1.15);
    expect(throws.count(FRAG)).toBe(1);
    expect(throws.pendingThrows).toBe(0);
  });

  it('a throw the server refused lapses, and the count is the server\'s again', () => {
    const throws = new ThrowQA();
    throws.reconcile([1, 0], 0);
    expect(throws.throwFrom(EYE, 0, 0, 1)).not.toBeNull();
    throws.reconcile([1, 0], 1 + PENDING_HOLD_SECONDS / 2);
    expect(throws.count(FRAG)).toBe(0);
    throws.reconcile([1, 0], 1 + PENDING_HOLD_SECONDS + 0.01);
    expect(throws.count(FRAG)).toBe(1);
    expect(throws.pendingThrows).toBe(0);
  });

  it('a refill is the server\'s to give (a respawn): it clears what was pending', () => {
    const throws = new ThrowQA();
    throws.reconcile([1, 0], 0);
    throws.throwFrom(EYE, 0, 0, 1);
    throws.reconcile([0, 0], 1.1);
    throws.reconcile([2, 1], 6);
    expect([throws.count(FRAG), throws.count(ROCKET)]).toEqual([2, 1]);
    expect(throws.pendingThrows).toBe(0);
  });

  it('the reset key never gives back what a server has not: once a server has spoken, its count stands', () => {
    const throws = new ThrowQA();
    throws.reconcile([1, 0], 0);
    throws.reset();
    expect([throws.count(FRAG), throws.count(ROCKET)]).toEqual([1, 0]);
    // With no server heard yet (the harness before a join), the data's full pouch stands in.
    const fresh = new ThrowQA();
    fresh.reset();
    expect([fresh.count(FRAG), fresh.count(ROCKET)]).toEqual(FULL);
  });
});

describe('a hosted room with class loadouts, end to end (U-024, B-18)', () => {
  beforeAll(() => initNav());

  function room() {
    const session = new Session(undefined, '', 'range', { roomLobby: true });
    let now = 0;
    const clients: { net: NetClient; pair: ReturnType<typeof createLoopbackPair>; ping(): void }[] = [];
    const settle = () => clients.forEach((c) => c.pair.settle());
    const join = (name: string, resume = '') => {
      const pair = createLoopbackPair();
      session.addConnection(pair.a, now);
      const net = new NetClient(pair.b, name);
      const c = { net, pair, ping: () => pair.b.send(encodeMessage({ kind: 'Ping', id: 1, clientTime: 0 })) };
      clients.push(c);
      net.join('', '', '', resume);
      settle();
      return c;
    };
    const send = (c: { pair: ReturnType<typeof createLoopbackPair> }, msg: Message) => {
      c.pair.b.send(encodeMessage(msg));
      settle();
    };
    const step = (ticks = 1) => {
      for (let i = 0; i < ticks; i++) {
        now += TICK_SECONDS * 1000;
        clients.forEach((c) => c.ping());
        settle();
        session.step(now);
        settle();
      }
    };
    return { session, join, send, step, get now() { return now; } };
  }

  it('a Marksman\'s page shows the Marksman\'s pouch through reset, a throw, a respawn and a fresh page after a drop', () => {
    const r = room();
    const a = r.join('a');
    r.send(a, { kind: 'RoomCommand', command: 'class', classId: 'marksman' });
    r.send(a, { kind: 'RoomCommand', command: 'start' });
    r.step(5);
    const marksman = classById('marksman')!.pouch;
    expect(a.net.pouch).toEqual(marksman);
    const throws = new ThrowQA();
    const t = () => r.now / 1000;
    throws.reconcile(a.net.pouch!, t());
    expect([throws.count(FRAG), throws.count(ROCKET)]).toEqual(marksman);

    // B-18: T used to put back the data's pouch (3 frags, 2 rockets) here.
    throws.reset();
    throws.reconcile(a.net.pouch!, t());
    expect([throws.count(FRAG), throws.count(ROCKET)]).toEqual(marksman);

    // Our one frag: spent on the page at once, taken by the server, never offered again.
    expect(throws.throwFrom(EYE, 0, 0, t())).not.toBeNull();
    a.net.throwProjectile(r.session.tick, 0, 0, FRAG);
    throws.reconcile(a.net.pouch!, t());
    expect(throws.count(FRAG)).toBe(marksman[FRAG]! - 1);
    r.step(3);
    expect(a.net.pouch![FRAG]).toBe(marksman[FRAG]! - 1);
    throws.reconcile(a.net.pouch!, t());
    expect(throws.count(FRAG)).toBe(marksman[FRAG]! - 1);
    expect(throws.pendingThrows).toBe(0);
    expect(throws.canThrow(t() + 10)).toBe(false);

    // Killed and respawned: the server refills the class pouch, and the page follows.
    const slot = r.session.slots[a.net.slot]!;
    slot.health.current = 0;
    slot.health.diedAt = t();
    r.step(Math.ceil((DAMAGE.respawnSeconds + 1) / TICK_SECONDS));
    expect(a.net.pouch).toEqual(marksman);
    throws.reconcile(a.net.pouch!, t());
    expect([throws.count(FRAG), throws.count(ROCKET)]).toEqual(marksman);

    // Spend it again, then the page drops and comes back: a fresh page shows the server's count, not a full pouch.
    a.net.throwProjectile(r.session.tick, 0, 0, FRAG);
    r.step(3);
    const resume = a.net.resumeToken;
    a.pair.b.close('network lost');
    a.pair.settle();
    r.step(10);
    const back = r.join('a', resume);
    r.step(3);
    expect(back.net.pouch![FRAG]).toBe(marksman[FRAG]! - 1);
    const reloaded = new ThrowQA();
    reloaded.reconcile(back.net.pouch!, t());
    expect(reloaded.count(FRAG)).toBe(marksman[FRAG]! - 1);
  });
});
