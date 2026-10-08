/** U-146: real loopback commands resupply nearby autonomous soldiers without possessed input. */
import { describe, expect, it } from 'vitest';
import {
  buildTree, ClientConnection, createLoopbackPair, createMoveState, decodeMessage, loadWorld, parseCampaign, parseEncounter,
  parseEventScript, PROTOCOL_VERSION, PROJECTILE_IDS, requireWorld, TICK_SECONDS, type Message, type MissionDef, type SupplyItem,
} from '@sandline/shared';
import { createBrainRegistry } from '../ai/Brain.ts';
import { type CampaignState, newCampaignState } from '../persistence/CampaignDatabase.ts';
import { parseCheckpointWorld, type CheckpointWorld } from './checkpointWorld.ts';
import { Session } from './Session.ts';

const world = loadWorld({ id: 'commander-supplies', mapRevision: 2, floor: { halfExtent: 100 }, cover: [
  { id: 'wall', x: 0, y: 0, z: 3.5, w: 6, d: .2, h: 2.4 },
  { id: 'deck', x: 20, y: 7, z: 0, w: 12, d: 12, h: 1 },
  { id: 'low-deck', x: 40, y: 1.3, z: 0, w: 12, d: 12, h: .2 },
], mission: requireWorld('greybox-01').mission! });
const encounter = parseEncounter({ world: world.id, aliveCap: 4, probes: [1], areas: {}, groups: [
  { id: 'unused', members: [{ archetype: 'rifleman', count: 1 }], zone: 'behind-objective', posture: { kind: 'hold' }, trigger: { kind: 'script' } },
] }, () => world);
const mission: MissionDef = { id: world.id, world: world.id, respawn: false, objectives: [{ type: 'survive', label: 'Wait', seconds: 3600 }] };
const KIT: SupplyItem = { kind: 'health-kit' };
const AMMO: SupplyItem = { kind: 'primary-ammo' };
const ROCKET: SupplyItem = { kind: 'projectile', projectile: 'rocket' };
const STOCK = { projectiles: { frag: 4, rocket: 3 }, healthKits: 3, primaryMagazines: 2 };
const CACHES = [
  { id: 'open', feet: { x: 0, y: 0, z: 0 }, stock: STOCK },
  { id: 'wall', feet: { x: 0, y: 0, z: 3 }, stock: STOCK },
  { id: 'deck', feet: { x: 20, y: 8, z: 0 }, stock: STOCK },
  { id: 'low-deck', feet: { x: 40, y: 1.5, z: 0 }, stock: STOCK },
  { id: 'empty', feet: { x: -10, y: 0, z: 0 }, stock: {} },
];
interface Internals {
  captureMissionCheckpoint(): void;
  restoreCheckpointWorld(saved: CheckpointWorld): boolean;
  supplyUses: Map<number, unknown>;
}

function room(opts: { lobby?: boolean; campaign?: CampaignState; mission?: MissionDef; lastKit?: boolean } = {}) {
  const def = opts.mission ?? mission;
  const saves: CampaignState[] = [];
  const events = parseEventScript({ world: world.id, blockers: [], supplyCaches: opts.lastKit ? [{ ...CACHES[0]!, stock: { healthKits: 1 } }] : CACHES,
    events: [{ id: 'ready', trigger: { kind: 'time', seconds: 0 }, actions: [{ kind: 'message', text: 'Ready' }] }],
  }, encounter, world, def);
  const session = new Session(undefined, '', world, { encounter, mission: def, events, loadouts: 'class',
    brainTree: buildTree('friendly', createBrainRegistry()), roomLobby: opts.lobby ?? false,
    ...(opts.campaign ? { campaign: opts.campaign, campaignDef: parseCampaign({ id: 'supply-test', missions: [world.id, 'next'].map((id) => ({
      mission: id, title: id, briefing: ['Begin'], debrief: ['Done'],
    })) }, () => true) } : {}), onCampaignSave: (s) => saves.push(structuredClone(s)),
  });
  let now = 0;
  let tick = 0;
  const people: { client: ClientConnection; pair: ReturnType<typeof createLoopbackPair>; seen: Message[]; request: number; resume: string; buttons: number }[] = [];
  const settle = () => { for (let i = 0; i < 3; i++) people.forEach((p) => p.pair.settle()); };
  const join = (slot = 0, resume = '') => {
    const pair = createLoopbackPair();
    session.addConnection(pair.a, now);
    const seen: Message[] = [];
    const client = new ClientConnection(pair.b, { onSupplyProgress: (m) => seen.push(m), onSupplies: (m) => seen.push(m) });
    const p = { client, pair, seen, request: 0, resume: '', buttons: 0 };
    pair.b.onMessage((bytes) => { const msg = decodeMessage(bytes); if (msg.kind === 'JoinAck') p.resume = msg.resume; });
    people.push(p);
    client.send({ kind: 'Join', version: PROTOCOL_VERSION, name: `p${slot}`, room: '', slot, ...(resume ? { resume } : {}) });
    settle(); return p;
  };
  const send = (p: ReturnType<typeof join>, msg: Message) => { p.client.send(msg); settle(); };
  const select = (p: ReturnType<typeof join>, slot = 1, cacheId = 'open', item: SupplyItem | null = KIT, requestId = ++p.request) =>
    send(p, { kind: 'CommanderSupplySelect', requestId, slot, cacheId, item });
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      tick++; now += TICK_SECONDS * 1000;
      for (const p of people) if (p.pair.b.isOpen) {
        p.client.send({ kind: 'Ping', id: tick, clientTime: now });
        p.client.send({ kind: 'Input', tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: p.buttons });
      }
      settle(); session.step(now); settle();
    }
  };
  const place = (slot: number, x = 0, y = 0, z = -1) => { session.slots[slot]!.state = createMoveState(x, y, z); };
  session.slots.forEach((s) => place(s.index, -60 + s.index * 3, 0, -60));
  const stock = (id = 'open') => session.supplyCaches.find((c) => c.id === id)!.stock;
  const progress = (p: ReturnType<typeof join>) => p.seen.filter((m): m is Extract<Message, { kind: 'SupplyProgress' }> => m.kind === 'SupplyProgress').at(-1)!.uses;
  const x = session as unknown as Internals;
  return { session, join, send, select, step, place, stock, progress, settle, saves, x };
}

describe('nearby commander supply authority (U-146)', () => {
  it.each([[1, 30], [2, 24]])('resupplies slot %s after %s ticks without commander E, moving the connection, healing or repeating', (slot, duration) => {
    const r = room(); const p = r.join(); const s = r.session.slots[slot]!; r.place(slot); s.kits = 0; s.health.current = 50;
    const issuer = r.session.slots[0]!.connection;
    r.select(p, slot); expect(r.progress(p)).toMatchObject([{ slot, cacheId: 'open', percent: 0 }]);
    const at = { x: s.state.x, y: s.state.y, z: s.state.z };
    r.step(duration - 1); expect(s.kits).toBe(0); expect(r.progress(p)[0]!.percent).toBeGreaterThan(80);
    r.step(); expect(s.kits).toBe(1); expect(s.health.current).toBe(50);
    expect({ x: s.state.x, y: s.state.y, z: s.state.z }).toEqual(at);
    expect(r.stock().healthKits).toBe(2); expect(r.stock().projectiles).toEqual(STOCK.projectiles);
    expect(r.progress(p)).toEqual([]); expect(s.isBot).toBe(true); expect(s.connection).toBeNull();
    expect(r.session.slots[0]!.connection).toBe(issuer); r.step(1); expect(r.stock().healthKits).toBe(2);
  });

  it('retains command authority in spectator view, including the issuer own autonomous soldier, without owning watched humans', () => {
    const r = room(); const p = r.join(); const other = r.join(3);
    r.place(0); r.place(1, 1); r.session.slots[0]!.kits = 0; r.session.slots[1]!.kits = 0; r.session.slots[3]!.kits = 0;
    r.send(p, { kind: 'SwitchCharacter', slot: 3, spectate: true });
    r.select(p, 3); expect(r.progress(p)).toEqual([]);
    r.select(p, 0); r.step(30); expect(r.session.slots[0]!.kits).toBe(1);
    r.select(p, 1); r.step(30); expect(r.session.slots[1]!.kits).toBe(1);
    expect(r.session.slots[3]!.kits).toBe(0); expect(r.session.slots[0]!.connection).not.toBeNull();
    expect(r.progress(other)).toEqual([]);
  });

  it('refuses an unowned bot, active human and possessed own soldier without changing inventory or another issuer use', () => {
    const r = room(); const a = r.join(); const b = r.join(3); r.place(4); r.place(3, 1); r.session.slots[4]!.kits = 0;
    r.send(a, { kind: 'AssignCommander', bot: 4, commander: 3 });
    r.select(b, 4); r.step(15); expect(r.progress(b)[0]!.percent).toBe(50);
    r.select(a, 4); r.select(a, 4, 'open', null); r.select(a, 0); r.select(a, 3);
    expect(r.progress(a)[0]!.percent).toBe(50); r.step(15);
    expect(r.session.slots[4]!.kits).toBe(1); expect(r.stock().healthKits).toBe(2);
  });

  it('preserves class/fireteam command reach even when a cross-fireteam bot is assigned to the issuer', () => {
    const r = room(); const p = r.join(3); r.place(1, -.6); r.place(4, .6);
    r.session.slots[1]!.kits = 0; r.session.slots[4]!.kits = 0;
    expect(r.session.commanderOf(1)).toBe(3); expect(r.session.commanderOf(4)).toBe(3);
    r.send(p, { kind: 'Order', address: { to: 'slot', index: 1 }, order: 'hold', point: null, target: null });
    expect(r.session.orderFor(1)).toBeNull(); r.select(p, 1); expect(r.progress(p)).toEqual([]);
    r.select(p, 4); r.step(30); expect(r.session.slots[4]!.kits).toBe(1);
    expect(r.session.slots[1]!.kits).toBe(0); expect(r.stock().healthKits).toBe(2);
  });

  it.each([
    ['out of range', 'open', 0, 0, -2.01], ['blocked LOS', 'wall', 0, 0, 4.4],
    ['floor below', 'deck', 20, 0, 0], ['close wrong floor', 'low-deck', 40, 0, 0],
  ] as const)('rejects nearby use %s without accepting progress or spending stock', (_why, cache, x, y, z) => {
    const r = room(); const p = r.join(); r.place(1, x, y, z); r.session.slots[1]!.kits = 0;
    r.select(p, 1, cache); expect(r.progress(p)).toEqual([]); r.step(35);
    expect(r.stock(cache).healthKits).toBe(3); expect(r.session.slots[1]!.kits).toBe(0);
  });

  it('uses elevated intended-floor stock and refills only the selected rocket or partial primary magazine', () => {
    const r = room(); const p = r.join(); const s = r.session.slots[1]!; r.place(1, 20, 8, -1);
    s.pouch[PROJECTILE_IDS.indexOf('rocket')] = 0; r.select(p, 1, 'deck', ROCKET); r.step(30);
    expect(s.pouch[PROJECTILE_IDS.indexOf('rocket')]).toBe(2); expect(r.stock('deck').projectiles.rocket).toBe(1);
    s.weaponState.ammo = s.weapon.magSize - 1; r.select(p, 1, 'deck', AMMO); r.step(30);
    expect(s.weaponState.ammo).toBe(s.weapon.magSize); expect(r.stock('deck').primaryAmmoUnits).toBe(4800 - 2400 / s.weapon.magSize);
    expect(r.stock('deck').healthKits).toBe(3);
  });

  it('rejects missing, full, empty and incompatible selections without replacing an existing ordinary order', () => {
    const r = room(); const p = r.join(); r.place(1);
    r.send(p, { kind: 'Order', address: { to: 'slot', index: 1 }, order: 'hold', point: null, target: null });
    for (const [id, item] of [['missing', KIT], ['open', KIT], ['open', AMMO]] as const) r.select(p, 1, id, item);
    r.place(1, -10); r.session.slots[1]!.kits = 0; r.select(p, 1, 'empty');
    r.place(1); r.session.slots[1]!.equipment = -1; r.select(p, 1, 'open', ROCKET);
    expect(r.progress(p)).toEqual([]); expect(r.session.orderFor(1)?.order).toBe('hold'); expect(r.stock().healthKits).toBe(3);
  });

  it.each(['cancel', 'distance', 'LOS', 'downed', 'dead', 'capture', 'full', 'ordinary order', 'assignment', 'view', 'takeover'] as const)(
    'cancels an active use on %s and never resumes the interrupted timer', (why) => {
      const r = room(); const p = r.join(); const second = r.join(3); const s = r.session.slots[1]!;
      const cache = why === 'LOS' ? 'wall' : 'open'; r.place(1, 0, 0, why === 'LOS' ? 2.3 : -1); s.kits = 0;
      r.select(p, 1, cache); r.step(15); expect(r.progress(p)[0]!.percent).toBe(50);
      if (why === 'cancel') r.select(p, 1, cache, null);
      if (why === 'distance') r.place(1, 0, 0, -4);
      if (why === 'LOS') r.place(1, 0, 0, 4.4);
      if (why === 'downed') Object.assign(s.health, { current: 0, downedAt: 1 });
      if (why === 'dead') { s.health.current = 0; s.health.downedAt = null; s.health.diedAt = 1; }
      if (why === 'capture') expect(r.session.captureCharacter(1, { x: 20, y: 0, z: 20 })).toBe(true);
      if (why === 'full') s.kits = 3;
      if (why === 'ordinary order') r.send(p, { kind: 'Order', address: { to: 'slot', index: 1 }, order: 'hold', point: null, target: null });
      if (why === 'assignment') r.send(second, { kind: 'AssignCommander', bot: 1, commander: 3 });
      if (why === 'view') r.send(p, { kind: 'SwitchCharacter', slot: 2, spectate: true });
      if (why === 'takeover') r.join(1);
      r.step(); expect(r.progress(second)).toEqual([]); expect(r.stock(cache).healthKits).toBe(3);
      r.place(1); r.step(31); expect(r.progress(second)).toEqual([]); expect(r.stock(cache).healthKits).toBe(3);
    },
  );

  it('a valid supply selection replaces the standing order; replacement and cancellation IDs cannot replay', () => {
    const r = room(); const p = r.join(); const s = r.session.slots[1]!; r.place(1); s.kits = 0;
    r.send(p, { kind: 'Order', address: { to: 'slot', index: 1 }, order: 'hold', point: null, target: null });
    r.select(p); expect(r.session.orderFor(1)).toBeNull(); expect(r.session.orderReports.at(-1)).toMatchObject({ outcome: 'replaced' });
    r.step(15); r.select(p, 1, 'open', null, 1); expect(r.progress(p)[0]!.percent).toBe(50);
    r.select(p, 1, 'open', null); expect(r.progress(p)).toEqual([]);
    r.select(p, 1, 'open', KIT, 1); r.step(31); expect(s.kits).toBe(0);
    r.select(p); r.step(30); expect(s.kits).toBe(1); s.kits = 0;
    r.select(p, 1, 'open', KIT, p.request); r.step(31); expect(s.kits).toBe(0); expect(r.stock().healthKits).toBe(2);
  });

  it('serializes commanded bots and desktop humans competing for the final stock; desktop still requires held E', () => {
    const r = room({ lastKit: true }); const a = r.join(); const b = r.join(3);
    r.place(1, -.6); r.place(3, .6); r.session.slots[1]!.kits = 0; r.session.slots[3]!.kits = 0;
    r.send(b, { kind: 'SupplySelect', requestId: 1, cacheId: 'open', item: KIT }); r.step(5);
    expect(r.progress(b)).toMatchObject([{ slot: 3, percent: 0 }]); expect(r.stock().healthKits).toBe(1);
    r.select(a); b.buttons = 8; r.step(30);
    expect(r.session.slots[1]!.kits).toBe(1); expect(r.session.slots[3]!.kits).toBe(0);
    expect(r.stock().healthKits).toBe(0); expect(r.progress(a)).toEqual([]); expect(r.progress(b)).toEqual([]);
    expect(a.seen.filter((m) => m.kind === 'Supplies').at(-1)).toMatchObject({ full: false, caches: [{ id: 'open', stock: { healthKits: 0 } }] });
  });

  it.each(['leave', 'drop'] as const)('clears all requests on commander %s; reconnect does not restart a timer or refill stock', (why) => {
    const r = room(); const a = r.join(); const observer = r.join(3); r.place(1); r.place(2, 1);
    r.session.slots[1]!.kits = 0; r.session.slots[2]!.kits = 0; r.select(a, 1); r.select(a, 2); r.step(10);
    const resume = a.resume;
    if (why === 'leave') r.send(a, { kind: 'Disconnect', code: 'left', reason: 'left' });
    else { a.pair.b.close('network lost'); r.settle(); }
    expect(r.progress(observer)).toEqual([]);
    const back = r.join(0, why === 'drop' ? resume : ''); r.step(35);
    expect(r.progress(back)).toEqual([]); expect(r.stock().healthKits).toBe(3); expect(r.session.slots[1]!.kits).toBe(0);
  });

  it('clears transient commands on checkpoint restore/retry and preserves paired spent stock/inventory', () => {
    const r = room(); const p = r.join(); const s = r.session.slots[1]!; r.place(1); s.kits = 0;
    r.select(p); r.step(30); r.x.captureMissionCheckpoint();
    const saved = parseCheckpointWorld(r.saves.at(-1)!.checkpoint!.world)!;
    r.select(p); r.step(10); expect(r.progress(p)).toHaveLength(1);
    expect(r.x.restoreCheckpointWorld(saved)).toBe(true); r.step(); expect(r.progress(p)).toEqual([]);
    expect(s.kits).toBe(1); expect(r.stock().healthKits).toBe(2);
    r.select(p); r.step(10); r.session.retryMission(true); r.step();
    expect(r.progress(p)).toEqual([]); expect(s.kits).toBe(1); expect(r.stock().healthKits).toBe(2);
    r.select(p); r.step(10); r.session.restartMission(); r.step();
    expect(r.progress(p)).toEqual([]); expect(r.stock().healthKits).toBe(3);
  });

  it('legacy restores without cache data cancel self and commander selections without replenishing stock', () => {
    const r = room(); const p = r.join(); const desktop = r.join(3); const bot = r.session.slots[1]!;
    r.place(1, -.6); r.place(3, .6); bot.kits = 0; r.session.slots[3]!.kits = 0;
    r.select(p); r.step(30); r.x.captureMissionCheckpoint();
    const saved = parseCheckpointWorld(r.saves.at(-1)!.checkpoint!.world)!; delete saved.caches;
    r.select(p); r.send(desktop, { kind: 'SupplySelect', requestId: 1, cacheId: 'open', item: KIT }); desktop.buttons = 8;
    r.step(10); expect(r.progress(p)).toHaveLength(2);
    r.x.restoreCheckpointWorld(saved); r.step(); expect(r.progress(p)).toEqual([]);
    r.step(31); expect(r.stock().healthKits).toBe(2); expect(bot.kits).toBe(1); expect(r.session.slots[3]!.kits).toBe(0);
  });

  it('mission handoff closes the connections and clears all issuer-owned commands before another tick', () => {
    const campaign = newCampaignState(world.id); campaign.completedMissions = [world.id];
    const r = room({ campaign }); const p = r.join(); r.place(1); r.session.slots[1]!.kits = 0;
    r.select(p); r.step(10); expect(r.progress(p)).toHaveLength(1);
    r.send(p, { kind: 'RoomCommand', command: 'choose', mission: 'next', run: 'campaign' });
    expect(p.client.state).toBe('closed'); expect(r.x.supplyUses.size).toBe(0);
    expect(r.stock().healthKits).toBe(3); expect(r.saves.at(-1)!.world).toBe('next');
  });

  it('refuses lobby and incompatible-map requests without progressing or rewriting the refused checkpoint', () => {
    const lobby = room({ lobby: true }); const waiting = lobby.join(); lobby.place(1); lobby.session.slots[1]!.kits = 0;
    lobby.select(waiting); lobby.step(31); expect(lobby.progress(waiting)).toEqual([]); expect(lobby.stock().healthKits).toBe(3);
    const r = room(); r.x.captureMissionCheckpoint(); const saved = structuredClone(r.saves.at(-1)!); saved.checkpoint!.mapRevision = 1;
    const restored = room({ campaign: saved }); const p = restored.join(); restored.place(1); restored.session.slots[1]!.kits = 0;
    restored.select(p); restored.step(31); expect(restored.progress(p)).toEqual([]); expect(restored.session.tick).toBe(0);
    expect(restored.saves).toEqual([]); expect(saved.checkpoint!.mapRevision).toBe(1); expect(restored.stock().healthKits).toBe(3);
  });

  it.each(['complete', 'failed'] as const)('ends outstanding use when the mission becomes %s', (outcome) => {
    const def = outcome === 'complete' ? { ...mission, objectives: [{ type: 'survive' as const, label: 'Short', seconds: .5 }] } : mission;
    const r = room({ mission: def }); const p = r.join(); r.place(1); r.session.slots[1]!.kits = 0; r.select(p);
    if (outcome === 'failed') { const health = r.session.slots[2]!.health; health.current = 0; health.diedAt = 0; health.downedAt = null; }
    r.step(31); expect(r.session.mission!.state).toBe(outcome); expect(r.progress(p)).toEqual([]); expect(r.stock().healthKits).toBe(3);
    r.select(p); expect(r.progress(p)).toEqual([]);
  });
});
