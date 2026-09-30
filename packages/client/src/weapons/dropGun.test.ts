/**
 * U-029: G puts the held gun on the ground, end to end — a real `Session` with
 * class loadouts and real `NetClient`s over loopback. The host judges the
 * press; the gun and its rounds are the host's, and what is dropped lies once,
 * for anyone else to take with E (a swap when the hands are full).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { INPUT_BUTTONS, TICK_SECONDS, WEAPON_IDS, createLoopbackPair, encodeMessage, type Message } from '@sandline/shared';
import { initNav } from '@sandline/server/nav';
import { Session } from '@sandline/server/session';
import { NetClient } from '../net/NetClient.ts';

const E = INPUT_BUTTONS.interact;
const G = INPUT_BUTTONS.drop;
/** On greybox-01, south of `as-wall-1` (x 3..20, z 12.8..13.2, 2.4 m tall). */
const GROUND = { x: 10, y: 0, z: 12.2 };
const NEAR = { x: 10, z: 11.4 };

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
  /** A gun on the ground, as a dead enemy would leave it. */
  const drop = (id: string, ammo: number, at = GROUND) => (session as unknown as { placePickup(id: string, ammo: number, at: object, yaw: number): void }).placePickup(id, ammo, at, 0);
  const press = (...ps: { buttons: number }[]) => tap(E, ...ps);
  const drop_ = (...ps: { buttons: number }[]) => tap(G, ...ps);
  return { session, join, send, step, place, press, drop_, drop, get now() { return now; } };
}


describe('dropping the held gun (U-029)', () => {
  beforeAll(() => initNav());

  const started = (n: number) => {
    const r = room();
    const ps = Array.from({ length: n }, (_, i) => r.join(`p${i}`));
    r.send(ps[0]!, { kind: 'RoomCommand', command: 'start' });
    r.step(5);
    return { r, ps };
  };

  it('G leaves the primary on the ground with its rounds; the soldier is left with the pistol, and the page is told', () => {
    const { r, ps } = started(1);
    const a = ps[0]!;
    const slot = r.session.slots[a.net.slot]!;
    slot.weaponState.ammo = 7;
    r.drop_(a);
    expect(r.session.loadoutOf(a.net.slot)).toMatchObject({ weapon: 'sidearm', primary: null, secondary: null });
    expect(r.session.pickups.map((p) => [WEAPON_IDS[p.weapon], p.ammo])).toEqual([['carbine', 7]]);
    expect(a.net.primary).toBe(-1);
    expect(a.net.magazine?.weapon).toBe(WEAPON_IDS.indexOf('sidearm'));
    // The carbine is not carried any more: neither drawn by Equip nor fired by name.
    r.send(a, { kind: 'Equip', item: WEAPON_IDS.indexOf('carbine') });
    expect(r.session.loadoutOf(a.net.slot).weapon).toBe('sidearm');
  });

  it('a squadmate takes it with E, ammo intact and nothing doubled; the dropper takes it back the same way', () => {
    const { r, ps } = started(2);
    const [a, b] = [ps[0]!, ps[1]!];
    r.session.slots[a.net.slot]!.weaponState.ammo = 5;
    r.place(a, NEAR);
    r.place(b, { x: NEAR.x + 0.5, z: NEAR.z });
    r.drop_(a);
    expect(r.session.pickups).toHaveLength(1);
    r.press(b);
    // Brennan carries an LMG, which the carbine (an AR) replaces; that lies where he stood.
    expect(r.session.loadoutOf(b.net.slot)).toMatchObject({ weapon: 'carbine', primary: 'carbine', ammo: 5 });
    expect(r.session.pickups.map((p) => WEAPON_IDS[p.weapon])).toEqual(['lmg']);
    r.press(a);
    expect(r.session.loadoutOf(a.net.slot)).toMatchObject({ weapon: 'lmg', primary: 'lmg' });
    expect(r.session.pickups).toHaveLength(0);
  });

  it('a respawn gives the class\'s primary back in hand', () => {
    const { r, ps } = started(2);
    const a = ps[0]!;
    r.drop_(a);
    expect(r.session.loadoutOf(a.net.slot).primary).toBeNull();
    (r.session as unknown as { restorePrimary(s: unknown): void }).restorePrimary(r.session.slots[a.net.slot]);
    expect(r.session.loadoutOf(a.net.slot)).toMatchObject({ weapon: 'carbine', primary: 'carbine' });
  });

  it('with two primaries G puts down the one in hand and the other is drawn as the primary', () => {
    const { r, ps } = started(3);
    const support = ps[2]!;
    expect(r.session.loadoutOf(support.net.slot)).toMatchObject({ weapon: 'smg', primary: 'smg', secondary: 'breacher' });
    r.drop_(support);
    expect(r.session.loadoutOf(support.net.slot)).toMatchObject({ weapon: 'breacher', primary: 'breacher', secondary: null });
    expect(r.session.pickups.map((p) => WEAPON_IDS[p.weapon])).toEqual(['smg']);
    // The last one goes too, and the support (no pistol) is left with the knife.
    r.drop_(support);
    expect(r.session.loadoutOf(support.net.slot)).toMatchObject({ weapon: 'knife', primary: null });
    // The knife is not a gun to put down.
    r.drop_(support);
    expect(r.session.pickups).toHaveLength(2);
    expect(r.session.loadoutOf(support.net.slot).weapon).toBe('knife');
  });

  it('the pistol can be put down too, comes back only as the pistol, and only to a class that lists one; the knife stays', () => {
    const { r, ps } = started(3);
    const [a, , support] = [ps[0]!, ps[1]!, ps[2]!];
    r.send(a, { kind: 'Equip', item: WEAPON_IDS.indexOf('sidearm') });
    r.session.slots[a.net.slot]!.weaponState.ammo = 4;
    r.place(a, NEAR);
    r.drop_(a);
    expect(r.session.loadoutOf(a.net.slot)).toMatchObject({ weapon: 'carbine', primary: 'carbine' });
    expect(r.session.pickups.map((p) => [WEAPON_IDS[p.weapon], p.ammo])).toEqual([['sidearm', 4]]);
    expect(a.net.noPistol).toBe(true);
    // Not carried any more: Equip is refused.
    r.send(a, { kind: 'Equip', item: WEAPON_IDS.indexOf('sidearm') });
    expect(r.session.loadoutOf(a.net.slot).weapon).toBe('carbine');
    // The support's class lists no pistol: it cannot pick this one up.
    r.place(support, { x: NEAR.x + 0.3, z: NEAR.z });
    r.press(support);
    expect(r.session.pickups).toHaveLength(1);
    expect(r.session.loadoutOf(support.net.slot).primary).toBe('smg');
    // Preach can, and it is the pistol in hand with its rounds, the carbine still his primary.
    r.press(a);
    expect(r.session.loadoutOf(a.net.slot)).toMatchObject({ weapon: 'sidearm', primary: 'carbine', ammo: 4 });
    expect(r.session.pickups).toHaveLength(0);
    expect(a.net.noPistol).toBe(false);
  });

  it('a downed soldier cannot drop, and a forged press changes nothing that is not the host\'s to give', () => {
    const { r, ps } = started(1);
    const a = ps[0]!;
    const slot = r.session.slots[a.net.slot]!;
    Object.assign(slot.health, { current: 0, downedAt: r.now / 1000 });
    r.drop_(a);
    expect(r.session.loadoutOf(a.net.slot).primary).toBe('carbine');
    expect(r.session.pickups).toHaveLength(0);
  });
});
