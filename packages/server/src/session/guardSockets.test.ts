import { describe, expect, it } from 'vitest';
import { loadWorld, requireWorld, parseEncounter, parseMission, parseEventScript, TICK_SECONDS } from '@sandline/shared';
import { Session } from './Session.ts';
import { parseCheckpointWorld } from './checkpointWorld.ts';
import type { CampaignState } from '../persistence/CampaignDatabase.ts';
import { Spawner, type SpawnerHost } from '../ai/director/spawner.ts';
import { yawToward } from '../ai/locomotion/followPath.ts';

const world = loadWorld({ id: 'guard-sockets', floor: { halfExtent: 100 }, cover: [
  { id: 'slab', x: 0, y: 5.5, z: 0, w: 80, d: 80, h: 2.5 },
  { id: 'bridge', x: 0, y: 14, z: 0, w: 80, d: 80, h: 2 },
], mission: { ...requireWorld('greybox-01').mission!, spawnZones: [{ id: 'unused-zone', on: 'objective', x: 50, z: 50, radius: 1 }] } });
const sockets = Array.from({ length: 32 }, (_, i) => ({ id: `G${i}`, archetype: i < 30 ? 'rifleman' : 'mg', feet: { x: (i % 8) * 3 - 12, y: [0, 8, 16][i % 3]!, z: Math.floor(i / 8) * 4 - 10 }, face: { x: 0, z: -30 } }));
const raw = { world: world.id, aliveCap: 38, probes: [1], areas: {}, groups: [{ id: 'guards', zone: 'unused-zone', members: [{ archetype: 'rifleman', count: 15 }, { archetype: 'rifleman', count: 15 }, { archetype: 'mg', count: 2 }], posture: { kind: 'hold' }, trigger: { kind: 'start' }, sockets }] };
const encounter = parseEncounter(raw, () => world);
const mission = parseMission({ id: world.id, world: world.id, respawn: false, objectives: [{ type: 'survive', label: 'Wait', seconds: 3600 }] });
const events = parseEventScript({ world: world.id, blockers: [], events: [{ id: 'start', trigger: { kind: 'time', seconds: 0 }, actions: [{ kind: 'spawn-group', group: 'guards' }] }] }, encounter, world, mission);
function play(humans = 1, campaign?: CampaignState) {
  const saves: CampaignState[] = [];
  const session = new Session(undefined, '', world, { encounter, mission, events, testHumanCount: humans, ...(campaign ? { campaign } : {}), onCampaignSave: (c) => saves.push(c) });
  let now = 0;
  const step = (n = 1) => { for (let i = 0; i < n; i++) session.step(now += TICK_SECONDS * 1000); };
  return { session, saves, step, capture: () => (session as unknown as { captureMissionCheckpoint(): void }).captureMissionCheckpoint() };
}
function host(extra: Partial<SpawnerHost> = {}) {
  const at: Parameters<SpawnerHost['spawn']>[1][] = [];
  const living = new Set<number>();
  const h: SpawnerHost = { humanEyes: () => [], squadFeet: () => [], enemyFeet: () => [], isAlive: (id) => living.has(id), spawn: (_a, p) => { at.push(p); living.add(at.length); return at.length; }, ...extra };
  return { h, at, living };
}
describe('fixed guard socket lifecycle (U-129)', () => {
  it.each([1, 6])('places 32 exact mixed-archetype guards at budget %s', (humans) => {
    const m = play(humans); m.step();
    expect(m.session.enemies).toHaveLength(32);
    for (const s of sockets) {
      const e = m.session.enemies.find((e) => e.spawnId === s.id)!;
      expect(e.def.id).toBe(s.archetype);
      expect(e.posture!.post).toEqual(s.feet);
      expect(e.posture!.face).toEqual(s.face);
      expect(e.state.y).toBeCloseTo(s.feet.y, 4);
      expect(e.yaw).toBe(yawToward(s.face.x - s.feet.x, s.face.z - s.feet.z));
    }
    m.step(30); expect(m.session.enemies).toHaveLength(32);
  });
  it('retains identity/position/facing and dead membership through durable reload and retry', () => {
    const m = play(); m.step();
    const dead = m.session.enemies[0]!;
    dead.health.current = 0; dead.health.diedAt = 0;
    const moved = m.session.enemies[1]!; moved.state.x += 1; moved.yaw = 1234;
    m.capture();
    const state = JSON.parse(JSON.stringify(m.saves.at(-1))) as CampaignState;
    const saved = parseCheckpointWorld(state.checkpoint!.world)!;
    expect(saved.enemies).toHaveLength(31);
    expect(saved.enemies.map((e) => e.spawnId)).not.toContain(dead.spawnId);
    m.session.retryMission(true); m.step();
    expect(m.session.enemies).toHaveLength(31);
    expect(m.session.enemies.some((e) => e.spawnId === dead.spawnId)).toBe(false);
    const reloaded = play(6, state);
    expect(reloaded.session.enemies).toHaveLength(31);
    const restored = reloaded.session.enemies.find((e) => e.spawnId === moved.spawnId)!;
    expect(restored.state.x).toBe(moved.state.x);
    expect(restored.yaw).toBe(1234);
    expect(restored.posture).toEqual(moved.posture);
    reloaded.step(10); expect(reloaded.session.enemies).toHaveLength(31);
    m.session.restartMission(); m.step(); expect(m.session.enemies).toHaveLength(32);
  });
  it('preserves queued identities through JSON spawner restore and never relocates an occupied socket', () => {
    let occupied = true;
    const original = host({ enemyFeet: () => occupied ? [sockets[0]!.feet] : [] });
    const sp = new Spawner(encounter, world, original.h);
    sp.step(0); expect(original.at).toHaveLength(31);
    expect(sp.checkpoint().queue[0]!.socketId).toBe('G0');
    const saved = JSON.parse(JSON.stringify(sp.checkpoint()));
    const next = host();
    const resumed = new Spawner(encounter, world, next.h);
    resumed.restore(saved, new Map()); occupied = false;
    resumed.step(1); resumed.step(2);
    expect(next.at).toHaveLength(1);
    expect(next.at[0]!.spawnId).toBe('G0');
    expect({ x: next.at[0]!.x, y: next.at[0]!.y, z: next.at[0]!.z }).toEqual(sockets[0]!.feet);
    saved.queue[0].socketId = 'unknown'; expect(() => resumed.restore(saved, new Map())).toThrow(/invalid queued socket/);
  });
  it('uses nav only to validate, retains exact authored y despite nav offsets and fails missing floors', () => {
    const h = host({ ground: (p) => ({ ...p, y: p.y + .05 }) });
    const sp = new Spawner(encounter, world, h.h); sp.step(0);
    expect(h.at.map((a) => a.y)).toEqual(sockets.map((s) => s.feet.y));
    const bad = host({ ground: (p) => p.y === 8 ? { ...p, y: 16 } : p });
    expect(() => new Spawner(encounter, world, bad.h)).toThrow(/authored floor/);
    expect(() => new Spawner(encounter, world, host({ ground: () => null }).h)).toThrow(/navigable/);
    expect(() => new Spawner(encounter, world, host({ ground: (p) => ({ ...p, x: p.x + 1 }) }).h)).toThrow(/navigable/);
  });
  it('refuses duplicate/malformed checkpoint IDs and accepts old checkpoints without them', () => {
    const m = play(); m.step(); m.capture();
    const saved = JSON.parse(JSON.stringify(m.saves.at(-1)!.checkpoint!.world));
    const old = structuredClone(saved); old.enemies.forEach((e: { spawnId?: string }) => delete e.spawnId);
    expect(parseCheckpointWorld(old)).not.toBeNull();
    saved.enemies[1].spawnId = saved.enemies[0].spawnId;
    expect(parseCheckpointWorld(saved)).toBeNull();
    saved.enemies[1].spawnId = 'bad/name'; expect(parseCheckpointWorld(saved)).toBeNull();
    const id = m.session.enemies[0]!.spawnId!;
    expect(() => m.session.spawnEnemy('rifleman', { x: 50, y: 0, z: 50, spawnId: id })).toThrow(/duplicate/);
  });
});
