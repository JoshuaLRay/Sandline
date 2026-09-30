/**
 * Characters on the session (T-4.27, U-021): real `Session`s with a room
 * lobby, humans over loopback. A slot's character is fixed by the slot and
 * replicated; nobody picks one, so two players cannot share one; at the start
 * each slot carries its character's loadout and health, and an Equip outside
 * it is refused; the support has no sight and no pistol; the left-handed
 * sniper takes no gun off the ground; and an order reaches the squad or only
 * the giver's fireteam by the giver's character.
 */
import { describe, expect, it } from 'vitest';
import {
  RESUME,
  type BotOrder,
  ClientConnection,
  type Message,
  PROJECTILE_IDS,
  type RosterEntry,
  WEAPON_IDS,
  PROTOCOL_VERSION,
  createLoopbackPair,
  decodeMessage,
  encodeMessage,
} from '@sandline/shared';
import { type CampaignState, newCampaignState } from '../persistence/CampaignDatabase.ts';
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

describe('a seat held for a dropped player keeps its character and what it carries (U-024)', () => {
  /** A human over loopback, by raw messages: what the switch tests do (U-026). */
  function seat(session: Session, name: string, now: number, resume = '') {
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
    return { ack, send, drop: () => { pair.b.close('network lost'); pair.settle(); } };
  }

  it('a drop and a resume hand back no fresh pouch; a lapsed hold makes the seat a bot\'s like any other', () => {
    const session = new Session(undefined, '', 'range', { roomLobby: true });
    const a = seat(session, 'a', 0);
    // A second player stays, so the room is not paused (U-025) and its clock runs out the grace.
    seat(session, 'b', 0);
    const slot = a.ack.slot;
    a.send({ kind: 'RoomCommand', command: 'start' });
    expect(session.classOf(slot)).toBe('preach');
    // Preach's frags spent.
    session.slots[slot]!.pouch[FRAG] = 0;
    a.drop();
    // Held: still Preach's, with nothing handed back.
    expect(session.classOf(slot)).toBe('preach');
    expect(session.loadoutOf(slot).pouch[FRAG]).toBe(0);
    session.step(1000);
    expect(session.classOf(slot)).toBe('preach');
    // Back within the grace: the same seat, class and spent pouch.
    const back = seat(session, 'a', 1000, a.ack.resume);
    expect(back.ack).toMatchObject({ resumed: true, slot });
    expect(session.classOf(slot)).toBe('preach');
    expect(session.loadoutOf(slot).pouch[FRAG]).toBe(0);
    // Dropped again and never back: when the grace runs out the seat is a bot's, and still the slot's character.
    // (With nobody seated at all the room is paused, and a hold never runs out: U-025.)
    back.drop();
    session.step(1000 + RESUME.graceSeconds * 1000 + 100);
    // A character is the slot's: a bot plays the same one after the grace as before it.
    expect(session.classOf(slot)).toBe('preach');
  });
});

describe('characters on the session (T-4.27, U-021)', () => {
  const ROSTER = ['preach', 'brennan', 'holloway', 'ortiz', 'marsh', 'vance'];

  it('each slot is its character from the start, and joining, leaving and a stray pick change nothing', () => {
    const session = new Session(undefined, '', 'range', { roomLobby: true });
    expect([0, 1, 2, 3, 4, 5].map((i) => session.classOf(i))).toEqual(ROSTER);
    const a = human(session, 'a');
    const b = human(session, 'b');
    const c = human(session, 'c');
    expect([a.slot, b.slot, c.slot]).toEqual([0, 1, 2]);
    // Nobody picks a character: an old page's class command, or one naming a duplicate or a stranger, is ignored.
    for (const who of [a, b, c]) who.send({ kind: 'RoomCommand', command: 'class', classId: 'vance' });
    a.send({ kind: 'RoomCommand', command: 'class', classId: 'medic' });
    expect([0, 1, 2, 3, 4, 5].map((i) => session.classOf(i))).toEqual(ROSTER);
    // The roster and the room replicate them; each character appears exactly once.
    expect(a.roster?.map((r) => r.classId)).toEqual(ROSTER);
    expect(c.room?.classes).toEqual(ROSTER);
    expect(new Set(c.room?.classes).size).toBe(6);
  });

  it('a human seated in a slot plays that slot\'s character, with its loadout untouched', () => {
    const session = new Session(undefined, '', 'range', { roomLobby: true });
    const before = session.loadoutOf(0);
    const a = human(session, 'a');
    expect(session.classOf(a.slot)).toBe('preach');
    expect(session.loadoutOf(a.slot)).toEqual(before);
  });

  it('each slot carries its character\'s loadout and health, and an Equip outside the loadout is refused', () => {
    const session = new Session(undefined, '', 'range', { roomLobby: true });
    const a = human(session, 'a');
    a.send({ kind: 'RoomCommand', command: 'start' });
    expect(session.started).toBe(true);
    expect(session.loadoutOf(0)).toMatchObject({ weapon: 'carbine', health: 100, maxHealth: 100 });
    expect(session.loadoutOf(0).pouch[FRAG]).toBe(2);
    expect(session.loadoutOf(0).pouch[ROCKET]).toBe(1);
    expect(session.loadoutOf(1)).toMatchObject({ weapon: 'lmg', maxHealth: 100 });
    expect(session.loadoutOf(1).pouch[ROCKET]).toBe(1);
    expect(session.loadoutOf(2)).toMatchObject({ weapon: 'smg', maxHealth: 90 });
    expect(session.loadoutOf(3)).toMatchObject({ weapon: 'carbine-scoped' });
    expect(session.loadoutOf(4)).toMatchObject({ weapon: 'sniper-bolt-left', maxHealth: 90 });
    expect(session.loadoutOf(5)).toMatchObject({ weapon: 'sniper-semi', maxHealth: 90 });
    // Preach has the carbine and the sidearm, and nothing else.
    a.send({ kind: 'Equip', item: gun('marksman') });
    expect(session.loadoutOf(0).weapon).toBe('carbine');
    a.send({ kind: 'Equip', item: gun('sidearm') });
    expect(session.loadoutOf(0).weapon).toBe('sidearm');
    // Not while downed, and not when dead.
    session.slots[0]!.health.downedAt = 0;
    a.send({ kind: 'Equip', item: gun('carbine') });
    expect(session.loadoutOf(0).weapon).toBe('sidearm');
    session.slots[0]!.health.downedAt = null;
    session.slots[0]!.health.diedAt = 1;
    a.send({ kind: 'Equip', item: gun('carbine') });
    expect(session.loadoutOf(0).weapon).toBe('sidearm');
  });

  it('the support has an SMG and a shotgun, no pistol, and no sight (U-021)', () => {
    const session = new Session(undefined, '', 'range', { roomLobby: true });
    const a = human(session, 'a');
    const b = human(session, 'b');
    const c = human(session, 'c');
    expect(c.slot).toBe(2);
    a.send({ kind: 'RoomCommand', command: 'start' });
    b.send({ kind: 'Equip', item: gun('carbine') });
    c.send({ kind: 'Equip', item: gun('sidearm') });
    expect(session.loadoutOf(2).weapon).toBe('smg');
    c.send({ kind: 'Equip', item: gun('breacher') });
    expect(session.loadoutOf(2).weapon).toBe('breacher');
    c.send({ kind: 'Equip', item: gun('marksman') });
    expect(session.loadoutOf(2).weapon).toBe('breacher');
    // The host does not take a sight from the support whatever its page says; everyone else keeps theirs.
    const may = (slot: number) => (session as unknown as { mayAim(s: unknown): boolean }).mayAim(session.slots[slot]);
    expect([0, 1, 2, 3, 4, 5].map(may)).toEqual([true, true, false, true, true, true]);
  });

  it('a free session keeps every gun for every slot, and the sight', () => {
    const session = new Session(undefined, '', 'range');
    const a = human(session, 'a');
    expect(session.classOf(0)).toBe('preach');
    a.send({ kind: 'Equip', item: gun('marksman') });
    expect(session.loadoutOf(0).weapon).toBe('marksman');
    expect(session.loadoutOf(0).maxHealth).toBe(100);
    expect((session as unknown as { mayAim(s: unknown): boolean }).mayAim(session.slots[2])).toBe(true);
  });

  it('an order reaches the squad from the assault team, and only the giver\'s fireteam from the overwatch team', () => {
    const session = new Session(undefined, '', 'range', { roomLobby: true });
    const humans = [0, 1, 2, 3].map((i) => human(session, `p${i}`));
    expect(humans.map((h) => h.slot)).toEqual([0, 1, 2, 3]);
    humans[0]!.send({ kind: 'RoomCommand', command: 'start' });
    // Ortiz (overwatch lead) orders everyone: only their own fireteam's bots take it.
    session.orderFrom(3, { order: 'move', address: { to: 'all' }, point: { x: 1, y: 0, z: 1 }, target: null });
    settleAll();
    expect(humans[3]!.orders?.map((o) => o.slot).sort()).toEqual([4, 5]);
    // Preach orders everyone: every bot takes it.
    session.orderFrom(0, { order: 'move', address: { to: 'all' }, point: { x: 2, y: 0, z: 2 }, target: null });
    settleAll();
    expect(humans[0]!.orders?.map((o) => o.slot).sort()).toEqual([4, 5]);
    // Ortiz addressing the other fireteam directly is refused too.
    session.orderFrom(3, { order: 'move', address: { to: 'fireteam', index: 0 }, point: { x: 3, y: 0, z: 3 }, target: null });
    settleAll();
    expect(humans[3]!.orders?.find((o) => o.slot === 4)?.point).toEqual({ x: 2, y: 0, z: 2 });
  });

  it('the left-handed sniper takes no gun off the ground, and a gun put down is never lost (U-021)', () => {
    const session = new Session(undefined, '', 'range', { roomLobby: true });
    const internals = session as unknown as {
      placePickup(id: string, ammo: number, at: { x: number; y: number; z: number }, yaw: number): void;
      takePickupAt(slot: unknown): boolean;
    };
    const marsh = session.slots[4]!;
    internals.placePickup('carbine', 10, marsh.state, 0);
    expect(internals.takePickupAt(marsh)).toBe(false);
    expect(session.loadoutOf(4).primary).toBe('sniper-bolt-left');
    expect(session.pickups).toHaveLength(1);
    // Brennan swaps his LMG for it: the LMG goes down where he stood rather than vanishing.
    const brennan = session.slots[1]!;
    brennan.state = { ...brennan.state, x: marsh.state.x, y: marsh.state.y, z: marsh.state.z };
    expect(internals.takePickupAt(brennan)).toBe(true);
    expect(session.loadoutOf(1).primary).toBe('carbine');
    expect(session.pickups.map((p) => WEAPON_IDS[p.weapon])).toEqual(['lmg']);
  });

  it('an older save (Team Leader / Marksman ids) loads, keeps every slot\'s rank and XP, and is written back with the characters (U-021)', () => {
    const old = newCampaignState('range');
    old.soldiers = old.soldiers.map((soldier) => ({ ...soldier, classId: soldier.slot < 3 ? 'team-leader' : 'marksman' }));
    // Rank is derived from XP by the progression table, so the fixture says what the table does (740 XP is rank 1, 120 is 0).
    old.soldiers[2] = { slot: 2, classId: 'team-leader', rank: 1, xp: 740 };
    old.soldiers[4] = { slot: 4, classId: 'marksman', rank: 0, xp: 120 };
    const saves: CampaignState[] = [];
    const session = new Session(undefined, '', 'range', { roomLobby: true, campaign: old, onCampaignSave: (state) => saves.push(state) });
    // The characters are the slots' whatever the save said.
    expect([0, 1, 2, 3, 4, 5].map((i) => session.classOf(i))).toEqual(ROSTER);
    (session as unknown as { persistCampaign(): void }).persistCampaign();
    const written = saves.at(-1)!;
    expect(written.soldiers.map((soldier) => soldier.classId)).toEqual(ROSTER);
    // Progress belongs to the slot and is carried across untouched.
    expect(written.soldiers.map(({ rank, xp }) => ({ rank, xp }))).toEqual(old.soldiers.map(({ rank, xp }) => ({ rank, xp })));
    expect(written.soldiers[2]).toEqual({ slot: 2, classId: 'holloway', rank: 1, xp: 740 });
  });
});
