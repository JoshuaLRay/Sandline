import { describe, expect, it } from 'vitest';
import { AGGRESSION_KINDS, ClientConnection, type Message, buildTree, createLoopbackPair, createMoveState, decodeMessage, encodeMessage, rememberSeen, rememberHeard, parseTreeDef, formationBand } from '@sandline/shared';
import { createBrainRegistry } from '../ai/Brain.ts';
import { initNav } from '../ai/nav/NavMesh.ts';
import { bakedCoverFor, loadWorldNavMesh } from '../ai/nav/bakedNav.ts';
import { Session } from './Session.ts';

describe('aggression (U-101)', () => {
  it('round-trips each mode and rejects an undefined mode', () => {
    for (const aggression of AGGRESSION_KINDS) {
      const command: Message = { kind: 'Aggression', address: { to: 'slot', index: 5 }, aggression };
      expect(decodeMessage(encodeMessage(command))).toEqual(command);
    }
    const state: Message = { kind: 'Aggressions', aggressions: ['hold-fire', 'defensive', 'aggressive', 'hold-fire', 'defensive', 'aggressive'] };
    expect(decodeMessage(encodeMessage(state))).toEqual(state);
    expect(() => decodeMessage(encodeMessage({ kind: 'Aggression', address: { to: 'all' }, aggression: 'unknown' } as unknown as Message))).toThrow();
  });
  it('synchronizes settings, refuses other commanders, and stores the human character policy for later bot control', () => {
    const session = new Session();
    const join = () => {
      const pair = createLoopbackPair(); session.addConnection(pair.a, 0);
      let modes: readonly string[] = [];
      const client = new ClientConnection(pair.b, { onAggressions: (value) => { modes = value; } });
      client.join('commander'); pair.settle();
      return { pair, client, modes: () => modes };
    };
    const first = join(); const second = join();
    first.client.send({ kind: 'AssignCommander', bot: 5, commander: 1 }); first.pair.settle(); second.pair.settle();
    const otherBot = 5;
    first.client.send({ kind: 'Aggression', address: { to: 'slot', index: otherBot }, aggression: 'hold-fire' }); first.pair.settle();
    expect(session.aggressionFor(otherBot)).toBe('aggressive');
    first.client.send({ kind: 'Aggression', address: { to: 'slot', index: 0 }, aggression: 'defensive' }); first.pair.settle(); second.pair.settle();
    expect(session.aggressionFor(0)).toBe('defensive');
    const late = join();
    expect(late.modes()).toEqual(Array.from({ length: 6 }, (_, i) => session.aggressionFor(i)));
    expect(first.modes()).toEqual(second.modes());
  });
  it('advances toward a lost visual contact within formation, but never follows a sound alone', async () => {
    await initNav(); const mesh = loadWorldNavMesh('range');
    try {
      for (const confidence of [0.8, 1]) {
        const tree = buildTree(parseTreeDef({ id: 'advance-test', root: { type: 'action', name: 'advanceContact' } }), createBrainRegistry());
        const session = new Session(undefined, '', 'range', { navMesh: mesh, brainTree: tree });
        const pair = createLoopbackPair(); session.addConnection(pair.a, 0);
        const client = new ClientConnection(pair.b, {}); client.join('lead'); pair.settle();
        session.slots[0]!.state = createMoveState(17, 0, -16);
        const bot = session.slots[1]!; bot.state = createMoveState(18, 0, -20); bot.yaw = 512;
        const target = session.spawnEnemy('rifleman', { x: 12, y: 0, z: -10, tree: buildTree('idle', createBrainRegistry()) })!;
        rememberSeen(bot.memory, target, { x: 12, y: 0, z: -10 }, 0, false);
        const entry = bot.memory.entries.get(target)!; entry.visible = false; entry.confidence = confidence;
        for (let n = 0; n < 3; n++) session.step((session.tick + 1) * 1000 / 30);
        if (confidence < 1) expect(bot.brain!.intent).toBeNull();
        else {
          const intent = bot.brain!.intent!; expect(intent).not.toBeNull();
          const place = bot.squad.place(1)!;
          expect(Math.hypot(intent.goal.x - place.goal.x, intent.goal.z - place.goal.z)).toBeLessThanOrEqual(formationBand(place.offset) + 1e-6);
          client.send({ kind: 'Aggression', address: { to: 'slot', index: 1 }, aggression: 'defensive' }); pair.settle();
          for (let n = 0; n < 3; n++) session.step((session.tick + 1) * 1000 / 30);
          expect(bot.brain!.intent).toBeNull();
        }
      }
    } finally { mesh.destroy(); }
  });
  it('keeps Hold fire and Defensive silent on unprovoked contact, permits an explicit attack and clears fire immediately', async () => {
    await initNav(); const mesh = loadWorldNavMesh('range');
    try {
      const session = new Session(undefined, '', 'range', { navMesh: mesh, cover: bakedCoverFor('range'), brainTree: buildTree('friendly', createBrainRegistry()) });
      const pair = createLoopbackPair(); session.addConnection(pair.a, 0);
      const client = new ClientConnection(pair.b, {}); client.join('lead'); pair.settle();
      session.slots[0]!.state = createMoveState(17, 0, -16);
      for (let i = 1; i < 6; i++) session.slots[i]!.state = createMoveState(13 + i * 2, 0, -20);
      const foes = [12, 19, 23].map((x) => session.spawnEnemy('rifleman', { x, y: 0, z: -10, tree: buildTree('idle', createBrainRegistry()) })!);
      for (const enemy of session.enemies) {
        Object.assign(enemy.health, { current: 10000, max: 10000 });
        // Known contacts isolate the aggression policy from recognition delay.
        for (const slot of session.slots) { rememberSeen(slot.memory, enemy.netId, enemy.state, 0, false); slot.awareness.set(enemy.netId, 1); }
      }
      const send = (message: Message) => { client.send(message); pair.settle(); };
      send({ kind: 'Aggression', address: { to: 'slot', index: 1 }, aggression: 'hold-fire' });
      send({ kind: 'Aggression', address: { to: 'slot', index: 2 }, aggression: 'defensive' });
      const step = (ticks: number) => { for (let n = 0; n < ticks; n++) session.step((session.tick + 1) * 1000 / 30); };
      step(90);
      expect(session.slots[1]!.weaponState.shotIndex).toBe(0);
      expect(session.slots[2]!.weaponState.shotIndex).toBe(0);
      expect(session.slots[3]!.weaponState.shotIndex).toBeGreaterThan(0);
      session.slots[1]!.state = createMoveState(12, 0, -20); session.slots[1]!.yaw = 0;
      const target = foes[0]!;
      send({ kind: 'Order', order: 'attack', address: { to: 'slot', index: 1 }, point: null, target });
      step(90);
      expect(session.slots[1]!.weaponState.shotIndex).toBeGreaterThan(0);
      send({ kind: 'Order', order: 'regroup', address: { to: 'slot', index: 1 }, point: null, target: null });
      send({ kind: 'Aggression', address: { to: 'slot', index: 1 }, aggression: 'hold-fire' });
      const shots = session.slots[1]!.weaponState.shotIndex;
      expect(session.slots[1]!.brain!.fireAt).toBeNull();
      step(30); expect(session.slots[1]!.weaponState.shotIndex).toBe(shots);
      const defensive = session.slots[2]!;
      defensive.state = createMoveState(15, 0, -18); defensive.yaw = 0;
      const foe = session.enemies.find((e) => e.netId === foes[0])!;
      rememberSeen(defensive.memory, foe.netId, foe.state, session.tick / 30, false);
      defensive.awareness.set(foe.netId, 1);
      rememberHeard(defensive.memory, { kind: 'nearMiss', at: defensive.state, sourceNetId: foe.netId }, session.tick / 30);
      step(60);
      expect(defensive.weaponState.shotIndex).toBeGreaterThan(0);
      expect(session.friendlyHits).toBe(0);
    } finally { mesh.destroy(); }
  }, 30000);
});
