import { describe, expect, it } from 'vitest';
import {
  ClientConnection, createLoopbackPair, createMoveState, decodeMessage, getWeapon, loadWorld, parseEncounter, parseEventScript,
  PROTOCOL_VERSION, PROJECTILE_IDS, requireWorld, TICK_SECONDS, type Message, type MissionDef, type SupplyItem,
} from '@sandline/shared';
import { Session, MAX_INPUT_REPEAT } from './Session.ts';
import { parseCheckpointWorld, type CheckpointWorld } from './checkpointWorld.ts';
import { CampaignDatabase, type CampaignState } from '../persistence/CampaignDatabase.ts';
import type { NavMesh } from '../ai/nav/NavMesh.ts';

const world = loadWorld({ id: 'supply-test', floor: { halfExtent: 100 }, cover: [
  { id: 'wall', x: 0, y: 0, z: 3.5, w: 6, d: .2, h: 2.4 },
  { id: 'deck', x: 20, y: 7, z: 0, w: 12, d: 12, h: 1 },
  { id: 'low-deck', x: 40, y: 1.3, z: 0, w: 12, d: 12, h: .2 },
], mission: requireWorld('greybox-01').mission! });
const encounter = parseEncounter({ world: world.id, aliveCap: 4, probes: [1], areas: {}, groups: [
  { id: 'g', members: [{ archetype: 'rifleman', count: 1 }], zone: 'behind-objective', posture: { kind: 'hold' }, trigger: { kind: 'script' } },
] }, () => world);
const mission: MissionDef = { id: world.id, world: world.id, respawn: false, objectives: [{ type: 'survive', label: 'Wait', seconds: 3600 }] };
const STOCK = { projectiles: { frag: 4, rocket: 3 }, healthKits: 3, primaryMagazines: 2 };
type AuthoredCache = { id: string; feet: { x: number; y: number; z: number }; stock: unknown };
const CACHES: AuthoredCache[] = [
  { id: 'open', feet: { x: 0, y: 0, z: 0 }, stock: STOCK },
  { id: 'wall', feet: { x: 0, y: 0, z: 3 }, stock: STOCK },
  { id: 'deck', feet: { x: 20, y: 8, z: 0 }, stock: STOCK },
  { id: 'low-deck', feet: { x: 40, y: 1.5, z: 0 }, stock: STOCK },
  { id: 'empty', feet: { x: -10, y: 0, z: 0 }, stock: {} },
];
const KIT: SupplyItem = { kind: 'health-kit' };
const AMMO: SupplyItem = { kind: 'primary-ammo' };
const ROCKET: SupplyItem = { kind: 'projectile', projectile: 'rocket' };
const E = 0b1000;
interface Internals {
  captureMissionCheckpoint(): void;
  restoreCheckpointWorld(saved: CheckpointWorld): boolean;
  eventRun: { reset(): void };
  placePickupItem(weapon: number, ammo: number, at: { x: number; y: number; z: number }, yaw: number): void;
}

function room(opts: { campaign?: CampaignState; caches?: AuthoredCache[]; navMesh?: NavMesh; mission?: MissionDef; lobby?: boolean } = {}) {
  const saves: CampaignState[] = [];
  const def = opts.mission ?? mission;
  const script = parseEventScript({ world: world.id, blockers: [], supplyCaches: opts.caches ?? CACHES,
    events: [{ id: 'hello', trigger: { kind: 'time', seconds: 0 }, actions: [{ kind: 'message', text: 'Ready' }] }],
  }, encounter, world, def);
  const session = new Session(undefined, '', world, { encounter, mission: def, events: script, loadouts: 'class',
    ...(opts.campaign ? { campaign: opts.campaign } : {}), ...(opts.navMesh ? { navMesh: opts.navMesh } : {}),
    ...(opts.lobby ? { roomLobby: true } : {}), onCampaignSave: (s) => saves.push(s),
  });
  let now = 0;
  let tick = 0;
  const players: { client: ClientConnection; pair: ReturnType<typeof createLoopbackPair>; seen: Message[]; buttons: number; request: number; silent: boolean; resume: string; resumed: boolean }[] = [];
  const settle = () => { for (let i = 0; i < 3; i++) players.forEach((p) => p.pair.settle()); };
  const join = (slot = 0, resume = '') => {
    const pair = createLoopbackPair();
    session.addConnection(pair.a, now);
    const seen: Message[] = [];
    const client = new ClientConnection(pair.b, { onSupplies: (m) => seen.push(m), onSupplyProgress: (m) => seen.push(m) });
    const p = { client, pair, seen, buttons: 0, request: 0, silent: false, resume: '', resumed: false };
    pair.b.onMessage((bytes) => { const msg = decodeMessage(bytes); if (msg.kind === 'JoinAck') { p.resume = msg.resume; p.resumed = msg.resumed; } });
    players.push(p);
    client.send({ kind: 'Join', version: PROTOCOL_VERSION, name: `s${slot}`, room: '', slot, ...(resume ? { resume } : {}) });
    settle();
    return p;
  };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      tick++;
      now += TICK_SECONDS * 1000;
      for (const p of players) if (p.pair.b.isOpen && !p.silent) p.client.send({ kind: 'Input', tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: p.buttons });
      settle(); session.step(now); settle();
    }
  };
  const place = (slot: number, x = 0, y = 0, z = -1) => { session.slots[slot]!.state = createMoveState(x, y, z); };
  // Keep idle squad bodies clear of every test cache and interaction.
  session.slots.forEach((s) => place(s.index, -60 + s.index * 3, 0, -60));
  const select = (p: ReturnType<typeof join>, cacheId = 'open', item: SupplyItem | null = KIT, requestId = ++p.request) => {
    p.client.send({ kind: 'SupplySelect', requestId, cacheId, item }); settle();
  };
  const stock = (id = 'open') => session.supplyCaches.find((c) => c.id === id)!.stock;
  const progress = (p: ReturnType<typeof join>) => p.seen.filter((m): m is Extract<Message, { kind: 'SupplyProgress' }> => m.kind === 'SupplyProgress').at(-1)!.uses;
  const x = session as unknown as Internals;
  return { session, join, select, step, place, stock, progress, saves, x, settle };
}

describe('authoritative finite cache use (U-133)', () => {
  it.each([[0, 30], [2, 24]])('times slot %s for %s uninterrupted ticks, transfers one chosen type and consumes no more while held', (slot, duration) => {
    const r = room(); const p = r.join(slot); const s = r.session.slots[slot]!;
    r.place(slot); s.kits = 0; s.health.current = 50;
    p.buttons = E; r.step(30); expect(s.kits).toBe(0); // E alone chooses nothing.
    r.select(p); expect(r.progress(p)[0]?.percent).toBe(0);
    r.step(duration - 1); expect(s.kits).toBe(0); expect(r.progress(p)[0]?.percent).toBeGreaterThan(80);
    r.step(); expect(s.kits).toBe(1); expect(s.health.current).toBe(50);
    expect(r.stock().healthKits).toBe(2); expect(r.stock().projectiles).toEqual(STOCK.projectiles);
    expect(r.progress(p)).toEqual([]); r.step(60); expect(s.kits).toBe(1);
  });

  it('refills only compatible equipment and the held primary, using current capacity at completion', () => {
    const r = room(); const p = r.join(1); const s = r.session.slots[1]!; r.place(1);
    s.pouch[PROJECTILE_IDS.indexOf('rocket')] = 0; p.buttons = E; r.select(p, 'open', ROCKET); r.step(30);
    expect(s.pouch[1]).toBe(2); expect(r.stock().projectiles.rocket).toBe(1);
    r.select(p, 'open', AMMO); expect(r.progress(p)).toEqual([]); // Full magazine costs no time.
    s.weaponState.ammo = 0; r.select(p, 'open', AMMO); r.step(20);
    s.weaponState.ammo = s.weapon.magSize - 1; r.step(10);
    expect(s.weaponState.ammo).toBe(s.weapon.magSize);
    expect(r.stock().primaryAmmoUnits).toBe(4800 - 2400 / s.weapon.magSize);
    s.kits = 0; r.select(p); r.step(20); s.kits = 3; r.step(10);
    expect(r.stock().healthKits).toBe(3); expect(r.progress(p)).toEqual([]);
  });

  it.each([
    ['out of range', 'open', 0, 0, -2.01],
    ['through a wall', 'wall', 0, 0, 4.4],
    ['on the floor below', 'deck', 20, 0, 0],
    ['on a different close floor', 'low-deck', 40, 0, 0],
  ] as const)('rejects use %s without a timer or stock cost', (_label, id, x, y, z) => {
    const r = room(); const p = r.join(); r.place(0, x, y, z); r.session.slots[0]!.kits = 0;
    r.select(p, id); expect(r.progress(p)).toEqual([]); p.buttons = E; r.step(31);
    expect(r.stock(id).healthKits).toBe(3); expect(r.session.slots[0]!.kits).toBe(0);
  });

  it('uses exact authored elevated feet and LOS on the accessible side', () => {
    const r = room(); const p = r.join(); const s = r.session.slots[0]!;
    r.place(0, 20, 8, -1); s.kits = 0; r.select(p, 'deck'); p.buttons = E; r.step(30);
    expect(s.kits).toBe(1); expect(r.stock('deck').healthKits).toBe(2);
    expect(r.session.supplyCaches.find((c) => c.id === 'deck')!.feet).toEqual(CACHES[2]!.feet);
    p.buttons = 0; r.step(); r.place(0, 0, 0, 2.3); s.kits = 0; r.select(p, 'wall'); p.buttons = E; r.step(30);
    expect(s.kits).toBe(1); expect(r.stock('wall').healthKits).toBe(2);
  });

  it('rejects missing, empty, full and incompatible choices immediately, including a pistol or equipment in hand', () => {
    const r = room(); const p = r.join(); const s = r.session.slots[0]!; r.place(0);
    r.select(p, 'missing'); expect(r.progress(p)).toEqual([]);
    r.select(p, 'open', ROCKET); expect(r.progress(p)).toEqual([]);
    r.select(p); expect(r.progress(p)).toEqual([]); // All three kits already carried.
    s.kits = 0; r.place(0, -10, 0, -1); r.select(p, 'empty'); expect(r.progress(p)).toEqual([]);
    r.place(0); s.weapon = getWeapon('sidearm'); s.weaponState.ammo = 0; r.select(p, 'open', AMMO); expect(r.progress(p)).toEqual([]);
    s.weapon = getWeapon(s.primary!); s.heldProjectile = 0; r.select(p, 'open', AMMO); expect(r.progress(p)).toEqual([]);
    p.buttons = E; r.step(35); expect(r.stock().healthKits).toBe(3); expect(s.kits).toBe(0);
  });

  it.each(['release', 'distance', 'wall', 'downed', 'silence', 'cancel', 'choice'] as const)('cancels on %s and never commits the interrupted preview', (why) => {
    const r = room(); const p = r.join(); const s = r.session.slots[0]!;
    const id = why === 'wall' ? 'wall' : 'open';
    r.place(0, 0, 0, why === 'wall' ? 2.3 : -1); s.kits = 0; r.select(p, id); p.buttons = E; r.step(15);
    expect(r.progress(p)[0]?.percent).toBe(50);
    if (why === 'release') p.buttons = 0;
    if (why === 'distance') r.place(0, 0, 0, -4);
    if (why === 'wall') r.place(0, 0, 0, 4.4);
    if (why === 'downed') Object.assign(s.health, { current: 0, downedAt: 1 });
    if (why === 'silence') p.silent = true;
    if (why === 'cancel') r.select(p, id, null);
    if (why === 'choice') r.select(p, 'open', { kind: 'projectile', projectile: 'frag' }); // Full frag capacity.
    r.step(MAX_INPUT_REPEAT + 1); expect(r.progress(p)).toEqual([]);
    expect(s.kits).toBe(0); expect(r.stock(id).healthKits).toBe(3);
    p.silent = false; p.buttons = E; r.place(0); r.step(35);
    expect(s.kits).toBe(0); // Returning or pressing again needs a fresh selection.
  });

  it('serializes simultaneous users of the final stock, broadcasts exhausted scenery, and ignores replayed requests', () => {
    const r = room({ caches: [{ ...CACHES[0]!, stock: { healthKits: 1 } }] });
    const a = r.join(0); const b = r.join(1); r.place(0, -.6); r.place(1, .6);
    for (const p of [a, b]) { r.session.slots[p.client.slot]!.kits = 0; r.select(p); p.buttons = E; }
    r.step(30);
    expect(r.session.slots[0]!.kits + r.session.slots[1]!.kits).toBe(1);
    expect(r.stock().healthKits).toBe(0); expect(r.session.supplyCaches).toHaveLength(1);
    for (const p of [a, b]) {
      expect(p.seen.filter((m) => m.kind === 'Supplies').at(-1)).toMatchObject({ full: false, caches: [{ id: 'open', stock: { healthKits: 0 } }] });
      expect(r.progress(p)).toEqual([]);
      r.select(p, 'open', KIT, 1); r.step(30);
    }
    expect(r.session.slots[0]!.kits + r.session.slots[1]!.kits).toBe(1);
  });

  it('rejects stale selection IDs after completion even when capacity and stock are available again', () => {
    const r = room(); const p = r.join(); const s = r.session.slots[0]!; r.place(0); s.kits = 0;
    r.select(p); p.buttons = E; r.step(30); s.kits = 0;
    r.select(p, 'open', KIT, 1); r.step(30); expect(s.kits).toBe(0); expect(r.stock().healthKits).toBe(2);
    r.select(p, 'open', KIT, 2); r.step(30); expect(s.kits).toBe(1); expect(r.stock().healthKits).toBe(1);
  });

  it.each(['frag', 'ammo'] as const)('serializes competing %s transfers against the remaining exact stock', (kind) => {
    const r = room({ caches: [{ ...CACHES[0]!, stock: kind === 'frag' ? { projectiles: { frag: 2 } } : { primaryMagazines: 1 } }] });
    const a = r.join(0); const b = r.join(1); r.place(0, -.6); r.place(1, .6);
    for (const p of [a, b]) {
      const s = r.session.slots[p.client.slot]!; s.pouch[0] = 0; s.weaponState.ammo = 0;
      r.select(p, 'open', kind === 'frag' ? { kind: 'projectile', projectile: 'frag' } : AMMO); p.buttons = E;
    }
    r.step(30);
    if (kind === 'frag') {
      expect(r.session.slots[0]!.pouch[0]! + r.session.slots[1]!.pouch[0]!).toBe(2); expect(r.stock().projectiles.frag).toBe(0);
    } else {
      expect(r.session.slots[0]!.weaponState.ammo).toBe(r.session.slots[0]!.weapon.magSize);
      expect(r.session.slots[1]!.weaponState.ammo).toBe(0); expect(r.stock().primaryAmmoUnits).toBe(0);
    }
  });

  it('keeps actual per-client traffic under 18 KiB/s with 64 caches, maximum ID lengths and six simultaneous users', () => {
    const caches = Array.from({ length: 64 }, (_, i) => ({ id: `${i}`.padEnd(64, 'a'), feet: { x: -40 + (i % 8) * 10, y: 0, z: -30 + Math.floor(i / 8) * 3 }, stock: STOCK }));
    const r = room({ caches }); const players = Array.from({ length: 6 }, (_, i) => r.join(i));
    players.forEach((p, i) => { r.place(i, caches[i]!.feet.x, 0, -31); r.session.slots[i]!.kits = 0; });
    const offsets = players.map((p) => p.pair.a.sent.length);
    players.forEach((p, i) => { r.select(p, caches[i]!.id); p.buttons = E; }); r.step(30);
    players.forEach((p, i) => {
      const bytes = p.pair.a.sent.slice(offsets[i]).reduce((n, packet) => n + packet.data.length, 0);
      expect(bytes).toBeLessThan(18 * 1024);
      expect(r.session.slots[i]!.kits).toBe(1);
    });
  });

  it('keeps revive, weapon pickup and upload priorities ahead of cache use', () => {
    for (const kind of ['revive', 'pickup', 'upload', 'rescue'] as const) {
      const def: MissionDef = kind === 'upload' ? { ...mission, objectives: [{ type: 'upload', label: 'Terminal', terminal: { x: 0, y: 1, z: 0 }, reachM: 2, seconds: 100, onInterrupt: 'keep-progress' }] } : kind === 'rescue' ? { ...mission, objectives: [{ type: 'rescue', label: 'Prisoner', holdSeconds: 5, reachM: 2, slot: 3 }] } : mission;
      const r = room({ mission: def }); const p = r.join(); const s = r.session.slots[0]!; r.place(0); s.kits = 0;
      if (kind === 'revive') { r.place(1, 1); Object.assign(r.session.slots[1]!.health, { current: 0, downedAt: 1 }); }
      if (kind === 'pickup') r.x.placePickupItem(0, 3, { x: 0, y: 0, z: 0 }, 0);
      if (kind === 'rescue') expect(r.session.captureCharacter(3, { x: 1, y: 0, z: -1 })).toBe(true);
      r.select(p); p.buttons = E; r.step(31);
      expect(s.kits, kind).toBe(0); expect(r.stock().healthKits, kind).toBe(3); expect(r.progress(p), kind).toEqual([]);
      if (kind === 'revive') expect(r.session.slots[1]!.reviveBySlot).toBe(0);
      if (kind === 'pickup') expect(r.session.pickups.every((p) => p.ammo !== 3)).toBe(true);
      if (kind === 'upload') expect(r.session.mission!.phase).toBe('active');
      if (kind === 'rescue') expect(r.session.mission!.progress).toBeGreaterThan(0);
    }
  });

  it('cancels on departure/spectate, and reconnect neither resumes a hold nor replenishes spent stock', () => {
    const r = room(); const a = r.join(); const watcher = r.join(1); const s = r.session.slots[0]!; r.place(0); s.kits = 0;
    r.select(a); a.buttons = E; r.step(30); r.select(a); r.step(15);
    const resume = a.resume; a.pair.b.close('network lost'); r.settle();
    expect(r.progress(watcher)).toEqual([]);
    const back = r.join(0, resume); expect(back.resumed).toBe(true);
    const supplies = back.seen.find((m): m is Extract<Message, { kind: 'Supplies' }> => m.kind === 'Supplies')!;
    expect(supplies.caches.find((c) => c.id === 'open')!.stock.healthKits).toBe(2);
    expect(r.progress(back)).toEqual([]); r.step(30); expect(s.kits).toBe(1);
    r.select(back); back.buttons = E; r.step(10);
    expect(r.session.paused).toBe(false);
    expect(back.client.state).toBe('active');
    back.client.send({ kind: 'SwitchCharacter', slot: 3, spectate: true }); r.settle();
    expect(r.progress(watcher)).toEqual([]); r.select(back); r.step(30);
    expect(r.stock().healthKits).toBe(2);
  });

  it('restores paired stocks/inventories through retries and a JSON database host reload; restart alone rebuilds authored stock', () => {
    const r = room(); const p = r.join(1); const s = r.session.slots[1]!; r.place(1); s.kits = 0; s.pouch[1] = 0;
    p.buttons = E; r.select(p); r.step(30); r.select(p, 'open', ROCKET); r.step(30);
    s.weaponState.ammo = 0; r.select(p, 'open', AMMO); r.step(30);
    r.x.captureMissionCheckpoint();
    const saved = JSON.parse(JSON.stringify(r.saves.at(-1))) as CampaignState;
    const worldSaved = parseCheckpointWorld(saved.checkpoint!.world)!;
    expect(worldSaved.caches?.find((c) => c.id === 'open')!.stock).toMatchObject({ healthKits: 2, projectiles: { rocket: 1 }, primaryAmmoUnits: 2400 });
    r.select(p); r.step(30); expect(r.stock().healthKits).toBe(1);
    for (let i = 0; i < 3; i++) {
      r.session.retryMission(true); r.step();
      expect(r.stock().healthKits).toBe(2); expect(s.kits).toBe(1); expect(s.pouch[1]).toBe(2);
      expect(s.weaponState.ammo).toBe(s.weapon.magSize); expect(r.stock().primaryAmmoUnits).toBe(2400);
      r.x.eventRun.reset(); r.step(); expect(r.stock().projectiles.rocket).toBe(1);
    }
    const db = new CampaignDatabase(':memory:');
    try {
      const created = db.createCampaign('owner', world.id); db.saveCampaign(created.code, saved);
      const loaded = room({ campaign: db.loadCampaign(created.code)!.state });
      for (let i = 0; i < 3; i++) {
        loaded.x.restoreCheckpointWorld(worldSaved);
        expect(loaded.stock()).toEqual(r.stock()); expect(loaded.session.slots[1]!.kits).toBe(1); expect(loaded.session.slots[1]!.pouch[1]).toBe(2);
        expect(loaded.session.slots[1]!.weaponState.ammo).toBe(s.weapon.magSize);
      }
      loaded.session.restartMission(); expect(loaded.stock().healthKits).toBe(3); expect(loaded.stock().projectiles.rocket).toBe(3);
      expect(loaded.session.slots[1]!.kits).toBe(3); // Original mission-start inventory, never checkpoint-spent stock.
    } finally { db.close(); }
    const old = structuredClone(saved); delete (old.checkpoint!.world as CheckpointWorld).caches;
    expect(() => room({ campaign: old })).not.toThrow();
  });

  it('refuses malformed/unmatched stock before restoring paired inventories and accepts legacy worlds', () => {
    const r = room(); r.x.captureMissionCheckpoint(); const state = r.saves.at(-1)!;
    const saved = JSON.parse(JSON.stringify(state.checkpoint!.world)) as CheckpointWorld;
    const legacy = structuredClone(saved); delete legacy.caches; expect(parseCheckpointWorld(legacy)).not.toBeNull();
    expect(parseCheckpointWorld({ ...saved, slots: saved.slots.slice(0, 5) })).toBeNull();
    for (const caches of [[saved.caches![0], saved.caches![0]], [{ id: 'open', stock: { projectiles: {}, healthKits: -1, primaryAmmoUnits: 0 } }], [{ id: 'bad/id', stock: saved.caches![0]!.stock }]]) {
      expect(parseCheckpointWorld({ ...saved, caches })).toBeNull();
    }
    saved.caches![0] = { ...saved.caches![0]!, stock: { ...saved.caches![0]!.stock, healthKits: 4 } };
    const s = r.session.slots[0]!; s.kits = 0;
    expect(() => r.x.restoreCheckpointWorld(saved)).toThrow(/stock does not match/); expect(s.kits).toBe(0);
    expect(() => room({ campaign: { ...state, checkpoint: { ...state.checkpoint!, world: { ...saved, caches: [] } } } })).toThrow(/stock does not match/);
  });

  it('refuses unsupported/obstructed floors and nav projections to another storey, while retaining exact authored feet', () => {
    for (const feet of [{ x: -20, y: 8, z: 0 }, { x: 0, y: 0, z: 3.5 }]) {
      expect(() => room({ caches: [{ id: 'bad', feet, stock: STOCK }] })).toThrow(/unsupported or obstructed/);
    }
    const cache = CACHES[2]!;
    const mesh = (dy: number) => ({ nearestPoint: (p: { x: number; y: number; z: number }) => ({ point: { ...p, y: p.y + dy } }) }) as unknown as NavMesh;
    expect(() => room({ caches: [cache], navMesh: mesh(8) })).toThrow(/authored floor/);
    expect(room({ caches: [cache], navMesh: mesh(.05) }).session.supplyCaches[0]!.feet).toEqual(cache.feet);
  });
});
