/**
 * U-048: slot 5 is per character. Brennan carries the launcher; the equipment
 * in hand goes down whole with G and anyone can take it with E; a soldier
 * without equipment draws nothing. Real `Session` and `NetClient`s.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { INPUT_BUTTONS, PROJECTILE_IDS, TICK_SECONDS, WEAPON_IDS, createLoopbackPair, encodeMessage, pickupProjectile, type Message } from '@sandline/shared';
import { initNav } from '@sandline/server/nav';
import { Session } from '@sandline/server/session';
import { NetClient } from '../net/NetClient.ts';

const E = INPUT_BUTTONS.interact;
/** On greybox-01, south of `as-wall-1` (x 3..20, z 12.8..13.2, 2.4 m tall). */
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
  const press = (...ps: { buttons: number }[]) => tap(E, ...ps);
  return { session, join, send, step, place, press, tap, get now() { return now; } };
}



const ROCKET = PROJECTILE_IDS.indexOf('rocket');
const CONCUSSION = PROJECTILE_IDS.indexOf('concussion');
const FRAG = PROJECTILE_IDS.indexOf('frag');
const item = (projectile: number) => WEAPON_IDS.length + projectile;

describe('per-character equipment (U-048)', () => {
  beforeAll(() => initNav());

  const started = () => {
    const r = room();
    const preach = r.join('a');
    const brennan = r.join('b');
    r.send(preach, { kind: 'RoomCommand', command: 'start' });
    r.step(5);
    r.place(preach, NEAR);
    r.place(brennan, { x: NEAR.x + 0.4, z: NEAR.z });
    return { r, preach, brennan, sp: r.session.slots[preach.net.slot]!, sb: r.session.slots[brennan.net.slot]! };
  };

  it('Brennan carries 2 rockets in slot 5 and Preach 4 concussion grenades; only the carried equipment can be drawn', () => {
    const { r, preach, brennan, sp, sb } = started();
    expect(sb.pouch[ROCKET]).toBe(2);
    expect(sb.equipment).toBe(ROCKET);
    expect(sp.pouch[ROCKET]).toBe(0);
    expect(sp.pouch[CONCUSSION]).toBe(4);
    expect(sp.equipment).toBe(CONCUSSION);
    r.step(2);
    expect(brennan.net.equipment).toBe(ROCKET);
    expect(preach.net.equipment).toBe(CONCUSSION);
    r.send(preach, { kind: 'Equip', item: item(ROCKET) });
    expect(sp.heldProjectile).toBe(-1);
    r.send(preach, { kind: 'Equip', item: item(CONCUSSION) });
    expect(sp.heldProjectile).toBe(CONCUSSION);
    r.send(brennan, { kind: 'Equip', item: item(ROCKET) });
    expect(sb.heldProjectile).toBe(ROCKET);
    r.send(brennan, { kind: 'Equip', item: item(FRAG) });
    expect(sb.heldProjectile).toBe(FRAG);
  });

  it('G puts the equipment in hand down whole, with its count; the slot is left empty', () => {
    const { r, brennan, sb } = started();
    r.send(brennan, { kind: 'Equip', item: item(ROCKET) });
    r.tap(INPUT_BUTTONS.drop, brennan);
    expect(sb.equipment).toBe(-1);
    expect(sb.pouch[ROCKET]).toBe(0);
    expect(sb.heldProjectile).toBe(-1);
    expect(r.session.pickups.map((p) => [pickupProjectile(p.weapon), p.ammo])).toEqual([[ROCKET, 2]]);
    r.step(2);
    expect(brennan.net.equipment).toBe(-1);
    // Nothing more to draw; and the next G is the gun in his hands, as it always was.
    r.send(brennan, { kind: 'Equip', item: item(ROCKET) });
    expect(sb.heldProjectile).toBe(-1);
    r.tap(INPUT_BUTTONS.drop, brennan);
    expect(r.session.pickups.map((p) => WEAPON_IDS[p.weapon])).toContain('lmg');
  });

  it('E takes dropped equipment with its count, once, for anyone; then it can be drawn', () => {
    const { r, preach, brennan, sp, sb } = started();
    r.send(brennan, { kind: 'Equip', item: item(ROCKET) });
    r.tap(INPUT_BUTTONS.drop, brennan);
    r.press(preach);
    // A soldier carries one kind in slot 5: taking the rockets puts his concussion grenades down, whole.
    expect(sp.equipment).toBe(ROCKET);
    expect(sp.pouch[ROCKET]).toBe(2);
    expect(sp.pouch[CONCUSSION]).toBe(0);
    expect(sb.pouch[ROCKET]).toBe(0);
    expect(r.session.pickups.map((p) => [pickupProjectile(p.weapon), p.ammo])).toEqual([[CONCUSSION, 4]]);
    r.step(2);
    expect(preach.net.equipment).toBe(ROCKET);
    r.send(preach, { kind: 'Equip', item: item(ROCKET) });
    expect(sp.heldProjectile).toBe(ROCKET);
    // The dropper, empty-handed, takes the concussion grenades Preach put down.
    r.press(brennan);
    expect(sb.equipment).toBe(CONCUSSION);
    expect(sb.pouch[CONCUSSION]).toBe(4);
    expect(sb.pouch[ROCKET]).toBe(0);
    expect(r.session.pickups).toHaveLength(0);
  });

  it('a retry or respawn gives the character\'s own equipment back', () => {
    const { r, preach, brennan, sp, sb } = started();
    r.send(brennan, { kind: 'Equip', item: item(ROCKET) });
    r.tap(INPUT_BUTTONS.drop, brennan);
    r.press(preach);
    expect(sp.equipment).toBe(ROCKET);
    r.session.refillPouch(sp.index);
    r.session.refillPouch(sb.index);
    expect(sp.equipment).toBe(CONCUSSION);
    expect(sp.pouch[CONCUSSION]).toBe(4);
    expect(sp.pouch[ROCKET]).toBe(0);
    expect(sb.equipment).toBe(ROCKET);
    expect(sb.pouch[ROCKET]).toBe(2);
  });
});
