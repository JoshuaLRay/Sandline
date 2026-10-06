import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ClientConnection, createLoopbackPair, createMoveState, decodeMessage, getProjectile, loadWorld, parseEncounter,
  parseEventScript, parseMission, PROJECTILE_IDS, PROTOCOL_VERSION, requireWorld, SnapshotStore, TICK_SECONDS, type WorldSnapshot,
} from '@sandline/shared';
import { Session, type EnemyEntity } from '../../../server/src/session/Session.ts';
import { parseCheckpointWorld } from '../../../server/src/session/checkpointWorld.ts';
import type { CampaignState } from '../../../server/src/persistence/CampaignDatabase.ts';
import { initNav, NavMesh } from '../../../server/src/ai/nav/NavMesh.ts';
import { Brain } from '../../../server/src/ai/Brain.ts';
import { bakeWorld } from './bake.ts';

const world = loadWorld({ id: 'staged-reserves', floor: { halfExtent: 45 }, cover: [
  { id: 'surface', x: 0, y: 5.5, z: 0, w: 88, d: 88, h: 2.5 },
  { id: 'upper', x: -20, y: 14, z: -15, w: 55, d: 40, h: 2 },
], squadStarts: Array.from({ length: 6 }, (_, i) => ({ x: -40 + i * 2, y: 8, z: -40 })),
mission: { ...requireWorld('greybox-01').mission!, spawnZones: [{ id: 'z', on: 'objective', x: 44, z: 44, radius: .1 }] } });
const guards = Array.from({ length: 32 }, (_, i) => ({ id: `G${i}`, archetype: i < 30 ? 'rifleman' : 'mg',
  feet: { x: -30 + i % 8 * 3, y: [0, 8, 16][i % 3]!, z: -20 + Math.floor(i / 8) * 3 }, face: { x: -40, z: -40 } }));
const reserves = Array.from({ length: 4 }, (_, i) => ({ id: `C${i + 1}`, archetype: 'rifleman',
  feet: { x: i * 4, y: 8, z: 20 }, face: { x: i * 4, z: 0 }, combatRegion: 'outpost',
  advance: [{ x: i * 4, y: 8, z: 20 }, { x: i * 4, y: 8, z: 14 }, { x: i * 4, y: 8, z: 8 }] }));
const tank = { id: 'T', archetype: 'tank', feet: { x: 30, y: 8, z: 20 }, face: { x: 30, z: 0 } };
const pow = { id: 'POW', archetype: 'pow', feet: { x: 20, y: 8, z: 20 }, face: { x: 20, z: 0 } };
const encounter = parseEncounter({ world: world.id, aliveCap: 42, probes: [1], areas: {},
  regions: { outpost: [{ minX: -1, maxX: 17, minZ: 6, maxZ: 25, minY: 7.7, maxY: 8.3 }] }, groups: [
    { id: 'guards', zone: 'z', members: [{ archetype: 'rifleman', count: 15 }, { archetype: 'rifleman', count: 15 }, { archetype: 'mg', count: 2 }], sockets: guards, posture: { kind: 'hold' }, trigger: { kind: 'start' } },
    { id: 'reserve', zone: 'z', members: [{ archetype: 'rifleman', count: 4 }], sockets: reserves, staged: true, posture: { kind: 'hold' }, trigger: { kind: 'script' } },
    { id: 'tank', zone: 'z', members: [{ archetype: 'tank', count: 1 }], sockets: [tank], staged: true, posture: { kind: 'hold' }, trigger: { kind: 'script' }, path: [{ x: 30, y: 8, z: 0 }] },
    { id: 'pow', zone: 'z', members: [{ archetype: 'pow', count: 1 }], sockets: [pow], captive: true, posture: { kind: 'hold' }, trigger: { kind: 'start' } },
  ] }, () => world);
const mission = parseMission({ id: world.id, world: world.id, respawn: false, objectives: [{ type: 'survive', label: 'Wait', seconds: 3600 }] });
const script = { world: world.id, blockers: [], events: [
  { id: 'tank-early', trigger: { kind: 'time', seconds: 5 }, actions: [{ kind: 'spawn-group', group: 'tank' }] },
  { id: 'tank-late', trigger: { kind: 'time', seconds: 20 }, actions: [{ kind: 'spawn-group', group: 'tank' }] },
  { id: 'reserves', trigger: { kind: 'time', seconds: 10 }, actions: [{ kind: 'spawn-group', group: 'reserve' }] },
] };
const events = parseEventScript(script, encounter, world, mission);
let mesh: NavMesh;
beforeAll(async () => { await initNav(); mesh = NavMesh.load(await bakeWorld(world)); }, 30_000);
afterAll(() => mesh.destroy());
function play(humans = 1, campaign?: CampaignState, lobby = false) {
  const saves: CampaignState[] = [];
  const session = new Session(undefined, '', world, { encounter, mission, events, navMesh: mesh,
    testHumanCount: humans, roomLobby: lobby, ...(campaign ? { campaign } : {}), onCampaignSave: (c) => saves.push(c) });
  // Initial guards only verify placement here; leave reserve/tank behaviour on their real trees.
  for (const e of session.enemies) if (e.spawnId?.startsWith('G')) e.brain = new Brain(e);
  let now = 0;
  const step = (n = 1) => { for (let i = 0; i < n; i++) { session.step(now += TICK_SECONDS * 1000); for (const s of session.slots) s.health.current = s.health.max; } };
  const capture = () => (session as unknown as { captureMissionCheckpoint(): void }).captureMissionCheckpoint();
  const saved = () => JSON.parse(JSON.stringify(saves.at(-1))) as CampaignState;
  const member = (id: string) => session.enemies.find((e) => e.spawnId === id)!;
  return { session, step, capture, saved, member, now: () => now };
}
function connect(m: ReturnType<typeof play>, resume = '') {
  const pair = createLoopbackPair(); const snapshots: WorldSnapshot[] = [];
  const store = new SnapshotStore(); let token = '';
  m.session.addConnection(pair.a, m.now());
  const client = new ClientConnection(pair.b, { onSnapshot: (s) => snapshots.push(s.snapshot) });
  pair.b.onMessage((bytes) => {
    const msg = decodeMessage(bytes);
    if (msg.kind === 'JoinAck') token = msg.resume;
    if (msg.kind === 'Delta') { const result = store.applyDelta(msg.tick, msg.baselineTick, msg.payload); if (result.ok && result.snapshot) snapshots.push(result.snapshot); }
  });
  client.send({ kind: 'Join', version: PROTOCOL_VERSION, name: 'fixture', room: '', resume }); pair.settle();
  const step = (n = 1) => { for (let i = 0; i < n; i++) { client.send({ kind: 'Input', tick: m.session.tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0 }); pair.settle(); m.step(); pair.settle(); } };
  return { pair, client, snapshots, step, token: () => token };
}
function blast(m: ReturnType<typeof play>, enemy: EnemyEntity, damage: number) {
  const def = { ...getProjectile('rocket'), blastDamage: damage, blastRadiusM: enemy.def.vehicle ? 5 : 1.5 };
  const at = { x: enemy.state.x, y: enemy.state.y + 1, z: enemy.state.z };
  const projectile = { netId: 60000, xpPlayerId: null, def, kind: PROJECTILE_IDS.indexOf('rocket'), ownerNetId: m.session.slots[0]!.netId, ownerSlot: 0, state: { ...at, vx: 0, vy: 0, vz: 0, age: 0, bounces: 0, resting: true } };
  (m.session as unknown as { detonate(p: unknown, at: { x: number; y: number; z: number }): void }).detonate(projectile, at);
}
describe('real staged reserve lifecycle (U-131)', () => {
  it.each([1, 6])('places the full 38-entity plan before input at budget %s and holds dormant members', (humans) => {
    const m = play(humans);
    expect(m.session.tick).toBe(0); expect(m.session.enemies).toHaveLength(38);
    for (const s of [...guards, ...reserves, tank, pow]) {
      const e = m.member(s.id); expect(e.state).toMatchObject(s.feet); expect(e.posture!.face).toEqual(s.face);
    }
    const staged = [...reserves, tank].map((s) => m.member(s.id));
    expect(staged.every((e) => e.inactive)).toBe(true);
    m.session.slots[0]!.state = createMoveState(0, 8, 12); // A visible, audible target does not wake reserves.
    m.step(120);
    for (const e of staged) {
      expect(e.state).toMatchObject(e.posture!.post); expect(e.speed).toBe(0); expect(e.target).toBeNull();
      expect(e.brain!.intent).toBeNull(); expect(e.brain!.fireAt).toBeNull(); expect(e.mounted).toBeNull();
    }
    expect(m.member('T').drive!.next).toBe(0); expect(m.member('T').tell).toBeNull();
    expect(m.session.spawner!.pending).toBe(0);
  });
  it('releases visible survivors with the same wire identities and follows one-way orders and the elevated tank path', () => {
    const m = play(); const c = connect(m);
    m.session.slots[0]!.state = createMoveState(0, 8, 12);
    c.step(3);
    const before = [...reserves, tank].map((s) => m.member(s.id).netId);
    expect(c.snapshots.at(-1)!.entities.map((e) => e.netId)).toEqual(expect.arrayContaining(before));
    const births = m.session.spawner!.log.length;
    const positions = reserves.map((s) => ({ ...m.member(s.id).state }));
    expect(m.session.spawner!.activate('reserve', .1)).toBe(true); // Watching the release cannot create a visible birth.
    expect(reserves.map((s) => m.member(s.id).state)).toEqual(positions);
    for (const s of m.session.slots) s.state = createMoveState(-40 + s.index * 2, 0, -40);
    c.step(650);
    expect(m.session.spawner!.log).toHaveLength(births); expect(m.session.enemies).toHaveLength(38);
    expect([...reserves, tank].map((s) => m.member(s.id).netId)).toEqual(before);
    for (const s of reserves) {
      expect(m.member(s.id).inactive).toBe(false);
      expect(m.member(s.id).state.z).toBeCloseTo(8, 0); // Advance once, without returning to its room.
    }
    expect(m.member('T').state.y).toBeCloseTo(8, 3); expect(m.member('T').state.z).toBeLessThan(15);
    expect(m.session.spawner!.activate('reserve', 30)).toBe(false);
    expect(m.session.spawner!.activate('tank', 30)).toBe(false);
  });
  it('takes ordinary hitscan and blast damage while dormant; pre-killed reserves/tank never return', () => {
    const m = play(); const c = connect(m); const reserve = m.member('C1');
    m.session.slots[0]!.state = createMoveState(0, 8, 12); m.step(3); c.pair.settle();
    const health = reserve.health.current;
    c.client.send({ kind: 'Fire', tick: m.session.tick, yaw: 0, pitch: 0, renderTimeMs: m.now(), weapon: 0, ads: true }); c.pair.settle();
    expect(reserve.health.current).toBeLessThan(health); expect(reserve.inactive).toBe(true);
    blast(m, reserve, 10000); blast(m, m.member('T'), 10000);
    expect(reserve.health.diedAt).not.toBeNull(); expect(m.member('T').health.diedAt).not.toBeNull();
    expect(m.session.spawner!.dead('tank')).toBe(true); expect(m.session.spawner!.fired('tank')).toBe(false);
    m.capture(); const saved = m.saved(); m.session.retryMission(true);
    expect(m.session.enemies.some((e) => e.spawnId === 'C1' || e.spawnId === 'T')).toBe(false);
    const loaded = play(6, saved); loaded.step(700);
    expect(loaded.session.enemies.some((e) => e.spawnId === 'C1' || e.spawnId === 'T')).toBe(false);
    expect(loaded.session.spawner!.spawnedBy('reserve')).toHaveLength(4);
    expect(loaded.session.spawner!.spawnedBy('tank')).toHaveLength(1);
    loaded.session.restartMission(); expect(loaded.session.enemies).toHaveLength(38); expect(loaded.member('T').inactive).toBe(true);
  });
  it('persists dormant survivors, pending timers and dead sentinels through repeated JSON reloads and retry', () => {
    const m = play(); blast(m, m.member('C1'), 10000); m.step(60); m.member('C2').health.current = 37;
    m.capture(); const saved = m.saved();
    const loaded = play(6, saved);
    expect(loaded.member('C2').inactive).toBe(true); expect(loaded.member('C2').health.current).toBe(37);
    loaded.capture(); const savedAgain = loaded.saved(); expect(parseCheckpointWorld(savedAgain.checkpoint!.world)).not.toBeNull();
    const twice = play(1, savedAgain); expect(twice.session.enemies.some((e) => e.spawnId === 'C1')).toBe(false);
    twice.step(60); expect(twice.member('T').inactive).toBe(true);
    twice.step(35); expect(twice.member('T').inactive).toBe(false); expect(twice.member('C2').inactive).toBe(true);
    twice.step(170); expect(twice.member('C2').inactive).toBe(false);
    twice.capture(); const active = twice.saved();
    twice.session.retryMission(true); const t = twice.member('T');
    const reloaded = play(6, active); expect(reloaded.member('T').drive).toEqual(t.drive);
    expect(reloaded.member('T').state).toMatchObject({ x: t.state.x, y: t.state.y, z: t.state.z });
    expect(reloaded.member('C2').posture!.leg).toBe(twice.member('C2').posture!.leg);
    expect(reloaded.member('C2').inactive).toBe(false); reloaded.step(600); expect(reloaded.session.spawner!.log).toHaveLength(0);
    const invalid = structuredClone(active.checkpoint!.world) as NonNullable<ReturnType<typeof parseCheckpointWorld>>;
    invalid.enemies[0]!.inactive = 'true' as unknown as boolean; expect(parseCheckpointWorld(invalid)).toBeNull();
  });
  it('ready-up and reconnect preserve one population and dormant state', () => {
    const m = play(1, undefined, true); expect(m.session.enemies).toHaveLength(0);
    const c = connect(m); c.client.send({ kind: 'RoomCommand', command: 'ready' }); c.pair.settle();
    c.client.send({ kind: 'RoomCommand', command: 'start' }); c.pair.settle();
    expect(m.session.enemies).toHaveLength(38); const ids = m.session.enemies.map((e) => e.netId);
    c.step(3); c.pair.b.close(); c.pair.settle();
    const next = connect(m, c.token()); next.step(3);
    expect(m.session.enemies.map((e) => e.netId)).toEqual(ids); expect(m.member('C1').inactive).toBe(true);
  });
  it('a destroy objective recognises an already-destroyed dormant tank before its release', () => {
    const m = play(); blast(m, m.member('T'), 10000);
    const objective = parseMission({ id: world.id, world: world.id, respawn: false, objectives: [{ type: 'destroy', group: 'tank', label: 'Destroy tank' }] });
    const saved = m.saved; m.capture();
    const session = new Session(undefined, '', world, { encounter, mission: objective, events: parseEventScript(script, encounter, world, objective), navMesh: mesh, campaign: saved() });
    session.step(TICK_SECONDS * 1000);
    expect(session.mission!.state).toBe('complete'); expect(session.enemies.some((e) => e.spawnId === 'T')).toBe(false);
  });
});
