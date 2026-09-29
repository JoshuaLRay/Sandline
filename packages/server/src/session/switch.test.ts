/**
 * U-026: a player takes control of a bot they command. On a real `Session`
 * with humans over loopback: the swap is atomic and keeps both soldiers as
 * they were; inputs drive the new one; command follows the player; another
 * player's bots, humans, one's own soldier, a missing slot, a held seat and a
 * stale or repeated request are refused; and a reconnect after a switch
 * comes back to the soldier the player was controlling.
 */
import { describe, expect, it } from 'vitest';
import {
  type Message,
  PROTOCOL_VERSION,
  TICK_SECONDS,
  createLoopbackPair,
  decodeMessage,
  encodeMessage,
} from '@sandline/shared';
import { Session, type SessionOptions } from './Session.ts';

const TICK_MS = TICK_SECONDS * 1000;

function room(options: SessionOptions = {}) {
  const session = new Session(undefined, '', 'range', options);
  let now = 0;
  const clients: { keepAlive(): void }[] = [];
  function join(name: string, resume = '') {
    const pair = createLoopbackPair();
    const messages: Message[] = [];
    pair.b.onMessage((bytes) => messages.push(decodeMessage(bytes)));
    session.addConnection(pair.a, now);
    const send = (msg: Message) => {
      pair.b.send(encodeMessage(msg));
      pair.settle();
    };
    send({ kind: 'Join', version: PROTOCOL_VERSION, name, room: '', ...(resume ? { resume } : {}) });
    const ack = messages.find((m): m is Extract<Message, { kind: 'JoinAck' }> => m.kind === 'JoinAck')!;
    let open = true;
    let tick = 0;
    const client = {
      ack,
      send,
      /** Every Possessed this client has been sent. */
      get possessed() {
        pair.settle();
        return messages.filter((m): m is Extract<Message, { kind: 'Possessed' }> => m.kind === 'Possessed');
      },
      /** The slot this client controls now: its seat, or the last soldier the host moved it into. */
      get slot() {
        return this.possessed.at(-1)?.slot ?? ack.slot;
      },
      switchTo(slot: number) {
        send({ kind: 'SwitchCharacter', slot });
      },
      spectate(slot: number) {
        send({ kind: 'SwitchCharacter', slot, spectate: true });
      },
      get spectating() {
        pair.settle();
        return messages.filter((m): m is Extract<Message, { kind: 'Spectating' }> => m.kind === 'Spectating');
      },
      assign(bot: number, commander: number) {
        send({ kind: 'AssignCommander', bot, commander });
      },
      /** Walk forward this tick (moveY 1), or stand. */
      input(moveY: number) {
        send({ kind: 'Input', tick: ++tick, moveX: 0, moveY, yaw: 0, pitch: 0, buttons: 0 });
      },
      drop() {
        pair.b.close('network lost');
        pair.settle();
        open = false;
      },
      keepAlive() {
        if (open) send({ kind: 'Ping', id: 1, clientTime: 0 });
      },
    };
    clients.push(client);
    return client;
  }
  const step = (ticks = 1, each?: () => void) => {
    for (let i = 0; i < ticks; i++) {
      now += TICK_MS;
      each?.();
      for (const c of clients) c.keepAlive();
      session.step(now);
    }
  };
  /** Exactly one slot holds each connection, and every human's slot has one. */
  const controllers = () => session.slots.filter((s) => !s.isBot).map((s) => s.index);
  const commanders = () => session.slots.map((s) => session.commanderOf(s.index));
  return { session, join, step, controllers, commanders };
}

/** What a soldier is, apart from who drives it. */
function soldier(session: Session, index: number) {
  const s = session.slots[index]!;
  return {
    netId: s.netId,
    x: s.state.x,
    z: s.state.z,
    health: s.health.current,
    weapon: s.weapon.id,
    ammo: s.weaponState.ammo,
    pouch: [...s.pouch],
    class: session.classOf(index),
  };
}

describe('taking control of a bot you command (U-026)', () => {
  it('spectates a human without controlling them; inputs cannot take over a human', () => {
    const r = room();
    const a = r.join('a');
    const b = r.join('b');
    a.spectate(b.slot);
    expect(a.spectating.at(-1)).toEqual({ kind: 'Spectating', slot: b.slot });
    expect(r.session.slots[a.slot]!.brain).not.toBeNull();
    r.step(15, () => a.input(1));
    expect(r.session.slots[a.slot]!.lastProcessedInputTick).toBe(-1);
    a.switchTo(b.slot);
    expect(a.possessed).toHaveLength(0);
    expect(r.controllers()).toEqual([0, 1]);
  });

  it('keeps command authority while watching and transfers a foreign bot on takeover', () => {
    const r = room();
    const a = r.join('a');
    const b = r.join('b');
    a.assign(3, b.slot);
    expect(r.commanders()[3]).toBe(b.slot);
    a.spectate(3);
    a.assign(4, b.slot);
    expect(r.commanders()[4]).toBe(b.slot);
    a.switchTo(4); // the spectator may only take the watched bot
    expect(a.possessed).toHaveLength(0);
    a.switchTo(3);
    expect(a.slot).toBe(3);
    expect(r.controllers()).toEqual([1, 3]);
    expect(r.commanders()[3]).toBe(-1);
    expect(r.commanders()[0]).toBe(3);
    a.input(1);
    r.step();
    expect(r.session.slots[3]!.lastProcessedInputTick).toBeGreaterThan(0);
  });

  it('all commands include the watched bot only when the spectator commands it', () => {
    const r = room();
    const a = r.join('a');
    const b = r.join('b');
    a.assign(3, b.slot);
    a.spectate(3);
    a.send({ kind: 'Order', order: 'hold', address: { to: 'all' }, point: null, target: null });
    expect(r.session.orderFor(3)).toBeNull();
    expect(r.session.orderFor(4)?.from).toBe(a.slot);
    b.spectate(4);
    b.send({ kind: 'Order', order: 'regroup', address: { to: 'all' }, point: null, target: null });
    expect(r.session.orderFor(3)?.from).toBe(b.slot);
    expect(r.session.orderFor(4)?.from).toBe(a.slot);
    a.assign(3, a.slot);
    a.send({ kind: 'Order', order: 'hold', address: { to: 'all' }, point: null, target: null });
    expect(r.session.orderFor(3)?.from).toBe(a.slot);
    expect(r.session.orderFor(1)).toBeNull();
  });

  it('solo with bots: one message swaps the controller and nothing else, and inputs drive the new soldier', () => {
    const r = room();
    const a = r.join('a');
    r.step(5);
    expect(a.slot).toBe(0);
    // The bot in slot 3 hurt, half a magazine down, a grenade gone.
    const bot = r.session.slots[3]!;
    bot.health.current = 55;
    bot.weaponState.ammo = 7;
    bot.pouch[0] = Math.max(0, (bot.pouch[0] ?? 0) - 1);
    const before3 = soldier(r.session, 3);
    const before0 = soldier(r.session, 0);

    a.switchTo(3);
    // Between two ticks, in one message: exactly one controller, in the new soldier.
    expect(r.controllers()).toEqual([3]);
    expect(r.session.slots[0]!.isBot).toBe(true);
    expect(r.session.slots[0]!.brain).not.toBeNull();
    expect(r.session.slots[3]!.brain).toBeNull();
    const told = a.possessed.at(-1)!;
    expect(told).toMatchObject({ netId: before3.netId, slot: 3, weapon: 0, ammo: 7, pouch: before3.pouch });
    expect(told.resume).not.toBe('');
    // Both soldiers are exactly as they were.
    expect(soldier(r.session, 3)).toEqual(before3);
    expect(soldier(r.session, 0)).toEqual(before0);
    // Command follows the player: every bot, and the soldier left behind, are slot 3's.
    expect(r.commanders()).toEqual([3, 3, 3, -1, 3, 3]);

    // The player's inputs now move slot 3; slot 0's bot does not walk off with them.
    r.step(30, () => a.input(1));
    expect(Math.hypot(r.session.slots[3]!.state.x - before3.x, r.session.slots[3]!.state.z - before3.z)).toBeGreaterThan(1);
    expect(Math.hypot(r.session.slots[0]!.state.x - before0.x, r.session.slots[0]!.state.z - before0.z)).toBeLessThan(0.1);
    expect(r.session.slots[3]!.lastProcessedInputTick).toBeGreaterThan(0);

    // And back again: the soldier left behind is still theirs to take.
    a.switchTo(0);
    expect(r.controllers()).toEqual([0]);
    expect(r.commanders()).toEqual([-1, 0, 0, 0, 0, 0]);
  });

  it('two humans: each may take only their own bots — never the other\'s, a human, their own soldier or no slot', () => {
    const r = room();
    const a = r.join('a');
    const b = r.join('b');
    expect([a.slot, b.slot]).toEqual([0, 1]);
    expect(r.commanders()).toEqual([-1, -1, 0, 0, 0, 0]);
    // B asks for A's bot: refused, and B is told nothing.
    b.switchTo(3);
    expect(b.possessed).toHaveLength(0);
    expect(r.controllers()).toEqual([0, 1]);
    // A hands B a bot; B may take it.
    a.assign(4, 1);
    b.switchTo(4);
    expect(b.slot).toBe(4);
    expect(r.controllers()).toEqual([0, 4]);
    expect(r.commanders()).toEqual([-1, 4, 0, 0, -1, 0]);
    // B's old soldier is B's bot now: A cannot take it, nor B (a human's slot), nor A itself, nor slot 7.
    const before = { controllers: r.controllers(), commanders: r.commanders() };
    a.switchTo(1);
    a.switchTo(4);
    a.switchTo(0);
    a.switchTo(7);
    expect(a.possessed).toHaveLength(0);
    expect({ controllers: r.controllers(), commanders: r.commanders() }).toEqual(before);
    // A stale request: A's bot reassigned away before A's switch arrives.
    a.assign(5, 4);
    a.switchTo(5);
    expect(a.possessed).toHaveLength(0);
    expect(r.controllers()).toEqual([0, 4]);
  });

  it('repeated and back-to-back requests resolve in order, with never two controllers', () => {
    const r = room();
    const a = r.join('a');
    a.switchTo(3);
    a.switchTo(3); // now its own soldier: refused
    expect(a.possessed.map((p) => p.slot)).toEqual([3]);
    a.switchTo(4);
    a.switchTo(5);
    expect(a.possessed.map((p) => p.slot)).toEqual([3, 4, 5]);
    expect(r.controllers()).toEqual([5]);
    expect(r.commanders()).toEqual([5, 5, 5, 5, 5, -1]);
  });

  it('a lobby room refuses a switch before its start', () => {
    const r = room({ roomLobby: true });
    const a = r.join('a');
    a.switchTo(3);
    expect(a.possessed).toHaveLength(0);
    expect(r.controllers()).toEqual([0]);
  });

  it('a dropped player comes back to the soldier they were controlling, and a seat held for another is not taken', () => {
    const r = room();
    const a = r.join('a');
    const b = r.join('b');
    a.switchTo(3);
    const told = a.possessed.at(-1)!;
    a.drop();
    expect(r.session.slots[3]!.isBot).toBe(true);
    r.step(30);
    // The token from before the switch no longer resumes anything: a fresh join at best.
    const stale = r.join('a', a.ack.resume);
    expect(stale.ack.resumed).toBe(false);
    stale.drop();
    // The token the switch handed out takes back slot 3, as it was.
    const back = r.join('a', told.resume);
    expect(back.ack).toMatchObject({ resumed: true, slot: 3, netId: told.netId });
    // B drops; its seat is held for it, so B's commander — A — may not take it meanwhile.
    b.drop();
    expect(r.session.commanderOf(1)).toBe(3);
    back.switchTo(1);
    expect(back.possessed).toHaveLength(0);
    expect(r.session.slots[1]!.isBot).toBe(true);
  });
});
