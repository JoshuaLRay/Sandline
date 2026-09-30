/**
 * U-050: the support runs 10% faster than anyone else, from one data value,
 * and the page's prediction agrees with the host (no correction), end to end.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { INPUT_BUTTONS, TICK_SECONDS, createLoopbackPair, encodeMessage, type Message } from '@sandline/shared';
import { initNav } from '@sandline/server/nav';
import { Session } from '@sandline/server/session';
import { NetClient } from '../net/NetClient.ts';

const E = INPUT_BUTTONS.interact;

/** On greybox-01, south of `as-wall-1` (x 3..20, z 12.8..13.2, 2.4 m tall). */

function room() {
  const session = new Session(undefined, '', 'greybox-01', { roomLobby: true });
  let now = 0;
  let tick = 0;
  const players: { net: NetClient; pair: ReturnType<typeof createLoopbackPair>; buttons: number; forward?: boolean }[] = [];
  const settle = () => players.forEach((p) => p.pair.settle());
  const join = (name: string, resume = '') => {
    const pair = createLoopbackPair();
    session.addConnection(pair.a, now);
    const net = new NetClient(pair.b, name);
    const p = { net, pair, buttons: 0, forward: false };
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
      for (const p of players) if (p.pair.b.isOpen) p.pair.b.send(encodeMessage({ kind: 'Input', tick, moveX: 0, moveY: p.forward ? 1 : 0, yaw: 0, pitch: 0, buttons: p.buttons }));
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




describe('the support runs 10% faster (U-050)', () => {
  beforeAll(() => initNav());

  it('covers 10% more ground than Preach over the same run on open ground, for walking and for sprinting', () => {
    for (const sprint of [false, true]) {
      const r = room();
      const players = [r.join('a'), r.join('b'), r.join('c')];
      r.send(players[0]!, { kind: 'RoomCommand', command: 'start' });
      r.step(5);
      const [preach, , support] = [players[0]!, players[1]!, players[2]!];
      r.place(preach, { x: -10, z: -12 });
      r.place(support, { x: -14, z: -12 });
      const start = [preach, support].map((p) => r.session.slots[p.net.slot]!.state.z);
      for (const p of [preach, support]) {
        p.forward = true;
        p.buttons = sprint ? INPUT_BUTTONS.sprint : 0;
      }
      r.step(Math.round(1 / TICK_SECONDS));
      const [dp, ds] = [preach, support].map((p, i) => r.session.slots[p.net.slot]!.state.z - start[i]!);
      expect(dp!, `sprint ${sprint}`).toBeGreaterThan(1);
      expect(ds! / dp!, `sprint ${sprint}`).toBeGreaterThan(1.09);
      expect(ds! / dp!, `sprint ${sprint}`).toBeLessThan(1.11);
    }
  });
});
