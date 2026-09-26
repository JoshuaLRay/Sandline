/**
 * U-025: every bot has a human in command of it. On a real `Session` with
 * humans over loopback — the path the host's rooms and the in-page session
 * share — from campaign start through reassignment, refused requests,
 * commanders leaving and coming back, and the pause while nobody is seated;
 * and on the wire, the roster each client is sent.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_SLOTS,
  type Message,
  PROTOCOL_VERSION,
  type RosterEntry,
  TICK_SECONDS,
  createLoopbackPair,
  decodeMessage,
  encodeMessage,
} from '@sandline/shared';
import { Session, type SessionOptions } from './Session.ts';

const TICK_MS = TICK_SECONDS * 1000;

/** A clock the session and every client share: `step` advances it a tick at a time. */
function room(options: SessionOptions = {}) {
  const session = new Session(undefined, '', 'range', options);
  let now = 0;
  const clients: { keepAlive(): void }[] = [];
  /** A human joining over loopback; with `resume`, reclaiming a dropped seat (T-4.18). */
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
    const client = {
      name,
      slot: ack.slot,
      resume: ack.resume,
      send,
      /** How many rosters this client has been sent. */
      get rosters(): number {
        pair.settle();
        return messages.filter((m) => m.kind === 'Roster').length;
      },
      /** The latest roster this client was sent. */
      get roster(): readonly RosterEntry[] {
        pair.settle();
        return messages.filter((m): m is Extract<Message, { kind: 'Roster' }> => m.kind === 'Roster').at(-1)!.slots;
      },
      assign(bot: number, commander: number) {
        send({ kind: 'AssignCommander', bot, commander });
      },
      /** A goodbye: the seat is anyone's. */
      leave() {
        send({ kind: 'Disconnect', code: 'left', reason: 'left' });
        open = false;
      },
      /** A dropped socket: the seat is kept for the grace (T-4.18). */
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
  const step = (ticks = 1) => {
    for (let i = 0; i < ticks; i++) {
      now += TICK_MS;
      for (const c of clients) c.keepAlive();
      session.step(now);
    }
  };
  /** Every bot under a seated human, or — nobody seated — under nobody. */
  const invariant = () => {
    const humans = session.slots.filter((s) => !s.isBot).map((s) => s.index);
    for (const slot of session.slots) {
      const commander = session.commanderOf(slot.index);
      if (!slot.isBot || humans.length === 0) expect(commander).toBe(-1);
      else expect(humans, `bot ${slot.index} under ${commander}`).toContain(commander);
    }
  };
  const commanders = () => session.slots.map((s) => session.commanderOf(s.index));
  return { session, join, step, invariant, commanders, get now() { return now; } };
}

describe('bot commanders (U-025)', () => {
  it('a first human seated commands every bot, and every client is told on the roster', () => {
    const r = room();
    expect(r.commanders()).toEqual([-1, -1, -1, -1, -1, -1]);
    const a = r.join('a');
    expect(a.slot).toBe(0);
    expect(r.commanders()).toEqual([-1, 0, 0, 0, 0, 0]);
    expect(a.roster.map((e) => e.commander)).toEqual([-1, 0, 0, 0, 0, 0]);
    const b = r.join('b');
    // A newcomer takes a bot's seat; the other bots stay where they were.
    expect(b.slot).toBe(1);
    expect(r.commanders()).toEqual([-1, -1, 0, 0, 0, 0]);
    expect(b.roster.map((e) => e.commander)).toEqual([-1, -1, 0, 0, 0, 0]);
    expect(a.roster.map((e) => e.commander)).toEqual([-1, -1, 0, 0, 0, 0]);
    r.invariant();
  });

  it('at a lobby room\'s start every bot is under the lowest-numbered human, and nothing is assigned before it', () => {
    const r = room({ roomLobby: true });
    const a = r.join('a');
    const b = r.join('b');
    expect([a.slot, b.slot]).toEqual([0, 1]);
    // In the lobby: refused, and the asker is sent the roster as it stands.
    b.assign(3, 1);
    expect(r.commanders()[3]).toBe(0);
    a.send({ kind: 'RoomCommand', command: 'ready', ready: true });
    b.send({ kind: 'RoomCommand', command: 'ready', ready: true });
    expect(r.session.started).toBe(true);
    expect(r.commanders()).toEqual([-1, -1, 0, 0, 0, 0]);
    expect(b.roster.map((e) => e.commander)).toEqual([-1, -1, 0, 0, 0, 0]);
    r.invariant();
  });

  it('any human puts any bot under any human, themselves included, and everyone sees it', () => {
    const r = room();
    const a = r.join('a');
    const b = r.join('b');
    b.assign(3, 1);
    a.assign(4, 1);
    a.assign(5, 0);
    expect(r.commanders()).toEqual([-1, -1, 0, 1, 1, 0]);
    expect(a.roster.map((e) => e.commander)).toEqual([-1, -1, 0, 1, 1, 0]);
    expect(b.roster.map((e) => e.commander)).toEqual([-1, -1, 0, 1, 1, 0]);
    // Assignments hold while the campaign runs.
    r.step(90);
    expect(r.commanders()).toEqual([-1, -1, 0, 1, 1, 0]);
    r.invariant();
  });

  it('refuses a human\'s slot, a bot as commander, a slot that does not exist, a dropped player, and a stranger', () => {
    const r = room();
    const a = r.join('a');
    const b = r.join('b');
    const c = r.join('c');
    const before = r.commanders();
    const sentBefore = a.rosters;
    const othersBefore = b.rosters;
    a.assign(1, 0); // slot 1 is b, a human
    a.assign(3, 4); // slot 4 is a bot
    a.assign(3, 7); // no slot 7 (three bits carry it)
    a.assign(7, 0); // no slot 7
    expect(r.commanders()).toEqual(before);
    // Each refusal answers the asker, and only the asker, with the roster as it stands.
    expect(a.rosters - sentBefore).toBe(4);
    expect(b.rosters - othersBefore).toBe(0);
    expect(a.roster).toHaveLength(MAX_SLOTS);
    // c drops: its seat is held for the grace, but it is a bot's until then, and nobody's to command.
    c.drop();
    expect(r.session.slots[2]!.isBot).toBe(true);
    a.assign(4, 2);
    expect(r.commanders()[4]).not.toBe(2);
    // A connection that never took a seat asks nothing of anyone.
    const pair = createLoopbackPair();
    r.session.addConnection(pair.a, r.now);
    pair.b.send(encodeMessage({ kind: 'AssignCommander', bot: 3, commander: 1 }));
    pair.settle();
    expect(r.commanders()[3]).toBe(0);
    expect(b.slot).toBe(1);
    r.invariant();
  });

  it('a commander leaving hands their bots, and their own seat, to the lowest-numbered human left', () => {
    const r = room();
    const a = r.join('a');
    const b = r.join('b');
    const c = r.join('c');
    expect([a.slot, b.slot, c.slot]).toEqual([0, 1, 2]);
    a.assign(3, 2);
    a.assign(4, 2);
    a.assign(5, 1);
    expect(r.commanders()).toEqual([-1, -1, -1, 2, 2, 1]);
    c.leave();
    // c's bots and c's own soldier go to slot 0, the lowest human left; b keeps its bot.
    expect(r.commanders()).toEqual([-1, -1, 0, 0, 0, 1]);
    expect(b.roster.map((e) => e.commander)).toEqual([-1, -1, 0, 0, 0, 1]);
    a.leave();
    expect(r.commanders()).toEqual([1, -1, 1, 1, 1, 1]);
    expect(b.roster.map((e) => e.commander)).toEqual([1, -1, 1, 1, 1, 1]);
    r.invariant();
  });

  it('with nobody seated the session stops — no tick, no movement, no timers — and a returning human takes every bot', () => {
    const r = room();
    const a = r.join('a');
    r.step(30);
    // A bot walking, and a bot bleeding out.
    const walker = r.session.slots[3]!;
    const downed = r.session.slots[4]!;
    Object.assign(downed.health, { current: 0, downedAt: r.now / 1000 });
    const tick = r.session.tick;
    const where = { ...walker.state };
    a.leave();
    expect(r.session.paused).toBe(true);
    expect(r.commanders()).toEqual([-1, -1, -1, -1, -1, -1]);
    // A long time with nobody here: longer than any bleed-out.
    r.step(30 * 120);
    expect(r.session.tick).toBe(tick);
    expect(walker.state).toEqual(where);
    expect(downed.health.diedAt).toBeNull();
    const b = r.join('b');
    expect(r.session.paused).toBe(false);
    expect(b.slot).toBe(0);
    expect(r.commanders()).toEqual([-1, 0, 0, 0, 0, 0]);
    // The clock goes on from where it stopped, not from the wall's.
    r.step(1);
    expect(r.session.tick).toBe(tick + 1);
    expect(downed.health.diedAt).toBeNull();
    r.invariant();
  });

  it('a session nobody has been seated in runs on (the headless scenarios, and a room before anyone arrives)', () => {
    const r = room();
    r.step(10);
    expect(r.session.paused).toBe(false);
    expect(r.session.tick).toBe(10);
  });

  it('a dropped commander who comes back within the grace takes back their soldier; their bots stay with whoever took them', () => {
    const r = room();
    const a = r.join('a');
    const b = r.join('b');
    a.assign(3, 1);
    b.drop();
    expect(r.commanders()).toEqual([-1, 0, 0, 0, 0, 0]);
    r.step(30);
    const back = r.join('b', b.resume);
    expect(back.slot).toBe(1);
    expect(r.commanders()).toEqual([-1, -1, 0, 0, 0, 0]);
    expect(back.roster.map((e) => e.commander)).toEqual([-1, -1, 0, 0, 0, 0]);
    r.invariant();
  });
});
