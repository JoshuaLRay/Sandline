/**
 * U-018: taking a dead enemy's gun off the ground as your primary, end to
 * end — a real `Session` with class loadouts on greybox-01, real
 * `NetClient`s over loopback pressing interact.
 *
 * - The host judges the press: alive, within reach of the eye, a clear line
 *   (not through a wall); nothing the page sends names a pickup or its
 *   rounds. Taken whole on one tick: the gun is the primary, in hand with
 *   the pickup's rounds, and the primary it replaces goes down as a pickup.
 * - Key 1 is that gun and 2 the pistol; the class's old primary, and a Fire
 *   naming it, are refused.
 * - Two soldiers pressing on the same tick: one winner, one transfer.
 * - A respawn and a retry give the class's primary back; a dropped player who
 *   resumes keeps what they picked up.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DAMAGE, TICK_SECONDS, WEAPON_IDS, createLoopbackPair, encodeMessage, getWeapon, type Message } from '@sandline/shared';
import { initNav } from '@sandline/server/nav';
import { Session } from '@sandline/server/session';
import { NetClient } from '../net/NetClient.ts';

const E = 0b1000;
/** On greybox-01, south of `as-wall-1` (x 3..20, z 12.8..13.2, 2.4 m tall). */
const GROUND = { x: 10, y: 0, z: 12.2 };
const NEAR = { x: 10, z: 11.4 };
const BEHIND = { x: 10, z: 13.9 };
const idx = (id: string) => WEAPON_IDS.indexOf(id as (typeof WEAPON_IDS)[number]);

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
  const press = (...ps: { buttons: number }[]) => {
    for (const p of ps) p.buttons = E;
    step(1);
    for (const p of ps) p.buttons = 0;
    step(1);
  };
  /** A gun on the ground, as a dead enemy would leave it. */
  const drop = (id: string, ammo: number, at = GROUND) => (session as unknown as { placePickup(id: string, ammo: number, at: object, yaw: number): void }).placePickup(id, ammo, at, 0);
  return { session, join, send, step, place, press, drop, get now() { return now; } };
}

describe('taking a gun off the ground as the primary (U-018)', () => {
  beforeAll(() => initNav());

  it('the host takes the press only in reach and in sight; then it is the primary, in hand with its rounds, and the old one lies in its place', () => {
    const r = room();
    const a = r.join('a');
    r.send(a, { kind: 'RoomCommand', command: 'class', classId: 'team-leader' });
    r.send(a, { kind: 'RoomCommand', command: 'start' });
    r.step(5);
    expect(r.session.loadoutOf(a.net.slot)).toMatchObject({ weapon: 'carbine', primary: 'carbine' });
    const slot = r.session.slots[a.net.slot]!;
    slot.weaponState.ammo = 11;
    r.drop('marksman', 7);
    // Far off: nothing. Behind the wall, in reach: nothing.
    r.place(a, { x: 10, z: 6 });
    r.press(a);
    r.place(a, BEHIND);
    r.press(a);
    // Down: nothing.
    r.place(a, NEAR);
    Object.assign(slot.health, { current: 0, downedAt: r.now / 1000 });
    r.press(a);
    expect(r.session.pickups).toHaveLength(1);
    expect(r.session.loadoutOf(a.net.slot).primary).toBe('carbine');
    Object.assign(slot.health, { current: slot.health.max, downedAt: null });
    // In reach, in sight: taken whole.
    r.press(a);
    expect(r.session.loadoutOf(a.net.slot)).toMatchObject({ weapon: 'marksman', primary: 'marksman', ammo: 7 });
    expect(r.session.pickups.map((p) => [WEAPON_IDS[p.weapon], p.ammo])).toEqual([['carbine', 11]]);
    // The page hears it: its primary and its magazine.
    r.step(2);
    expect(a.net.primary).toBe(idx('marksman'));
    expect(a.net.magazine).toEqual({ weapon: idx('marksman'), ammo: 7 });
  });

  it('key 2 is still the pistol and 1 the new gun; the class\'s old primary — by Equip or by a Fire naming it — is refused', () => {
    const r = room();
    const a = r.join('a');
    r.send(a, { kind: 'RoomCommand', command: 'class', classId: 'team-leader' });
    r.send(a, { kind: 'RoomCommand', command: 'start' });
    r.step(5);
    r.drop('breacher', 5);
    r.place(a, NEAR);
    r.press(a);
    expect(r.session.loadoutOf(a.net.slot).primary).toBe('breacher');
    r.send(a, { kind: 'Equip', item: idx('sidearm') });
    expect(r.session.loadoutOf(a.net.slot).weapon).toBe('sidearm');
    r.send(a, { kind: 'Equip', item: idx('carbine') });
    expect(r.session.loadoutOf(a.net.slot).weapon).toBe('sidearm');
    r.send(a, { kind: 'Equip', item: idx('breacher') });
    expect(r.session.loadoutOf(a.net.slot).weapon).toBe('breacher');
    // A Fire naming the carbine used to put it back in hand; now it is refused, shot and all.
    const before = r.session.loadoutOf(a.net.slot).ammo;
    a.net.fire(r.session.tick, 0, 0, idx('carbine'), false);
    r.step(2);
    expect(r.session.loadoutOf(a.net.slot)).toMatchObject({ weapon: 'breacher', ammo: before });
  });

  it('two soldiers pressing on the same tick: one takes it, one transfer, nothing doubled', () => {
    const r = room();
    const a = r.join('a');
    const b = r.join('b');
    for (const p of [a, b]) r.send(p, { kind: 'RoomCommand', command: 'class', classId: 'team-leader' });
    r.send(a, { kind: 'RoomCommand', command: 'start' });
    r.step(5);
    r.drop('marksman', 9);
    r.place(a, NEAR);
    r.place(b, { x: NEAR.x + 0.6, z: NEAR.z });
    r.press(a, b);
    const primaries = [a, b].map((p) => r.session.loadoutOf(p.net.slot).primary);
    expect(primaries.filter((g) => g === 'marksman')).toHaveLength(1);
    expect(primaries.filter((g) => g === 'carbine')).toHaveLength(1);
    // The marksman left the ground; one carbine went down in its place.
    expect(r.session.pickups.map((p) => WEAPON_IDS[p.weapon])).toEqual(['carbine']);
  });

  it('a respawn and a retry give the class\'s primary back; a dropped player who resumes keeps what they took', () => {
    const r = room();
    const a = r.join('a');
    const keep = r.join('keep'); // a second seated player: the room is not paused while `a` is away (U-025)
    r.send(a, { kind: 'RoomCommand', command: 'class', classId: 'team-leader' });
    r.send(a, { kind: 'RoomCommand', command: 'start' });
    r.step(5);
    r.drop('marksman', 9);
    r.place(a, NEAR);
    r.press(a);
    expect(r.session.loadoutOf(a.net.slot).primary).toBe('marksman');
    // Dropped and resumed within the grace: still the marksman.
    const resume = a.net.resumeToken;
    a.pair.b.close('network lost');
    a.pair.settle();
    r.step(10);
    const back = r.join('a', resume);
    r.step(3);
    expect(back.net.slot).toBe(a.net.slot);
    expect(r.session.loadoutOf(back.net.slot).primary).toBe('marksman');
    // Killed and respawned: the class's carbine again, in hand.
    const slot = r.session.slots[back.net.slot]!;
    Object.assign(slot.health, { current: 0, diedAt: r.now / 1000 });
    r.step(Math.ceil((DAMAGE.respawnSeconds + 1) / TICK_SECONDS));
    expect(r.session.loadoutOf(back.net.slot)).toMatchObject({ weapon: 'carbine', primary: 'carbine', ammo: getWeapon('carbine').magSize });
    // Taken again, then a restart: the carbine again.
    // (The carbine the first take left lies at NEAR; this one lies clear of it.)
    r.drop('breacher', 3, { x: 15, y: 0, z: 12.2 });
    r.place(back, { x: 15, z: 11.4 });
    r.press(back);
    expect(r.session.loadoutOf(back.net.slot).primary).toBe('breacher');
    r.session.restartMission();
    r.step(2);
    expect(r.session.loadoutOf(back.net.slot)).toMatchObject({ primary: 'carbine', weapon: 'carbine' });
    expect(r.session.pickups).toHaveLength(0);
    void keep;
  });
});
