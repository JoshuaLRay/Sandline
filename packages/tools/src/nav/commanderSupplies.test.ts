/** U-147: reliable commander requests walk real layered nav through the authoritative Session. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  buildTree, ClientConnection, createLoopbackPair, createMoveState, decodeMessage, loadWorld, parseEncounter,
  parseEventScript, PROTOCOL_VERSION, raiseSuppression, requireWorld, TICK_SECONDS, type Message, type MissionDef,
  type SupplyItem,
} from '@sandline/shared';
import { createBrainRegistry } from '../../../server/src/ai/Brain.ts';
import { initNav, NavMesh } from '../../../server/src/ai/nav/NavMesh.ts';
import { Session } from '../../../server/src/session/Session.ts';
import { parseCheckpointWorld, type CheckpointWorld } from '../../../server/src/session/checkpointWorld.ts';
import type { CampaignState } from '../../../server/src/persistence/CampaignDatabase.ts';
import { bakeWorld } from './bake.ts';

const world = loadWorld({ id: 'commanded-cache-layers', floor: { halfExtent: 30 }, cover: [
  { id: 'surface', x: 0, y: 5.5, z: 0, w: 16, d: 16, h: 2.5 },
  { id: 'bridge', x: 0, y: 14, z: 0, w: 10, d: 10, h: 2 },
  { id: 'wall', x: -12, y: 0, z: 8, w: 6, d: .2, h: 2.4 },
  ...[0, 8, 16].map((y) => ({ id: `crate-${y}`, x: 3, y, z: 3, w: 1.2, d: 1.2, h: 1.2 })),
  ...Array.from({ length: 20 }, (_, i) => ({ id: `step-${i}`, x: 17.75 - i * .5, y: 0, z: 0, w: .5, d: 3, h: (i + 1) * .4 })),
], mission: requireWorld('greybox-01').mission! });
const mission: MissionDef = { id: world.id, world: world.id, respawn: false, objectives: [{ type: 'survive', label: 'Wait', seconds: 3600 }] };
const encounter = parseEncounter({ world: world.id, aliveCap: 4, probes: [1], areas: {}, groups: [
  { id: 'unused', members: [{ archetype: 'rifleman', count: 1 }], zone: 'behind-objective', posture: { kind: 'hold' }, trigger: { kind: 'script' } },
] }, () => world);
const STOCK = { projectiles: { frag: 4 }, healthKits: 3, primaryMagazines: 2 };
const CACHES = [
  { id: 'upper', feet: { x: 0, y: 8, z: 2 }, stock: STOCK },
  { id: 'bridge', feet: { x: 0, y: 16, z: 2 }, stock: STOCK },
  { id: 'open', feet: { x: -12, y: 0, z: -10 }, stock: STOCK },
  { id: 'other', feet: { x: -6, y: 0, z: -10 }, stock: STOCK },
  { id: 'wall', feet: { x: -12, y: 0, z: 9 }, stock: STOCK },
];
const KIT: SupplyItem = { kind: 'health-kit' };
const AMMO: SupplyItem = { kind: 'primary-ammo' };
const START = { x: -14, y: 0, z: 2 };
const upper = CACHES[0]!.feet;
const sessions: Session[] = [];
let mesh: NavMesh;
beforeAll(async () => { await initNav(); mesh = NavMesh.load(await bakeWorld(world)); });
afterEach(() => { for (const session of sessions.splice(0)) session.close(); });
afterAll(() => mesh.destroy());

interface Internals {
  captureMissionCheckpoint(): void;
  restoreCheckpointWorld(saved: CheckpointWorld): boolean;
  supplyUses: Map<number, { ticks: number; phase?: 'approach' | 'collect' }>;
  followers: (unknown | null)[];
}

function room(opts: { noNav?: boolean; lastKit?: boolean; campaign?: CampaignState } = {}) {
  const saves: CampaignState[] = [];
  const events = parseEventScript({ world: world.id, blockers: [], supplyCaches: CACHES.map((cache) =>
    opts.lastKit && cache.id === 'upper' ? { ...cache, stock: { healthKits: 1 } } : cache),
  events: [{ id: 'ready', trigger: { kind: 'time', seconds: 0 }, actions: [{ kind: 'message', text: 'Ready' }] }],
  }, encounter, world, mission);
  const session = new Session(undefined, '', world, { encounter, mission, events, loadouts: 'class',
    brainTree: buildTree('friendly', createBrainRegistry()), ...(opts.noNav ? {} : { navMesh: mesh }),
    ...(opts.campaign ? { campaign: opts.campaign } : {}), onCampaignSave: (state) => saves.push(structuredClone(state)),
  });
  sessions.push(session);
  let now = 0;
  let tick = 0;
  const players: { client: ClientConnection; pair: ReturnType<typeof createLoopbackPair>; seen: Message[]; request: number; resume: string; buttons: number }[] = [];
  const settle = () => { for (let i = 0; i < 3; i++) players.forEach((p) => p.pair.settle()); };
  const join = (slot = 0, resume = '') => {
    const pair = createLoopbackPair(); session.addConnection(pair.a, now);
    const seen: Message[] = [];
    const client = new ClientConnection(pair.b, { onSupplyProgress: (m) => seen.push(m), onSupplies: (m) => seen.push(m), onOrderFailed: (m) => seen.push(m) });
    const player = { client, pair, seen, request: 0, resume: '', buttons: 0 };
    pair.b.onMessage((bytes) => { const msg = decodeMessage(bytes); if (msg.kind === 'JoinAck') player.resume = msg.resume; });
    players.push(player);
    client.send({ kind: 'Join', version: PROTOCOL_VERSION, name: `p${slot}`, room: '', slot, ...(resume ? { resume } : {}) });
    settle(); return player;
  };
  const say = (p: ReturnType<typeof join>, message: Message) => { p.client.send(message); settle(); };
  const select = (p: ReturnType<typeof join>, cacheId = 'upper', item: SupplyItem | null = KIT, requestId = ++p.request) =>
    say(p, { kind: 'CommanderSupplySelect', requestId, slot: 1, cacheId, item });
  const step = (count = 1, each?: () => void) => {
    for (let i = 0; i < count; i++) {
      tick++; now += TICK_SECONDS * 1000;
      for (const p of players) if (p.pair.b.isOpen) {
        p.client.send({ kind: 'Ping', id: tick, clientTime: now });
        p.client.send({ kind: 'Input', tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: p.buttons });
      }
      settle(); session.step(now); settle(); each?.();
    }
  };
  const place = (slot: number, at = START) => { session.slots[slot]!.state = createMoveState(at.x, at.y, at.z); };
  session.slots.forEach((slot) => place(slot.index, { x: -26 + slot.index * 1.5, y: 0, z: -26 }));
  place(1); session.slots[1]!.kits = 0;
  const progress = (p: ReturnType<typeof join>) => p.seen.filter((m): m is Extract<Message, { kind: 'SupplyProgress' }> => m.kind === 'SupplyProgress').at(-1)?.uses ?? [];
  const stock = (id = 'upper') => session.supplyCaches.find((cache) => cache.id === id)!.stock;
  const x = session as unknown as Internals;
  const until = (done: () => boolean, max = 30 * 30, each?: () => void) => {
    for (let i = 0; i < max && !done(); i++) step(1, each);
    expect(done(), 'condition must complete within the bounded travel window').toBe(true);
  };
  return { session, join, say, select, step, place, progress, stock, saves, x, settle, until };
}

describe('commanded supply travel on actual stacked floors (U-147)', () => {
  it('passes beneath the cache without using it, climbs the authored stairs and collects after 30 valid ticks', () => {
    const r = room(); const p = r.join(); const bot = r.session.slots[1]!;
    r.select(p); expect(r.progress(p)).toMatchObject([{ slot: 1, cacheId: 'upper', percent: 0 }]);
    let passedUnder = false;
    let climbedStairs = false;
    r.until(() => r.x.supplyUses.get(1)?.ticks === 1, 30 * 30, () => {
      if (bot.state.y < 1) {
        passedUnder ||= Math.hypot(bot.state.x - upper.x, bot.state.z - upper.z) < .5;
        expect(r.x.supplyUses.get(1)?.ticks).toBe(0);
        expect(r.progress(p)[0]?.percent).toBe(0);
      }
      climbedStairs ||= bot.state.x > 8 && bot.state.x < 18 && bot.state.y > 1 && bot.state.y < 7;
      expect(bot.kits).toBe(0); expect(r.stock().healthKits).toBe(3);
    });
    expect(passedUnder).toBe(true); expect(climbedStairs).toBe(true);
    expect(bot.state.y).toBeCloseTo(8, 1);
    expect(Math.hypot(bot.state.x - upper.x, bot.state.y - upper.y, bot.state.z - upper.z)).toBeLessThanOrEqual(2);
    const at = { x: bot.state.x, y: bot.state.y, z: bot.state.z };
    r.step(28); expect(r.x.supplyUses.get(1)?.ticks).toBe(29); expect(bot.kits).toBe(0);
    expect({ x: bot.state.x, y: bot.state.y, z: bot.state.z }).toEqual(at);
    r.step(); expect(bot.kits).toBe(1); expect(r.stock().healthKits).toBe(2); expect(r.progress(p)).toEqual([]);
    expect(r.session.supplyCaches.find((cache) => cache.id === 'upper')!.feet).toEqual(upper);
    r.step(60); expect(r.stock().healthKits).toBe(2);
  });

  it.each(['disconnected bridge', 'no navmesh'] as const)('fails safely for %s and reports the failed supply movement', (why) => {
    const r = room({ noNav: why === 'no navmesh' }); const p = r.join();
    const cache = why === 'disconnected bridge' ? 'bridge' : 'upper';
    r.select(p, cache); r.step(6);
    expect(r.progress(p)).toEqual([]); expect(r.session.slots[1]!.kits).toBe(0); expect(r.stock(cache).healthKits).toBe(3);
    expect(r.session.orderReports).toContainEqual(expect.objectContaining({ slot: 1, order: 'move', outcome: 'failed', reason: expect.stringContaining('supply') }));
    expect(p.seen.filter((m) => m.kind === 'OrderFailed')).toEqual([{ kind: 'OrderFailed', slot: 1, order: 'move' }]);
    r.place(1, CACHES.find((candidate) => candidate.id === cache)!.feet); r.step(35);
    expect(r.session.slots[1]!.kits).toBe(0); expect(r.stock(cache).healthKits).toBe(3);
  });

  it('walks around a wall to the accessible side and starts no timer through blocked LOS', () => {
    const r = room(); const p = r.join(); const bot = r.session.slots[1]!;
    r.place(1, { x: -12, y: 0, z: 7 }); r.select(p, 'wall');
    expect(r.progress(p)).toMatchObject([{ cacheId: 'wall', percent: 0 }]);
    let roundedWall = false;
    r.until(() => r.x.supplyUses.get(1)?.ticks === 1, 30 * 10, () => {
      roundedWall ||= bot.state.x < -15 || bot.state.x > -9;
      if (bot.state.x > -15 && bot.state.x < -9 && bot.state.z < 8) expect(r.x.supplyUses.get(1)?.ticks).toBe(0);
      expect(r.stock('wall').healthKits).toBe(3);
    });
    expect(roundedWall).toBe(true);
    r.step(29); expect(bot.kits).toBe(1); expect(r.stock('wall').healthKits).toBe(2);
  });

  it('fails stalled travel within a bounded window instead of retrying the supply path forever', () => {
    const r = room(); const p = r.join(); const bot = r.session.slots[1]!;
    r.select(p);
    // Reset feet to simulate blocked movement while real PathFollower planning and stuck detection run.
    r.until(() => !r.x.supplyUses.has(1), 120, () => {
      r.place(1);
      if (r.x.supplyUses.has(1)) expect(r.x.supplyUses.get(1)?.ticks).toBe(0);
      expect(bot.kits).toBe(0); expect(r.stock().healthKits).toBe(3);
    });
    expect(r.session.orderReports.filter((report) => report.slot === 1)).toEqual([
      expect.objectContaining({ order: 'move', outcome: 'failed', reason: expect.stringContaining('supply') }),
    ]);
    expect(p.seen.filter((message) => message.kind === 'OrderFailed')).toEqual([{ kind: 'OrderFailed', slot: 1, order: 'move' }]);
    r.place(1, upper); r.step(35); expect(bot.kits).toBe(0); expect(r.stock().healthKits).toBe(3);
    expect(p.seen.filter((message) => message.kind === 'OrderFailed')).toHaveLength(1);
  });

  it('replaces a travelling selection and ignores replayed IDs for both the old selection and cancel', () => {
    const r = room(); const p = r.join(); const bot = r.session.slots[1]!;
    r.select(p); r.step(12); r.select(p, 'other');
    expect(r.progress(p)).toMatchObject([{ cacheId: 'other', percent: 0 }]);
    r.select(p, 'upper', KIT, 1); r.select(p, 'other', null, 2);
    expect(r.progress(p)).toMatchObject([{ cacheId: 'other', percent: 0 }]);
    r.until(() => bot.kits === 1);
    expect(r.stock('other').healthKits).toBe(2); expect(r.stock().healthKits).toBe(3);
    expect(bot.state.y).toBeCloseTo(0, 1);
    bot.kits = 0; r.place(1, upper); r.step(35); expect(bot.kits).toBe(0); expect(r.stock().healthKits).toBe(3);
  });

  it.each(['cancel', 'ordinary order', 'assignment', 'view', 'takeover', 'downed', 'capture', 'drop', 'restore', 'legacy restore', 'retry', 'restart'] as const)(
    'clears travelling intent on %s so returning to the cache cannot resume it', (why) => {
      const r = room(); const p = r.join(); const observer = r.join(3); const bot = r.session.slots[1]!;
      r.x.captureMissionCheckpoint(); const saved = parseCheckpointWorld(r.saves.at(-1)!.checkpoint!.world)!;
      r.select(p); r.step(12);
      expect(r.progress(observer)).toMatchObject([{ slot: 1, cacheId: 'upper', percent: 0 }]);
      expect(Math.hypot(bot.state.x - START.x, bot.state.z - START.z)).toBeGreaterThan(.5);
      if (why === 'cancel') {
        expect(r.x.followers[1]).not.toBeNull(); expect(bot.input.moveY).toBeGreaterThan(0);
        r.select(p, 'upper', null);
        expect(bot.input).toMatchObject({ moveX: 0, moveY: 0, interact: false, firing: false });
        expect(r.x.followers[1]).toBeNull();
      }
      if (why === 'ordinary order') r.say(p, { kind: 'Order', address: { to: 'slot', index: 1 }, order: 'hold', point: null, target: null });
      if (why === 'assignment') r.say(observer, { kind: 'AssignCommander', bot: 1, commander: 3 });
      if (why === 'view') r.say(p, { kind: 'SwitchCharacter', slot: 2, spectate: true });
      if (why === 'takeover') { const taker = r.join(1); taker.pair.b.close('left'); r.settle(); }
      if (why === 'downed') Object.assign(bot.health, { current: 0, downedAt: r.session.tick / 30 });
      if (why === 'capture') expect(r.session.captureCharacter(1, { x: -20, y: 0, z: -20 })).toBe(true);
      if (why === 'drop') { const resume = p.resume; p.pair.b.close('network lost'); r.settle(); r.join(0, resume); }
      if (why === 'restore' || why === 'legacy restore') {
        if (why === 'legacy restore') delete saved.caches;
        expect(r.x.restoreCheckpointWorld(saved)).toBe(true);
      }
      if (why === 'retry') r.session.retryMission(true);
      if (why === 'restart') r.session.restartMission();
      r.step(); expect(r.progress(observer)).toEqual([]); expect(r.x.supplyUses.has(1)).toBe(false);
      if (why === 'capture') expect(r.session.freeCharacter(1)).toBe(true);
      Object.assign(bot.health, { current: bot.health.max, downedAt: null, diedAt: null }); bot.kits = 0;
      r.place(1, upper); r.step(35);
      expect(bot.kits).toBe(0); expect(r.stock().healthKits).toBe(3); expect(r.progress(observer)).toEqual([]);
    },
  );

  it('does not reserve stock during travel and cancels when desktop held-E use depletes the final kit', () => {
    const r = room({ lastKit: true }); const commander = r.join(); const desktop = r.join(3); const bot = r.session.slots[1]!;
    r.place(3, { ...upper, z: upper.z - .6 }); r.session.slots[3]!.kits = 0;
    r.select(commander);
    r.say(desktop, { kind: 'SupplySelect', requestId: 1, cacheId: 'upper', item: KIT }); r.step(5);
    expect(r.stock().healthKits).toBe(1); expect(r.session.slots[3]!.kits).toBe(0);
    desktop.buttons = 8; r.step(30);
    expect(r.session.slots[3]!.kits).toBe(1); expect(bot.kits).toBe(0); expect(r.stock().healthKits).toBe(0);
    r.step(); expect(r.progress(commander)).toEqual([]);
    r.place(1, upper); r.step(35); expect(bot.kits).toBe(0); expect(r.stock().healthKits).toBe(0);
  });

  it.each(['damage', 'suppression', 'full capacity'] as const)('interrupts approach immediately for %s and never resumes after recovery', (why) => {
    const r = room(); const p = r.join(); const bot = r.session.slots[1]!;
    r.select(p); r.step(12); expect(r.x.supplyUses.get(1)?.ticks).toBe(0);
    if (why === 'damage') { bot.health.current -= 1; bot.lastDamagedAt = r.session.tick * TICK_SECONDS; }
    if (why === 'suppression') raiseSuppression(bot.suppression, 1, r.session.tick * TICK_SECONDS);
    if (why === 'full capacity') bot.kits = 3;
    r.step(); expect(r.x.supplyUses.has(1)).toBe(false); expect(r.progress(p)).toEqual([]); expect(r.stock().healthKits).toBe(3);
    r.step(150); bot.kits = 0; bot.lastDamagedAt = -Infinity; r.place(1, upper); r.step(35);
    expect(bot.kits).toBe(0); expect(r.stock().healthKits).toBe(3);
  });

  it('releases travelling supply control for a locked shell so the normal friendly brain can evade it', () => {
    const r = room(); const p = r.join(); const bot = r.session.slots[1]!;
    r.select(p); r.step(6);
    const id = r.session.spawnEnemy('tank', { x: -24, y: 0, z: 2, tree: buildTree('idle', createBrainRegistry()) })!;
    const tank = r.session.enemies.find((enemy) => enemy.netId === id)!;
    tank.tell = { until: r.session.tick * TICK_SECONDS + 5, netId: bot.netId, point: { x: bot.state.x, y: bot.state.y, z: bot.state.z } };
    r.step(); expect(r.x.supplyUses.has(1)).toBe(false); expect(r.progress(p)).toEqual([]);
    r.step(3); expect(bot.brain!.read('dodge')).not.toBeNull(); expect(bot.brain!.intent?.pace).toBe('sprint');
    expect(bot.kits).toBe(0); expect(r.stock().healthKits).toBe(3);
    tank.tell = null; Object.assign(tank.health, { current: 0, downedAt: null, diedAt: r.session.tick * TICK_SECONDS });
    r.place(1, upper); r.step(35); expect(bot.kits).toBe(0); expect(r.stock().healthKits).toBe(3);
  });

  it('refuses travel that would suppress the bot own needed kit healing', () => {
    const r = room(); const p = r.join(); const bot = r.session.slots[1]!;
    bot.kits = 1; bot.health.current = 25; bot.weaponState.ammo = 0;
    r.select(p, 'upper', AMMO); expect(r.x.supplyUses.has(1)).toBe(false); expect(r.progress(p)).toEqual([]);
    r.step(3); expect(bot.brain!.read('useKit')).toBe(true); expect(bot.kitProgress).toBeGreaterThan(0);
    expect(r.stock().primaryAmmoUnits).toBe(4800); expect(bot.weaponState.ammo).toBe(0);
  });

  it('owns the bot hands during travel and collection without starting kit healing or generic revive interaction', () => {
    const r = room(); const p = r.join(); const bot = r.session.slots[1]!;
    bot.kits = 1; bot.health.current = 50; bot.weaponState.ammo = 0;
    r.place(2, { ...upper, x: upper.x + 1 }); Object.assign(r.session.slots[2]!.health, { current: 0, downedAt: 1 });
    r.select(p, 'upper', AMMO);
    r.until(() => r.x.supplyUses.get(1)?.ticks === 1, 30 * 30, () => {
      expect(bot.kitProgress).toBe(0); expect(bot.kits).toBe(1); expect(bot.health.current).toBe(50);
      expect(r.session.slots[2]!.reviveBySlot).toBe(-1); expect(bot.input.interact).toBe(false);
    });
    r.step(28); expect(bot.weaponState.ammo).toBe(0); expect(bot.kitProgress).toBe(0); expect(bot.health.current).toBe(50);
    expect(r.session.slots[2]!.reviveBySlot).toBe(-1);
    r.step(); expect(bot.weaponState.ammo).toBe(bot.weapon.magSize); expect(r.stock().healthKits).toBe(3);
  });

  it('restores a saved travelling session without replaying transient selection or restoring a supply path', () => {
    const r = room(); const p = r.join(); r.select(p); r.step(12); r.x.captureMissionCheckpoint();
    const saved = JSON.parse(JSON.stringify(r.saves.at(-1)!)) as CampaignState;
    const resumed = room({ campaign: saved }); const back = resumed.join(); const bot = resumed.session.slots[1]!;
    expect(resumed.x.supplyUses.size).toBe(0); expect(resumed.progress(back)).toEqual([]);
    resumed.place(1, upper); bot.kits = 0; resumed.step(35);
    expect(bot.kits).toBe(0); expect(resumed.stock().healthKits).toBe(3);
  });
});
