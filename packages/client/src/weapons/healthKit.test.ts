/**
 * U-047: the health kits (slot 6), end to end — a real `Session` and real
 * `NetClient`s over loopback. The kit is drawn with Equip, applied by holding
 * the trigger, judged and timed by the host; nothing the page sends says whom
 * it heals or how much.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DAMAGE, INPUT_BUTTONS, KIT_EQUIP_ITEM, TICK_SECONDS, createLoopbackPair, encodeMessage, isAlive, isDowned, type Message } from '@sandline/shared';
import { initNav } from '@sandline/server/nav';
import { Session } from '@sandline/server/session';
import { NetClient } from '../net/NetClient.ts';

const E = INPUT_BUTTONS.interact;
const FIRE = INPUT_BUTTONS.fire;
/** On greybox-01, south of `as-wall-1` (x 3..20, z 12.8..13.2, 2.4 m tall). */

function room() {
  const session = new Session(undefined, '', 'greybox-01', { roomLobby: true });
  let now = 0;
  let tick = 0;
  const players: { net: NetClient; pair: ReturnType<typeof createLoopbackPair>; buttons: number }[] = [];
  const settle = () => players.forEach((p) => p.pair.settle());
  const join = (name: string, resume = '') => {
    const pair = createLoopbackPair();
    session.addConnection(pair.a, now);
    const net = new NetClient(pair.b, name);
    const p = { net, pair, buttons: 0 };
    players.push(p);
    net.join('', '', '', resume);
    settle();
    return p;
  };
  const send = (p: { pair: ReturnType<typeof createLoopbackPair> }, msg: Message) => {
    p.pair.b.send(encodeMessage(msg));
    settle();
  };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      tick += 1;
      now += TICK_SECONDS * 1000;
      for (const p of players) if (p.pair.b.isOpen) p.pair.b.send(encodeMessage({ kind: 'Input', tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: p.buttons }));
      settle();
      session.step(now);
      settle();
    }
  };
  const place = (p: { net: NetClient }, at: { x: number; z: number }) => {
    const s = session.slots[p.net.slot]!;
    s.state = { ...s.state, x: at.x, y: 0, z: at.z, vy: 0 };
  };
  const tap = (button: number, ...ps: { buttons: number }[]) => {
    for (const p of ps) p.buttons = button;
    step(1);
    for (const p of ps) p.buttons = 0;
    step(1);
  };
  const press = (...ps: { buttons: number }[]) => tap(E, ...ps);
  return { session, join, send, step, place, press, tap, get now() { return now; } };
}




const ticks = (seconds: number) => Math.round(seconds / TICK_SECONDS);
const NEAR_A = { x: 10, z: 11 };
const NEAR_B = { x: 10.6, z: 11 };
const FAR_B = { x: 14, z: 11 };

describe('health kits (U-047)', () => {
  beforeAll(() => initNav());

  const started = () => {
    const r = room();
    const a = r.join('a');
    const b = r.join('b');
    r.send(a, { kind: 'RoomCommand', command: 'start' });
    r.step(5);
    r.place(a, NEAR_A);
    r.send(a, { kind: 'Equip', item: KIT_EQUIP_ITEM });
    return { r, a, b, sa: r.session.slots[a.net.slot]!, sb: r.session.slots[b.net.slot]! };
  };
  const hold = (r: { step(n: number): void }, p: { buttons: number }, seconds: number) => {
    p.buttons = FIRE;
    r.step(ticks(seconds));
  };

  it('holding the trigger for the full time heals oneself to full and spends one kit', () => {
    const { r, a, sa } = started();
    sa.health.current = 40;
    const kits = sa.kits;
    expect(kits).toBe(3);
    hold(r, a, DAMAGE.kit.seconds - 1);
    expect(sa.health.current).toBe(40);
    expect(a.net.kits).toBe(3);
    hold(r, a, 1.3);
    a.buttons = 0;
    r.step(2);
    expect(sa.health.current).toBe(sa.health.max);
    expect(sa.kits).toBe(2);
    expect(a.net.kits).toBe(2);
  });

  it('shows the progress to the page while it runs', () => {
    const { r, a, sa } = started();
    sa.health.current = 40;
    hold(r, a, DAMAGE.kit.seconds / 2);
    a.buttons = 0;
    expect(a.net.kitProgress).toBeGreaterThan(30);
    expect(a.net.kitProgress).toBeLessThan(70);
    r.step(2);
    expect(a.net.kitProgress).toBe(0);
  });

  it('letting go cancels it: nothing healed, nothing spent, and starting again starts from nothing', () => {
    const { r, a, sa } = started();
    sa.health.current = 40;
    hold(r, a, 6);
    a.buttons = 0;
    r.step(3);
    hold(r, a, 6);
    a.buttons = 0;
    r.step(2);
    expect(sa.health.current).toBe(40);
    expect(sa.kits).toBe(3);
  });

  it('damage interrupts it', () => {
    const { r, a, sa } = started();
    sa.health.current = 40;
    hold(r, a, 6);
    sa.health.current = 35; // hit
    hold(r, a, 5); // 11 s in all, but the clock restarted at the hit
    expect(sa.kits).toBe(3);
    expect(sa.health.current).toBe(35);
    hold(r, a, DAMAGE.kit.seconds);
    expect(sa.health.current).toBe(sa.health.max);
    expect(sa.kits).toBe(2);
  });

  it('a hurt mate in reach is healed to full, before oneself', () => {
    const { r, a, b, sa, sb } = started();
    r.place(b, NEAR_B);
    sa.health.current = 60;
    sb.health.current = 20;
    hold(r, a, DAMAGE.kit.seconds + 0.5);
    a.buttons = 0;
    r.step(2);
    expect(sb.health.current).toBe(sb.health.max);
    expect(sa.health.current).toBe(60);
    expect(sa.kits).toBe(2);
  });

  it('a mate out of reach is not healed', () => {
    const { r, a, b, sa, sb } = started();
    r.place(b, FAR_B);
    sb.health.current = 20;
    sa.health.current = sa.health.max;
    hold(r, a, DAMAGE.kit.seconds + 0.5);
    expect(sb.health.current).toBe(20);
    expect(sa.kits).toBe(3);
  });

  it('a downed mate goes to half health, alive, at the price of one kit', () => {
    const { r, a, b, sa, sb } = started();
    r.place(b, NEAR_B);
    Object.assign(sb.health, { current: 0, downedAt: r.now / 1000 });
    expect(isDowned(sb.health)).toBe(true);
    hold(r, a, DAMAGE.kit.seconds + 0.5);
    a.buttons = 0;
    r.step(2);
    expect(isAlive(sb.health)).toBe(true);
    expect(sa.kits).toBe(2);
    expect(sb.health.current).toBe(Math.round(sb.health.max * DAMAGE.kit.downedHealthFraction));
  });

  it('a downed soldier cannot apply one, to themselves or anyone', () => {
    const { r, a, sa } = started();
    Object.assign(sa.health, { current: 0, downedAt: r.now / 1000 });
    hold(r, a, DAMAGE.kit.seconds + 0.5);
    expect(sa.kits).toBe(3);
    expect(isDowned(sa.health)).toBe(true);
  });

  it('with none left, or with a gun in hand, the trigger heals nothing', () => {
    const { r, a, sa } = started();
    sa.health.current = 40;
    sa.kits = 0;
    hold(r, a, DAMAGE.kit.seconds + 0.5);
    expect(sa.health.current).toBe(40);
    a.buttons = 0;
    sa.kits = 3;
    r.send(a, { kind: 'Equip', item: 0 });
    hold(r, a, DAMAGE.kit.seconds + 0.5);
    expect(sa.health.current).toBe(40);
    expect(sa.kits).toBe(3);
  });

  it('a full-health soldier alone spends nothing', () => {
    const { r, a, sa } = started();
    hold(r, a, DAMAGE.kit.seconds + 0.5);
    expect(sa.kits).toBe(3);
  });

  it('the support (slot 2) applies one in 8 s, a 20% discount, and everyone else in 10 s (U-049)', () => {
    const r = room();
    const [a, , c] = [r.join('a'), r.join('b'), r.join('c')];
    r.send(a, { kind: 'RoomCommand', command: 'start' });
    r.step(5);
    const sc = r.session.slots[c.net.slot]!;
    const sa = r.session.slots[a.net.slot]!;
    expect(r.session.roster[c.net.slot]?.classId).toBe('holloway');
    r.place(c, { x: 4, z: 11 });
    r.place(a, { x: 20, z: 11 }); // apart, so each is only its own patient
    for (const [p, s] of [[c, sc], [a, sa]] as const) {
      r.send(p, { kind: 'Equip', item: KIT_EQUIP_ITEM });
      s.health.current = 40;
    }
    c.buttons = FIRE;
    a.buttons = FIRE;
    r.step(ticks(7.5));
    expect(sc.health.current).toBe(40);
    r.step(ticks(0.8));
    expect(sc.health.current).toBe(sc.health.max); // 8 s
    expect(sa.health.current).toBe(40); // Preach, 10 s, is not there yet
    r.step(ticks(2));
    expect(sa.health.current).toBe(sa.health.max);
  });
});
