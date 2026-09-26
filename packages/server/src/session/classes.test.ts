/**
 * Classes on the session (T-4.27): real `Session`s with a room lobby,
 * humans over loopback. A pick in the room stands and is replicated; a bot
 * fills the class the squad is required to have; at the start each slot
 * carries its class's loadout and health, and an Equip outside it is
 * refused; and an order reaches the squad or only the giver's fireteam by
 * the giver's class.
 */
import { describe, expect, it } from 'vitest';
import {
  type BotOrder,
  ClientConnection,
  type Message,
  PROJECTILE_IDS,
  type RosterEntry,
  WEAPON_IDS,
  createLoopbackPair,
} from '@sandline/shared';
import { Session } from './Session.ts';

const links: (() => void)[] = [];
const settleAll = () => {
  links.forEach((settle) => settle());
  links.forEach((settle) => settle());
};

function human(session: Session, name: string) {
  const pair = createLoopbackPair();
  links.push(() => pair.settle());
  session.addConnection(pair.a, 0);
  let slot = -1;
  let orders: readonly BotOrder[] | null = null;
  let roster: readonly RosterEntry[] | null = null;
  let room: Extract<Message, { kind: 'RoomState' }> | null = null;
  const client = new ClientConnection(pair.b, {
    onJoinAck: (_netId, s) => {
      slot = s;
    },
    onOrders: (o) => {
      orders = o;
    },
    onRoster: (r) => {
      roster = r;
    },
    onRoomState: (state) => {
      room = state;
    },
  });
  client.join(name);
  settleAll();
  return {
    get slot() {
      return slot;
    },
    get orders() {
      return orders as readonly BotOrder[] | null;
    },
    get roster() {
      return roster as readonly RosterEntry[] | null;
    },
    get room() {
      return room as Extract<Message, { kind: 'RoomState' }> | null;
    },
    send(msg: Message) {
      client.send(msg);
      settleAll();
    },
  };
}

const gun = (id: string) => (WEAPON_IDS as readonly string[]).indexOf(id);
const FRAG = PROJECTILE_IDS.indexOf('frag');
const ROCKET = PROJECTILE_IDS.indexOf('rocket');

describe('classes on the session (T-4.27)', () => {
  it('a pick stands and is replicated, a bot fills the leader the humans left out, and the defaults return', () => {
    const session = new Session(undefined, '', 'range', { roomLobby: true });
    // Bots from the start: the assault fireteam leads, overwatch watches.
    expect([0, 1, 2, 3, 4, 5].map((i) => session.classOf(i))).toEqual(['team-leader', 'team-leader', 'team-leader', 'marksman', 'marksman', 'marksman']);
    const a = human(session, 'a');
    const b = human(session, 'b');
    const c = human(session, 'c');
    expect([a.slot, b.slot, c.slot]).toEqual([0, 1, 2]);
    for (const who of [a, b, c]) who.send({ kind: 'RoomCommand', command: 'class', classId: 'marksman' });
    // Nobody leads: the first bot, in overwatch, does.
    expect([0, 1, 2, 3, 4, 5].map((i) => session.classOf(i))).toEqual(['marksman', 'marksman', 'marksman', 'team-leader', 'marksman', 'marksman']);
    expect(a.roster?.map((r) => r.classId)).toEqual(['marksman', 'marksman', 'marksman', 'team-leader', 'marksman', 'marksman']);
    expect(c.room?.classes).toEqual(['marksman', 'marksman', 'marksman', 'team-leader', 'marksman', 'marksman']);
    // One of them takes the lead back: the bot returns to its default.
    b.send({ kind: 'RoomCommand', command: 'class', classId: 'team-leader' });
    expect(session.classOf(1)).toBe('team-leader');
    expect(session.classOf(3)).toBe('marksman');
    // A pick the data does not know is no pick: the slot's default.
    a.send({ kind: 'RoomCommand', command: 'class', classId: 'medic' });
    expect(session.classOf(0)).toBe('team-leader');
  });

  it('each slot carries its class\'s loadout and health, and an Equip outside the loadout is refused', () => {
    const session = new Session(undefined, '', 'range', { roomLobby: true });
    const a = human(session, 'a');
    a.send({ kind: 'RoomCommand', command: 'class', classId: 'marksman' });
    a.send({ kind: 'RoomCommand', command: 'start' });
    expect(session.started).toBe(true);
    const marksman = session.loadoutOf(0);
    expect(marksman.weapon).toBe('marksman');
    expect(marksman.pouch[FRAG]).toBe(1);
    expect(marksman.pouch[ROCKET]).toBe(0);
    expect(marksman).toMatchObject({ health: 90, maxHealth: 90 });
    const leader = session.loadoutOf(1);
    expect(leader.weapon).toBe('carbine');
    expect(leader.pouch[FRAG]).toBe(2);
    expect(leader.pouch[ROCKET]).toBe(1);
    expect(leader).toMatchObject({ health: 100, maxHealth: 100 });
    // The carbine is not the Marksman's; the sidearm is.
    a.send({ kind: 'Equip', item: gun('carbine') });
    expect(session.loadoutOf(0).weapon).toBe('marksman');
    a.send({ kind: 'Equip', item: gun('sidearm') });
    expect(session.loadoutOf(0).weapon).toBe('sidearm');
    a.send({ kind: 'Equip', item: gun('breacher') });
    expect(session.loadoutOf(0).weapon).toBe('sidearm');
  });

  it('a free session keeps every gun for every slot', () => {
    const session = new Session(undefined, '', 'range');
    const a = human(session, 'a');
    expect(session.classOf(0)).toBe('team-leader');
    a.send({ kind: 'Equip', item: gun('marksman') });
    expect(session.loadoutOf(0).weapon).toBe('marksman');
    expect(session.loadoutOf(0).maxHealth).toBe(100);
  });

  it('a Team Leader\'s order reaches the squad; a Marksman\'s only their own fireteam', () => {
    const session = new Session(undefined, '', 'range', { roomLobby: true });
    const a = human(session, 'a');
    const b = human(session, 'b');
    expect([a.slot, b.slot]).toEqual([0, 1]);
    a.send({ kind: 'RoomCommand', command: 'class', classId: 'marksman' });
    b.send({ kind: 'RoomCommand', command: 'class', classId: 'team-leader' });
    a.send({ kind: 'RoomCommand', command: 'start' });
    // The marksman in the assault fireteam orders everyone: only its own fireteam's bot takes it.
    session.orderFrom(0, { order: 'move', address: { to: 'all' }, point: { x: 1, y: 0, z: 1 }, target: null });
    settleAll();
    expect(a.orders?.map((o) => o.slot).sort()).toEqual([2]);
    // The leader orders everyone: every bot takes it.
    session.orderFrom(1, { order: 'move', address: { to: 'all' }, point: { x: 2, y: 0, z: 2 }, target: null });
    settleAll();
    expect(b.orders?.map((o) => o.slot).sort()).toEqual([2, 3, 4, 5]);
    // The marksman addressing the other fireteam directly is refused too.
    session.orderFrom(0, { order: 'move', address: { to: 'fireteam', index: 1 }, point: { x: 3, y: 0, z: 3 }, target: null });
    settleAll();
    expect(a.orders?.find((o) => o.slot === 4)?.point).toEqual({ x: 2, y: 0, z: 2 });
  });
});
