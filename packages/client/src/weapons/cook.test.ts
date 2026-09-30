/**
 * U-046: right click with a grenade in hand pulls the pin (a press), the fuse
 * runs on the host, and a cooked grenade flies with what is left of it; one
 * not thrown goes off in the hand. End to end over loopback.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { INPUT_BUTTONS, TICK_SECONDS, WEAPON_IDS, createLoopbackPair, encodeMessage, getProjectile, type Message } from '@sandline/shared';
import { initNav } from '@sandline/server/nav';
import { Session } from '@sandline/server/session';
import { NetClient } from '../net/NetClient.ts';

const E = INPUT_BUTTONS.interact;
const C = INPUT_BUTTONS.cook;
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



const FRAG = WEAPON_IDS.length + 0;
const ticks = (seconds: number) => Math.round(seconds / TICK_SECONDS);
type Live = { state: { age: number }; kind: number };
const flying = (s: Session): Live[] => (s as unknown as { projectiles: Live[] }).projectiles;

describe('cooking a grenade (U-046)', () => {
  beforeAll(() => initNav());

  const started = () => {
    const r = room();
    const a = r.join('a');
    r.send(a, { kind: 'RoomCommand', command: 'start' });
    r.step(5);
    r.send(a, { kind: 'Equip', item: FRAG });
    return { r, a };
  };

  it('a throw after a cook carries the fuse used up, measured by the host', () => {
    const { r, a } = started();
    const fuse = getProjectile('frag').fuseSeconds;
    const before = r.session.slots[a.net.slot]!.pouch[0]!;
    r.tap(C, a); // press and release: the pin stays pulled
    r.step(ticks(2));
    a.net.throwProjectile(r.session.tick, 0, 0, 0);
    a.pair.settle();
    r.step(1);
    const g = flying(r.session)[0]!;
    expect(g).toBeDefined();
    expect(g.state.age).toBeGreaterThan(1.8);
    expect(g.state.age).toBeLessThan(fuse);
    expect(r.session.slots[a.net.slot]!.pouch[0]).toBe(before - 1);
  });

  it('a throw without a cook has the whole fuse', () => {
    const { r, a } = started();
    r.step(2);
    a.net.throwProjectile(r.session.tick, 0, 0, 0);
    a.pair.settle();
    r.step(1);
    expect(flying(r.session)[0]!.state.age).toBeLessThan(0.2);
  });

  it('a cooked grenade not thrown goes off in the hand and is spent', () => {
    const { r, a } = started();
    const slot = r.session.slots[a.net.slot]!;
    const before = slot.health.current;
    const had = slot.pouch[0]!;
    r.tap(C, a);
    r.step(ticks(getProjectile('frag').fuseSeconds) + 4);
    expect(slot.pouch[0]).toBe(had - 1);
    expect(slot.health.current).toBeLessThan(before);
    expect(flying(r.session)).toHaveLength(0);
  });

  it('a held right click is one press: it does not cook the next grenade after a throw', () => {
    const { r, a } = started();
    r.session.slots[a.net.slot]!.pouch[0] = 3; // enough that a second cook would not be stopped by an empty pouch
    const had = 3;
    a.buttons = C;
    r.step(ticks(1));
    a.net.throwProjectile(r.session.tick, 0, 0, 0);
    a.pair.settle();
    r.step(ticks(1.5));
    expect(r.session.slots[a.net.slot]!.cook).toBeNull();
    expect(r.session.slots[a.net.slot]!.pouch[0]).toBe(had - 1);
  });

  it('right click with a gun in hand pulls no pin', () => {
    const r = room();
    const a = r.join('a');
    r.send(a, { kind: 'RoomCommand', command: 'start' });
    r.step(5);
    r.tap(C, a);
    expect(r.session.slots[a.net.slot]!.cook).toBeNull();
  });
});
