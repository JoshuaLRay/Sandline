/**
 * The scoreboard on the session (T-4.28): real `Session`s, humans over
 * loopback. The rows are the server's count of what happened — a kill by
 * a round, a death by an enemy's fire and the bleed-out after it, a revive,
 * an order a bot took — and every change reaches every client whole.
 */
import { describe, expect, it } from 'vitest';
import {
  ClientConnection,
  DAMAGE,
  type Message,
  type MissionStats,
  PROTOCOL_VERSION,
  buildTree,
  createLoopbackPair,
  createMoveState,
  decodeMessage,
  encodeMessage,
  getEnemy,
  isAlive,
  isDead,
  parseTreeDef,
} from '@sandline/shared';
import { type BrainTree, createBrainRegistry } from '../ai/Brain.ts';
import { Session } from './Session.ts';

const TICK_MS = 1000 / 30;
const FACING_SPAWN = 512;

function shootAt(want: () => number | null): BrainTree {
  const registry = createBrainRegistry().action('shoot', ({ blackboard }) => {
    blackboard.set('fireAt', want());
    return 'running';
  });
  return buildTree(parseTreeDef({ id: 'test-shoot', root: { type: 'action', name: 'shoot' } }), registry);
}

/** A human over loopback, remembering the last scoreboard the host sent. */
function human(session: Session, name: string) {
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  let slot = -1;
  let stats: MissionStats | null = null;
  const client = new ClientConnection(pair.b, {
    onJoinAck: (_netId, s) => {
      slot = s;
    },
    onStats: (msg) => {
      const { kind: _kind, ...rest } = msg;
      stats = rest;
    },
  });
  client.join(name);
  pair.settle();
  return {
    get slot() {
      return slot;
    },
    get stats() {
      return stats as MissionStats | null;
    },
    settle: () => pair.settle(),
    send(msg: Message) {
      client.send(msg);
      pair.settle();
    },
    run(ticks: number, each?: () => void) {
      for (let i = 0; i < ticks; i += 1) {
        client.send({ kind: 'Input', tick: session.tick + 1, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0 });
        pair.settle();
        session.step((session.tick + 1) * TICK_MS);
        pair.settle();
        each?.();
      }
    },
  };
}

describe('the scoreboard on the session (T-4.28)', () => {
  it('starts every client on six empty rows, and counts a death under enemy fire and the bleed-out after it', () => {
    const session = new Session(undefined, '', 'range');
    const me = human(session, 'me');
    expect(me.stats?.slots.map((row) => row.deaths)).toEqual([0, 0, 0, 0, 0, 0]);
    const target = session.slots[me.slot]!;
    target.state = createMoveState(0, 0, 0);
    // Shoots until the target is down, then lets the bleed-out run its full course.
    session.spawnEnemy('rifleman', { x: 0, y: 0, z: 10, yaw: FACING_SPAWN, tree: shootAt(() => (isAlive(target.health) ? target.netId : null)) });
    let ticks = 0;
    while (isAlive(target.health) && ticks++ < 600) me.run(1);
    expect(isAlive(target.health)).toBe(false);
    // Downed is not dead: no death yet.
    expect(me.stats?.slots[me.slot]?.deaths).toBe(0);
    // Nobody comes: the bleed-out is the death (and the range respawns the dead five seconds later).
    me.run(Math.ceil(DAMAGE.downed.bleedOutSeconds / (TICK_MS / 1000)) + 5);
    expect(isDead(target.health)).toBe(true);
    expect(me.stats?.slots[me.slot]?.deaths).toBe(1);
    me.run(Math.ceil(DAMAGE.respawnSeconds / (TICK_MS / 1000)) + 5);
    expect(isAlive(target.health)).toBe(true);
    expect(me.stats?.slots[me.slot]?.deaths).toBe(1);
    expect(me.stats?.slots.filter((row) => row.slot !== me.slot).every((row) => row.deaths === 0)).toBe(true);
  });

  it('counts a kill for the slot whose round did it, and a revive for the reviver', () => {
    const session = new Session(undefined, '', 'range');
    const me = human(session, 'me');
    const mate = human(session, 'mate');
    const mine = session.slots[me.slot]!;
    mine.state = createMoveState(0, 0, 0);
    // A rifleman two metres ahead, in the carbine's cone, standing still.
    const enemyId = session.spawnEnemy('rifleman', { x: 0, y: 0, z: 2, yaw: FACING_SPAWN }) as number;
    const enemy = session.enemies.find((e) => e.netId === enemyId)!;
    for (let tick = 1; tick <= 120 && !isDead(enemy.health); tick += 1) {
      me.send({ kind: 'Fire', tick, yaw: 0, pitch: 0, renderTimeMs: 0, weapon: 0, ads: false });
      me.run(1);
    }
    expect(isDead(enemy.health)).toBe(true);
    mate.settle();
    expect(me.stats?.slots[me.slot]?.kills).toBe(1);
    expect(mate.stats?.slots[me.slot]?.kills).toBe(1);
    expect(getEnemy('rifleman').health).toBeGreaterThan(0);

    // The mate goes down at my feet and I hold E over them.
    const theirs = session.slots[mate.slot]!;
    theirs.health.current = 0;
    theirs.health.downedAt = session.tick * TICK_MS / 1000;
    theirs.state = createMoveState(mine.state.x, mine.state.y, mine.state.z);
    const holdTicks = Math.ceil(DAMAGE.downed.reviveSeconds / (TICK_MS / 1000)) + 3;
    for (let i = 0; i < holdTicks; i += 1) {
      me.send({ kind: 'Input', tick: session.tick + 1, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0b1000 });
      mate.send({ kind: 'Input', tick: session.tick + 1, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0 });
      session.step((session.tick + 1) * TICK_MS);
      me.settle();
      mate.settle();
    }
    expect(theirs.health.current).toBeGreaterThan(0);
    expect(mate.stats?.slots[me.slot]?.revives).toBe(1);
  });

  it('counts an order a bot took for the slot that gave it, and nothing for one nobody took', () => {
    const session = new Session(undefined, '', 'range');
    const me = human(session, 'me');
    session.orderFrom(me.slot, { order: 'move', address: { to: 'all' }, point: { x: 1, y: 0, z: 1 }, target: null });
    me.settle();
    expect(me.stats?.slots[me.slot]?.ordersGiven).toBe(1);
    // A human's own slot takes no order (ADR-001): nothing to count.
    session.orderFrom(me.slot, { order: 'move', address: { to: 'slot', index: me.slot }, point: { x: 1, y: 0, z: 1 }, target: null });
    me.settle();
    expect(me.stats?.slots[me.slot]?.ordersGiven).toBe(1);
  });

  it('carries the mission clock and the objectives done, and the message round-trips the wire', () => {
    const session = new Session(undefined, '', 'range');
    const board = session.scoreboard;
    expect(board).toMatchObject({ kind: 'Stats', elapsedTicks: 0, objectivesDone: 0, objectives: 0 });
    expect(decodeMessage(encodeMessage(board))).toEqual(board);
    expect(PROTOCOL_VERSION).toBe(33);
  });
});
