/**
 * U-054: C4. The support throws it and it sticks where it lands; everyone
 * else puts it on a surface within reach; right click with it in hand
 * detonates every charge its owner has out; E takes an unexploded one back.
 * Real `Session` and `NetClient`s over loopback.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { INPUT_BUTTONS, PROJECTILE_IDS, TICK_SECONDS, WEAPON_IDS, createLoopbackPair, degToAngle, encodeMessage, getProjectile, type Message } from '@sandline/shared';
import { initNav } from '@sandline/server/nav';
import { Session } from '@sandline/server/session';
import { NetClient } from '../net/NetClient.ts';

const E = INPUT_BUTTONS.interact;

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




const C4 = PROJECTILE_IDS.indexOf('c4');
const item = WEAPON_IDS.length + C4;
const DETONATE = INPUT_BUTTONS.cook;
const ticks = (seconds: number) => Math.round(seconds / TICK_SECONDS);
const DOWN_45 = degToAngle(-45) & 0xfff;
type Live = { kind: number; stuck?: boolean; ownerNetId: number; state: { x: number; y: number; z: number; age: number } };
const charges = (s: Session): Live[] => (s as unknown as { projectiles: Live[] }).projectiles.filter((p) => p.kind === C4);

describe('C4 (U-054)', () => {
  beforeAll(() => initNav());

  /** Preach (0), Brennan (1) and the support (2) on open ground, the support with its two charges in hand. */
  const started = () => {
    const r = room();
    const preach = r.join('a');
    const brennan = r.join('b');
    const support = r.join('c');
    r.send(preach, { kind: 'RoomCommand', command: 'start' });
    r.step(5);
    r.place(preach, { x: -10, z: -12 });
    r.place(brennan, { x: -10, z: -8 });
    r.place(support, { x: -14, z: -12 });
    const s = (p: { net: NetClient }) => r.session.slots[p.net.slot]!;
    return { r, preach, brennan, support, sp: s(preach), sb: s(brennan), ss: s(support) };
  };

  it('the support carries 2 and throws one: it flies, sticks where it first lands, and waits armed', () => {
    const { r, support, ss } = started();
    expect(ss.pouch[C4]).toBe(2);
    expect(ss.equipment).toBe(C4);
    r.send(support, { kind: 'Equip', item });
    support.net.throwProjectile(r.session.tick, 0, 0, C4);
    support.pair.settle();
    r.step(ticks(3));
    const [c] = charges(r.session);
    expect(charges(r.session)).toHaveLength(1);
    expect(c!.stuck).toBe(true);
    expect(c!.state.z).toBeGreaterThan(-12);
    expect(ss.pouch[C4]).toBe(1);
    // It does not go off by itself, however long it waits.
    r.step(ticks(5));
    expect(charges(r.session)).toHaveLength(1);
  });

  it('right click with C4 in hand detonates every charge the owner has out, and hurts what is near', () => {
    const { r, brennan, support, sb, ss } = started();
    r.send(support, { kind: 'Equip', item });
    ss.pouch[C4] = 2;
    for (let i = 0; i < 2; i++) {
      support.net.throwProjectile(r.session.tick, 0, 0, C4);
      support.pair.settle();
      r.step(ticks(1.5));
    }
    expect(charges(r.session)).toHaveLength(2);
    // Brennan walks up to the charges.
    const [first] = charges(r.session);
    r.place(brennan, { x: first!.state.x + 1, z: first!.state.z });
    const before = sb.health.current;
    r.tap(DETONATE, support);
    expect(charges(r.session)).toHaveLength(0);
    expect(sb.health.current).toBeLessThan(before);
  });

  it('only the owner\'s charges: another soldier\'s right click detonates none of them', () => {
    const { r, support, sp, preach, ss } = started();
    r.send(support, { kind: 'Equip', item });
    support.net.throwProjectile(r.session.tick, 0, 0, C4);
    support.pair.settle();
    r.step(ticks(1.5));
    expect(charges(r.session)).toHaveLength(1);
    sp.pouch[C4] = 1;
    sp.equipment = C4;
    r.send(preach, { kind: 'Equip', item });
    r.tap(DETONATE, preach);
    expect(charges(r.session)).toHaveLength(1);
    expect(ss.pouch[C4]).toBe(1);
  });

  it('a downed owner cannot detonate; a living one can after', () => {
    const { r, support, ss } = started();
    r.send(support, { kind: 'Equip', item });
    support.net.throwProjectile(r.session.tick, 0, 0, C4);
    support.pair.settle();
    r.step(ticks(1.5));
    Object.assign(ss.health, { current: 0, downedAt: r.now / 1000 });
    r.tap(DETONATE, support);
    expect(charges(r.session)).toHaveLength(1);
    Object.assign(ss.health, { current: 50, downedAt: null });
    r.tap(DETONATE, support);
    expect(charges(r.session)).toHaveLength(0);
  });

  it('anyone else puts it on a surface within 2.5 m: the ground at their feet, not the far distance', () => {
    const { r, preach, sp } = started();
    sp.pouch[C4] = 1;
    sp.equipment = C4;
    r.send(preach, { kind: 'Equip', item });
    // Looking level over open ground: nothing in reach, nothing spent.
    preach.net.throwProjectile(r.session.tick, 0, 0, C4);
    preach.pair.settle();
    r.step(3);
    expect(charges(r.session)).toHaveLength(0);
    expect(sp.pouch[C4]).toBe(1);
    // Looking down 45 degrees: the ground is 1.55 m away.
    preach.net.throwProjectile(r.session.tick, 0, DOWN_45, C4);
    preach.pair.settle();
    r.step(3);
    const [c] = charges(r.session);
    expect(charges(r.session)).toHaveLength(1);
    expect(c!.stuck).toBe(true);
    expect(Math.hypot(c!.state.x - sp.state.x, c!.state.z - sp.state.z)).toBeLessThan(2.5);
    expect(sp.pouch[C4]).toBe(0);
  });

  it('E takes an unexploded charge of your own back; not someone else\'s', () => {
    const { r, preach, support, sp, ss } = started();
    r.send(support, { kind: 'Equip', item });
    support.net.throwProjectile(r.session.tick, 0, DOWN_45, C4);
    support.pair.settle();
    r.step(ticks(1.5));
    const [c] = charges(r.session);
    expect(charges(r.session)).toHaveLength(1);
    // Preach beside it cannot take it.
    r.place(preach, { x: c!.state.x + 0.5, z: c!.state.z });
    r.press(preach);
    expect(charges(r.session)).toHaveLength(1);
    expect(sp.pouch[C4]).toBe(0);
    // Its owner beside it can.
    r.place(support, { x: c!.state.x - 0.5, z: c!.state.z });
    const had = ss.pouch[C4]!;
    r.press(support);
    expect(charges(r.session)).toHaveLength(0);
    expect(ss.pouch[C4]).toBe(had + 1);
  });

  it('a very old charge goes quietly, and a retry clears the ones out', () => {
    const { r, support, brennan, sb } = started();
    r.send(support, { kind: 'Equip', item });
    support.net.throwProjectile(r.session.tick, 0, 0, C4);
    support.pair.settle();
    r.step(ticks(1.5));
    const [c] = charges(r.session);
    r.place(brennan, { x: c!.state.x + 0.5, z: c!.state.z });
    const before = sb.health.current;
    c!.state.age = getProjectile('c4').maxLifeSeconds - TICK_SECONDS / 2;
    r.step(3);
    expect(charges(r.session)).toHaveLength(0);
    expect(sb.health.current).toBe(before);
    // Another, then a restart of the mission.
    support.net.throwProjectile(r.session.tick, 0, 0, C4);
    support.pair.settle();
    r.step(ticks(1.5));
    expect(charges(r.session)).toHaveLength(1);
    r.session.restartMission();
    r.step(2);
    expect(charges(r.session)).toHaveLength(0);
  });
});
