/**
 * U-153: squad stance orders. A player holds a soldier, a fireteam or the
 * whole squad in Auto, Crouch or Prone; bots keep that stance while they hold,
 * move and fire, rise only to vault, revive, heal or interact, and Auto is the
 * bot's own choice, as before. A setting of the character's, like aggression
 * (U-101): it never moves a human and stays with the slot through leave,
 * rejoin, switch, reconnect and retry. On real `Session`s over loopback, the
 * range's navmesh and cover and the friendly tree in every bot slot.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG,
  type Message,
  type MissionDef,
  PROTOCOL_VERSION,
  STANCE_KINDS,
  type SquadStance,
  TICK_SECONDS,
  buildTree,
  createLoopbackPair,
  createMoveState,
  decodeMessage,
  encodeMessage,
  parseEncounter,
  parseTreeDef,
  requireWorld,
} from '@sandline/shared';
import { type BrainMemory, type BrainTree, createBrainRegistry } from '../ai/Brain.ts';
import { type NavMesh, initNav } from '../ai/nav/NavMesh.ts';
import { bakedCoverFor, loadWorldNavMesh } from '../ai/nav/bakedNav.ts';
import { Session, type SessionOptions } from './Session.ts';

const TICK_MS = TICK_SECONDS * 1000;
/** Where the human lead stands: far off in a corner, out of every test's way. */
const LEAD_AT = { x: 40, z: -40 };

let mesh: NavMesh;
beforeAll(async () => {
  await initNav();
  mesh = loadWorldNavMesh('range');
});

/** A session, the lead seated in slot 0, the bots where `at` puts them; more players may join. */
function squad(at: Record<number, { x: number; z: number }> = {}, options: SessionOptions = {}, world = 'range') {
  // The range comes with its bake and the friendly tree; another world plays as its options say.
  const base: SessionOptions = world === 'range' ? { navMesh: mesh, cover: bakedCoverFor('range'), brainTree: buildTree('friendly', createBrainRegistry()) } : {};
  const session = new Session(undefined, '', world === 'range' ? 'range' : requireWorld(world), { ...base, ...options });
  let now = 0;
  const seats: { stand(): void }[] = [];
  function join(name: string, resume = '') {
    const pair = createLoopbackPair();
    const messages: Message[] = [];
    pair.b.onMessage((bytes) => messages.push(decodeMessage(bytes)));
    session.addConnection(pair.a, now);
    const say = (msg: Message) => {
      pair.b.send(encodeMessage(msg));
      pair.settle();
    };
    say({ kind: 'Join', version: PROTOCOL_VERSION, name, room: '', ...(resume ? { resume } : {}) });
    const ack = messages.find((m): m is Extract<Message, { kind: 'JoinAck' }> => m.kind === 'JoinAck')!;
    let open = true;
    let tick = 0;
    const seat = {
      ack,
      say,
      /** Stand still this tick, as a person with hands off the keys. */
      stand() {
        if (open) say({ kind: 'Input', tick: ++tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0 });
      },
      drop() {
        pair.b.close('network lost');
        pair.settle();
        open = false;
      },
      /** The stances the host last sent this player. */
      get stances(): readonly SquadStance[] | undefined {
        pair.settle();
        return messages.filter((m): m is Extract<Message, { kind: 'Stances' }> => m.kind === 'Stances').at(-1)?.stances;
      },
      get possessed() {
        pair.settle();
        return messages.filter((m): m is Extract<Message, { kind: 'Possessed' }> => m.kind === 'Possessed');
      },
    };
    seats.push(seat);
    return seat;
  }
  const lead = join('lead');
  session.slots.forEach((s, i) => {
    const p = i === 0 ? LEAD_AT : (at[i] ?? { x: LEAD_AT.x - 2 - i, z: LEAD_AT.z - 2 });
    s.state = createMoveState(p.x, 0, p.z);
  });
  return {
    session,
    lead,
    join,
    /** Step `ticks`, every seated player standing, `each` after every step. */
    run(ticks: number, each?: (t: number) => void) {
      for (let t = 0; t < ticks; t++) {
        for (const seat of seats) seat.stand();
        now += TICK_MS;
        session.step(now);
        each?.(t);
      }
    },
  };
}

const stance = (address: Extract<Message, { kind: 'Stance' }>['address'], to: SquadStance): Message => ({ kind: 'Stance', address, stance: to });
const posture = (state: { crouched: boolean; prone: boolean }): string => (state.prone ? 'prone' : state.crouched ? 'crouch' : 'standing');

/** An enemy whose one leaf fires at `netId` every think. */
function firingAt(netId: number): BrainTree {
  const registry = createBrainRegistry().action('want', ({ blackboard }) => {
    blackboard.set('fireAt' as keyof BrainMemory, netId as never);
    return 'running';
  });
  return buildTree(parseTreeDef({ id: 'test-fire', root: { type: 'action', name: 'want' } }), registry);
}

describe('the stance wire (U-153)', () => {
  it('round-trips each stance to each addressee and the whole squad’s settings, and rejects what is not one', () => {
    expect(PROTOCOL_VERSION).toBe(70);
    for (const to of STANCE_KINDS) {
      for (const address of [{ to: 'slot', index: 5 }, { to: 'fireteam', index: 1 }, { to: 'all' }] as const) {
        const command: Message = { kind: 'Stance', address, stance: to };
        expect(decodeMessage(encodeMessage(command))).toEqual(command);
      }
    }
    const state: Message = { kind: 'Stances', stances: ['auto', 'crouch', 'prone', 'prone', 'crouch', 'auto'] };
    expect(decodeMessage(encodeMessage(state))).toEqual(state);
    expect(() => decodeMessage(encodeMessage({ kind: 'Stance', address: { to: 'all' }, stance: 'kneel' } as unknown as Message))).toThrow();
    expect(() => encodeMessage({ kind: 'Stances', stances: ['auto'] })).toThrow();
  });
});

describe('who may set a stance (U-153)', () => {
  it('synchronizes settings, refuses another commander’s bots, and stores a human’s own for when a bot has it', () => {
    const sq = squad();
    const second = sq.join('second');
    expect(second.ack.slot).toBe(1);
    sq.lead.say({ kind: 'AssignCommander', bot: 5, commander: 1 });
    // The lead no longer commands slot 5, and slot 1 is a person.
    sq.lead.say(stance({ to: 'slot', index: 5 }, 'prone'));
    sq.lead.say(stance({ to: 'slot', index: 1 }, 'prone'));
    expect([sq.session.stanceFor(5), sq.session.stanceFor(1)]).toEqual(['auto', 'auto']);
    sq.lead.say(stance({ to: 'fireteam', index: 0 }, 'crouch'));
    expect(sq.session.slots.map((s) => sq.session.stanceFor(s.index))).toEqual(['crouch', 'auto', 'crouch', 'auto', 'auto', 'auto']);
    second.say(stance({ to: 'all' }, 'prone'));
    expect(sq.session.slots.map((s) => sq.session.stanceFor(s.index))).toEqual(['crouch', 'prone', 'crouch', 'auto', 'auto', 'prone']);
    const late = sq.join('late');
    expect(late.stances).toEqual(sq.session.slots.map((s) => sq.session.stanceFor(s.index)));
    expect(sq.lead.stances).toEqual(second.stances);
  });
});

describe('a bot held in a stance (U-153)', () => {
  it('stays prone holding under fire, and fires back from the ground', () => {
    const sq = squad({ 1: { x: 16, z: 0 } });
    const { session } = sq;
    const bot = session.slots[1]!;
    const foe = session.spawnEnemy('rifleman', { x: 16, y: 0, z: -18, yaw: 0, tree: firingAt(bot.netId) })!;
    sq.lead.say({ kind: 'Order', order: 'hold', address: { to: 'slot', index: 1 }, point: null, target: null });
    sq.lead.say(stance({ to: 'slot', index: 1 }, 'prone'));
    const from = bot.weaponState.shotIndex;
    const seen = new Set<string>();
    let furthest = 0;
    sq.run(30 * 10, (t) => {
      Object.assign(bot.health, { current: 100, downedAt: null, diedAt: null });
      Object.assign(session.enemies.find((e) => e.netId === foe)!.health, { current: 100, downedAt: null, diedAt: null });
      if (t >= 2) seen.add(posture(bot.state));
      furthest = Math.max(furthest, Math.hypot(bot.state.x - 16, bot.state.z));
    });
    console.log(`prone hold: ${[...seen].join('/')}, strayed ${furthest.toFixed(2)} m, fired ${bot.weaponState.shotIndex - from} rounds`);
    expect([...seen]).toEqual(['prone']);
    expect(furthest).toBeLessThan(0.6);
    expect(bot.weaponState.shotIndex - from).toBeGreaterThan(0);
    expect(session.orderFor(1)?.order).toBe('hold');
  });

  it('crawls a move order at prone speed and arrives; held in Crouch it walks it crouched', () => {
    for (const held of ['prone', 'crouch'] as const) {
      const sq = squad({ 1: { x: 0, z: -8 } });
      const { session } = sq;
      const bot = session.slots[1]!;
      sq.lead.say(stance({ to: 'slot', index: 1 }, held));
      sq.run(3);
      const point = { x: 5, y: 0, z: -8 };
      sq.lead.say({ kind: 'Order', order: 'move', address: { to: 'slot', index: 1 }, point, target: null });
      const speed = held === 'prone' ? DEFAULT_MOVE_CONFIG.proneSpeed : DEFAULT_MOVE_CONFIG.crouchSpeed;
      const seen = new Set<string>();
      let fastest = 0;
      let doneAt: number | null = null;
      sq.run(30 * 10, (t) => {
        seen.add(posture(bot.state));
        if (doneAt === null && session.orderReports.some((r) => r.slot === 1 && r.outcome === 'done')) doneAt = t;
      });
      let last = { x: bot.state.x, z: bot.state.z };
      sq.lead.say({ kind: 'Order', order: 'move', address: { to: 'slot', index: 1 }, point: { x: 0, y: 0, z: -8 }, target: null });
      sq.run(30 * 2, () => {
        fastest = Math.max(fastest, Math.hypot(bot.state.x - last.x, bot.state.z - last.z) / TICK_SECONDS);
        last = { x: bot.state.x, z: bot.state.z };
        seen.add(posture(bot.state));
      });
      console.log(`${held} move: ${[...seen].join('/')}, done after ${doneAt === null ? 'never' : `${(doneAt / 30).toFixed(1)} s`}, fastest ${fastest.toFixed(2)} m/s`);
      expect([...seen]).toEqual([held]);
      expect(doneAt).not.toBeNull();
      expect(Math.hypot(bot.state.x - point.x, bot.state.z - point.z)).toBeGreaterThan(1);
      expect(fastest).toBeGreaterThan(speed * 0.5);
      expect(fastest).toBeLessThanOrEqual(speed + 1e-6);
    }
  });

  it('stands only to vault the low wall a move order crosses, prone before and after', () => {
    // The range bake vaults the low wall at x = −8.12 between z = −1.6 and −0.1 (followPath.test.ts).
    const sq = squad({ 1: { x: -8.12, z: -5 } });
    const { session } = sq;
    const bot = session.slots[1]!;
    sq.lead.say(stance({ to: 'slot', index: 1 }, 'prone'));
    sq.run(3);
    const point = { x: -8.5, y: 0, z: 4.3 };
    sq.lead.say({ kind: 'Order', order: 'move', address: { to: 'slot', index: 1 }, point, target: null });
    // Each spell of a posture, and how many ticks it lasted.
    const trail: { p: string; ticks: number }[] = [];
    let doneAt: number | null = null;
    sq.run(30 * 20, (t) => {
      const p = bot.state.vault ? 'vault' : posture(bot.state);
      if (trail.at(-1)?.p === p) trail.at(-1)!.ticks++;
      else trail.push({ p, ticks: 1 });
      if (doneAt === null && session.orderReports.some((r) => r.slot === 1 && r.outcome === 'done')) doneAt = t;
    });
    console.log(`prone over the wall: ${trail.map((s) => `${s.p} ${s.ticks}`).join(' → ')}, done after ${doneAt === null ? 'never' : `${(doneAt / 30).toFixed(1)} s`}`);
    expect(doneAt).not.toBeNull();
    // Up for the vault and the tick it lands on (the controller lands a vault standing), then straight back down.
    expect(trail.map((s) => s.p)).toEqual(['prone', 'standing', 'vault', 'standing', 'prone']);
    for (const spell of trail.filter((s) => s.p === 'standing')) expect(spell.ticks).toBeLessThanOrEqual(10);
  });

  it('rises to revive a downed squadmate, then goes back to ground', () => {
    const sq = squad({ 1: { x: -5, z: -6 }, 2: { x: -1, z: -6 } });
    const { session } = sq;
    const bot = session.slots[1]!;
    const mate = session.slots[2]!;
    sq.lead.say(stance({ to: 'slot', index: 1 }, 'prone'));
    sq.run(15);
    expect(bot.state.prone).toBe(true);
    Object.assign(mate.health, { current: 0, downedAt: 0, diedAt: null });
    let revivedProne = false;
    let lockedBy = -1;
    sq.run(30 * 8, () => {
      if (mate.reviveBySlot >= 0) {
        lockedBy = mate.reviveBySlot;
        if (bot.state.prone) revivedProne = true;
      }
    });
    expect(lockedBy).toBe(1);
    expect(revivedProne).toBe(false);
    expect(mate.health.downedAt).toBeNull();
    sq.run(30);
    expect(bot.state.prone).toBe(true);
  });

  it('Auto hands the stance back to the bot: an idle one stands again', () => {
    const sq = squad({ 1: { x: 0, z: -8 } });
    const bot = sq.session.slots[1]!;
    sq.lead.say(stance({ to: 'all' }, 'prone'));
    sq.run(10);
    expect(bot.state.prone).toBe(true);
    sq.lead.say(stance({ to: 'all' }, 'crouch'));
    sq.run(10);
    expect(posture(bot.state)).toBe('crouch');
    sq.lead.say(stance({ to: 'all' }, 'auto'));
    sq.run(10);
    expect(posture(bot.state)).toBe('standing');
  });

  it('Auto, said or never said, changes nothing the bots do', () => {
    const play = (say: boolean) => {
      const sq = squad({ 1: { x: 0, z: -8 }, 2: { x: 3, z: -10 } });
      if (say) sq.lead.say(stance({ to: 'all' }, 'auto'));
      sq.lead.say({ kind: 'Order', order: 'move', address: { to: 'all' }, point: { x: 6, y: 0, z: -2 }, target: null });
      const trail: number[] = [];
      sq.run(120, () => {
        for (const s of sq.session.slots) trail.push(s.state.x, s.state.z, s.state.crouched ? 1 : 0, s.state.prone ? 1 : 0);
      });
      return trail;
    };
    expect(play(true)).toEqual(play(false));
  });
});

describe('a stance is the character’s (U-153)', () => {
  it('never moves a human, and stays with the slot through a switch, a leave and a reconnect', () => {
    const sq = squad({ 2: { x: 0, z: -8 } });
    const { session } = sq;
    // A second player keeps the session running while the lead is away (U-025 pauses a room with nobody seated).
    const other = sq.join('other');
    expect(other.ack.slot).toBe(1);
    const me = session.slots[0]!;
    sq.lead.say(stance({ to: 'slot', index: 0 }, 'prone'));
    sq.run(15);
    expect(session.stanceFor(0)).toBe('prone');
    expect(posture(me.state)).toBe('standing');
    // A switch: the lead takes the bot in slot 2, held in Crouch; the lead's own soldier goes to ground as a bot.
    sq.lead.say(stance({ to: 'slot', index: 2 }, 'crouch'));
    sq.run(10);
    expect(posture(session.slots[2]!.state)).toBe('crouch');
    sq.lead.say({ kind: 'SwitchCharacter', slot: 2 });
    expect(sq.lead.possessed.at(-1)?.slot).toBe(2);
    sq.run(15);
    expect(posture(session.slots[2]!.state)).toBe('standing');
    expect(posture(me.state)).toBe('prone');
    expect([session.stanceFor(0), session.stanceFor(2)]).toEqual(['prone', 'crouch']);
    // A leave: the bot that takes slot 2 back is held in Crouch again.
    const token = sq.lead.possessed.at(-1)!.resume;
    sq.lead.drop();
    sq.run(15);
    expect(session.slots[2]!.isBot).toBe(true);
    expect(posture(session.slots[2]!.state)).toBe('crouch');
    // A reconnect: back into slot 2, on its feet, the setting untouched and sent on seating.
    const back = sq.join('lead', token);
    expect(back.ack).toMatchObject({ resumed: true, slot: 2 });
    expect(back.stances).toEqual(['prone', 'auto', 'crouch', 'auto', 'auto', 'auto']);
    sq.run(15);
    expect(posture(session.slots[2]!.state)).toBe('standing');
    expect(posture(me.state)).toBe('prone');
  });

  it('survives a checkpoint retry, the bots going back to ground and the human left standing', () => {
    const encounter = parseEncounter({
      world: 'greybox-01',
      aliveCap: 10,
      probes: [0.3, 1.0, 1.7],
      areas: {},
      groups: [{ id: 'a', members: [{ archetype: 'rifleman', count: 1 }], zone: 'behind-objective', posture: { kind: 'garrison', at: 'objective' }, trigger: { kind: 'start' } }],
    });
    const mission: MissionDef = { id: 'test', world: 'greybox-01', respawn: false, objectives: [{ type: 'survive', label: 'the night', seconds: 600 }] };
    const sq = squad({}, { encounter, mission, testHumanCount: 1 }, 'greybox-01');
    const { session } = sq;
    sq.lead.say(stance({ to: 'all' }, 'prone'));
    sq.run(10);
    expect(session.slots.map((s) => posture(s.state))).toEqual(['standing', 'prone', 'prone', 'prone', 'prone', 'prone']);
    for (const s of session.slots) Object.assign(s.health, { current: 0, diedAt: session.tick / 30 });
    sq.run(2);
    expect(session.mission!.state).toBe('failed');
    session.retryMission();
    sq.run(10);
    expect(session.mission!.attempt).toBe(2);
    expect(session.slots.map((s) => session.stanceFor(s.index))).toEqual(Array.from({ length: 6 }, () => 'prone'));
    expect(session.slots.map((s) => posture(s.state))).toEqual(['standing', 'prone', 'prone', 'prone', 'prone', 'prone']);
  });
});
