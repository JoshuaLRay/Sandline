import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DAMAGE, PROGRESSION, PROTOCOL_VERSION, TICK_SECONDS, buildTree, createLoopbackPair,
  decodeMessage, encodeMessage, getProjectile, parseEncounter, parseTreeDef, requireWorld,
  type Message, type MissionDef,
} from '@sandline/shared';
import { Session } from '../session/Session.ts';
import { Brain, createBrainRegistry } from '../ai/Brain.ts';
import { CampaignDatabase, type CampaignState } from './CampaignDatabase.ts';

const idle = () => buildTree('idle', createBrainRegistry());
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function human(session: Session, playerId = 'alice', resume = '') {
  const pair = createLoopbackPair();
  const messages: Message[] = [];
  pair.b.onMessage((bytes) => messages.push(decodeMessage(bytes)));
  const conn = session.addConnection(pair.a, session.tick * TICK_SECONDS * 1000);
  // This is the verified identity normally provided by SessionHost.
  conn.playerId = playerId;
  const send = (msg: Message) => { pair.b.send(encodeMessage(msg)); pair.settle(); };
  send({ kind: 'Join', version: PROTOCOL_VERSION, name: playerId, room: '', ...(resume ? { resume } : {}) });
  const ack = messages.find((m): m is Extract<Message, { kind: 'JoinAck' }> => m.kind === 'JoinAck')!;
  return {
    pair, send, ack, messages,
    get soldiers() {
      pair.settle();
      return messages.filter((m): m is Extract<Message, { kind: 'Progression' }> => m.kind === 'Progression').at(-1)!.soldiers;
    },
    step(count = 1, interact = false) {
      for (let n = 0; n < count; n++) {
        const tick = session.tick + 1;
        send({ kind: 'Input', tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: interact ? 8 : 0 });
        session.step(tick * TICK_SECONDS * 1000);
        pair.settle();
      }
    },
  };
}

function order(session: Session, client: ReturnType<typeof human>) {
  client.send({ kind: 'Order', order: 'move', address: { to: 'slot', index: 2 }, point: { x: 3, y: 0, z: 3 }, target: null });
  // The brain's real completion interface; this test controls arrival timing.
  session.slots[2]!.squad.report(2, 'done', 'arrived');
  client.pair.settle();
}

const encounter = parseEncounter({
  world: 'greybox-01', aliveCap: 12, probes: [0.3, 1, 1.7], areas: {},
  groups: [{ id: 'later', members: [{ archetype: 'rifleman', count: 1 }], zone: 'behind-objective', posture: { kind: 'garrison', at: 'objective' }, trigger: { kind: 'time', seconds: 3600 } }],
});
const mission: MissionDef = {
  id: 'xp-test', world: 'greybox-01', respawn: false,
  objectives: [
    { type: 'survive', label: 'first', seconds: TICK_SECONDS },
    { type: 'survive', label: 'second', seconds: 1 },
  ],
};

describe('XP from authoritative session events (T-4.24)', () => {
  it('credits completed orders to their issuer, once, never to bots or failed/replaced orders', () => {
    const session = new Session(undefined, '', 'range', { brainTree: idle() });
    const a = human(session);
    order(session, a);
    const report = (outcome: 'done' | 'failed') => session.slots[2]!.squad.report(2, outcome, 'test');
    report('done');
    expect(a.soldiers[0]).toMatchObject({ xp: PROGRESSION.awards.order, earned: PROGRESSION.awards.order });
    expect(a.soldiers.slice(1).every((s) => s.xp === 0)).toBe(true);
    a.send({ kind: 'Order', order: 'hold', address: { to: 'slot', index: 2 }, point: null, target: null });
    report('failed');
    expect(a.soldiers[0]!.xp).toBe(PROGRESSION.awards.order);
    session.orderFrom(1, { order: 'hold', address: { to: 'slot', index: 2 }, point: null, target: null });
    report('done');
    expect(a.soldiers[1]!.xp).toBe(0);
  });

  it('does not transfer an outstanding order to a replacement player', () => {
    const session = new Session(undefined, '', 'range', { brainTree: idle() });
    const a = human(session);
    a.step();
    a.send({ kind: 'Order', order: 'hold', address: { to: 'slot', index: 2 }, point: null, target: null });
    a.send({ kind: 'Disconnect', code: 'other', reason: 'left' });
    const b = human(session, 'bob');
    expect(b.ack.slot).toBe(0);
    session.slots[2]!.squad.report(2, 'done', 'arrived');
    expect(b.soldiers.every((s) => s.xp === 0)).toBe(true);
  });

  it('awards a completed human revive once, not an interrupted revive or a bot revive', () => {
    const session = new Session(undefined, '', 'range', { brainTree: idle() });
    const a = human(session);
    const target = session.slots[1]!;
    Object.assign(target.state, { ...session.slots[0]!.state });
    Object.assign(target.health, { current: 0, downedAt: 0 });
    a.step(10, true);
    a.step(1, false);
    expect(a.soldiers[0]!.xp).toBe(0);
    a.step(Math.ceil(DAMAGE.downed.reviveSeconds / TICK_SECONDS) + 4, true);
    expect(target.health.current).toBeGreaterThan(0);
    expect(a.soldiers[0]!.xp).toBe(PROGRESSION.awards.revive);
    a.step(10, true);
    expect(a.soldiers[0]!.xp).toBe(PROGRESSION.awards.revive);
    // Drive the same revive resolver with a bot holding interact.
    const bot = session.slots[2]!;
    Object.assign(target.health, { current: 0, downedAt: session.tick * TICK_SECONDS });
    Object.assign(bot.state, { ...target.state });
    a.step(1, false);
    const registry = createBrainRegistry().action('interact', ({ blackboard }) => { blackboard.set('interact', true); return 'running'; });
    bot.brain = new Brain(bot, buildTree(parseTreeDef({ id: 'test-revive', root: { type: 'action', name: 'interact' } }), registry));
    bot.brain.think(session.tick);
    target.reviveBySlot = 2;
    target.reviveProgressSeconds = DAMAGE.downed.reviveSeconds;
    session['updateRevives']();
    expect(target.health.current).toBeGreaterThan(0);
    expect(a.soldiers[2]!.xp).toBe(0);
  });

  it('awards hitscan enemy kills once, with no XP for friendly kills or bot shots', () => {
    const session = new Session(undefined, '', 'range', { brainTree: idle() });
    const a = human(session);
    const shooter = session.slots[0]!;
    const enemyId = session.spawnEnemy('rifleman', { x: shooter.state.x, y: 0, z: shooter.state.z + 5, tree: idle() })!;
    const enemy = session.enemies.find((e) => e.netId === enemyId)!;
    enemy.health.current = 1;
    a.step(3);
    const fire = () => a.send({ kind: 'Fire', tick: session.tick, yaw: 0, pitch: 0, weapon: 0, ads: true, renderTimeMs: session.tick * TICK_SECONDS * 1000 });
    fire();
    expect(enemy.health.diedAt).not.toBeNull();
    expect(a.soldiers[0]!.xp).toBe(PROGRESSION.awards.kill);
    a.step(10);
    fire();
    expect(a.soldiers[0]!.xp).toBe(PROGRESSION.awards.kill);
    const bot = session.slots[2]!;
    const id = session.spawnEnemy('rifleman', { x: bot.state.x, y: 0, z: bot.state.z + 5, tree: idle() })!;
    session.enemies.find((e) => e.netId === id)!.health.current = 1;
    a.step(3);
    session['traceShot'](bot.netId, bot.weapon, { shotIndex: 0, coneUnits: 0 }, session.tick,
      { x: bot.state.x, y: 1.5, z: bot.state.z }, 0, 0, session.tick * TICK_SECONDS * 1000);
    expect(session.enemies.find((e) => e.netId === id)!.health.diedAt).not.toBeNull();
    expect(a.soldiers[2]!.xp).toBe(0);
    // A finishing shot at a downed squadmate is never an enemy kill.
    Object.assign(session.slots[1]!.state, { x: shooter.state.x + 2, z: shooter.state.z + 5 });
    const teammate = session.slots[1]!;
    Object.assign(teammate.health, { current: 0, downedAt: 0 });
    a.step(3);
    session['traceShot'](shooter.netId, shooter.weapon, { shotIndex: 0, coneUnits: 0 }, session.tick,
      { x: teammate.state.x, y: 0.2, z: teammate.state.z - 2 }, 0, 0, session.tick * TICK_SECONDS * 1000);
    expect(a.soldiers[0]!.xp).toBe(PROGRESSION.awards.kill);
  });

  it.each([false, true])('credits a grenade’s human thrower, never a replacement (replace=%s)', (replace) => {
    const session = new Session(undefined, '', 'range', { brainTree: idle() });
    const a = human(session);
    a.step();
    const me = session.slots[0]!.state;
    const id = session.spawnEnemy('rifleman', { x: me.x + 0.8, y: 0, z: me.z, tree: idle() })!;
    a.send({ kind: 'Throw', tick: session.tick, yaw: 0, pitch: (-1024 >>> 0) & 0xfff, projectile: 0 });
    if (replace) a.send({ kind: 'Disconnect', code: 'other', reason: 'left' });
    const client = replace ? human(session, 'bob') : a;
    client.step(Math.ceil(getProjectile('frag').fuseSeconds / TICK_SECONDS) + 5);
    expect(session.enemies.find((e) => e.netId === id)?.health.diedAt).not.toBeNull();
    expect(client.soldiers[0]!.xp).toBe(replace ? 0 : PROGRESSION.awards.kill);
    expect(client.soldiers[0]!.earned).toBe(replace ? 0 : PROGRESSION.awards.kill);
  });

  it('saves objective awards before checkpoint/end, survives reconnect and a real SQLite reopen', () => {
    const root = mkdtempSync(join(tmpdir(), 'sandline-xp-'));
    roots.push(root);
    const path = join(root, 'campaign.sqlite');
    let db = new CampaignDatabase(path);
    const campaign = db.createCampaign('alice', 'greybox-01');
    const state = campaign.state;
    state.soldiers[0]!.xp = PROGRESSION.ranks[1]!.xp - PROGRESSION.awards.objective;
    db.saveCampaign(campaign.code, state);
    const saves: CampaignState[] = [];
    const session = new Session(undefined, campaign.code, requireWorld('greybox-01'), {
      encounter, mission, brainTree: idle(), campaign: state,
      onCampaignSave: (saved) => { saves.push(saved); db.saveCampaign(campaign.code, saved); },
    });
    const a = human(session);
    a.step();
    expect(saves).toHaveLength(1);
    expect(saves[0]!.soldiers[0]).toMatchObject({ xp: 500, rank: 1 });
    expect(saves[0]!.soldiers.slice(1).every((s) => s.xp === 0)).toBe(true);
    a.pair.b.close('network lost');
    a.pair.settle();
    const resumed = human(session, 'alice', a.ack.resume);
    expect(resumed.ack.resumed).toBe(true);
    expect(resumed.soldiers[0]).toMatchObject({ xp: 500, rank: 1, earned: 100 });
    resumed.step(32);
    expect(session.mission?.state).toBe('complete');
    expect(saves).toHaveLength(2);
    expect(resumed.soldiers[0]).toMatchObject({ xp: 600, earned: 200 });
    resumed.step(20);
    expect(resumed.soldiers[0]!.xp).toBe(600);
    db.close();
    db = new CampaignDatabase(path);
    const restored = new Session(undefined, campaign.code, 'greybox-01', { campaign: db.loadCampaign(campaign.code)!.state, brainTree: idle() });
    const b = human(restored, 'bob');
    expect(b.soldiers[0]).toMatchObject({ xp: 600, rank: 1, earned: 0 });
    expect(human(new Session(), 'alice').soldiers[0]!.xp).toBe(0);
    db.close();
  });

  it('saves XP on failure without an objective bonus, and clears personal credit on replay only', () => {
    const saves: CampaignState[] = [];
    const session = new Session(undefined, '', 'greybox-01', { encounter, mission, brainTree: idle(), onCampaignSave: (saved) => saves.push(saved) });
    const a = human(session);
    order(session, a);
    for (const slot of session.slots) Object.assign(slot.health, { current: 0, diedAt: 0 });
    a.step();
    expect(session.mission?.state).toBe('failed');
    expect(saves).toHaveLength(1);
    expect(saves[0]!.soldiers[0]!.xp).toBe(PROGRESSION.awards.order);
    a.send({ kind: 'MissionRestart' });
    expect(a.soldiers[0]!.earned).toBe(PROGRESSION.awards.order);
    session.restartMission();
    expect(a.soldiers[0]).toMatchObject({ xp: PROGRESSION.awards.order, earned: 0 });
  });

  it('rejects a forged client progression message', () => {
    const session = new Session();
    const a = human(session);
    a.send({ kind: 'Progression', soldiers: a.soldiers.map((s) => ({ ...s, xp: 5000 })) });
    expect(a.messages.at(-1)).toMatchObject({ kind: 'Disconnect', code: 'protocol error' });
    expect(human(session, 'bob').soldiers.every((s) => s.xp === 0)).toBe(true);
  });
});
