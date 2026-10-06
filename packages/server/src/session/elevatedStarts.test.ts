import { describe, expect, it } from 'vitest';
import {
  COMPONENT_IDS,
  POSITION,
  TICK_SECONDS,
  type WorldSnapshot,
  type EnemyVehicle,
  loadWorld,
  parseEncounter,
  parseEventScript,
  parseMission,
  requireWorld,
  spawnFor,
  createLoopbackPair,
  ClientConnection,
  dequantize,
  withdrawDrive,
} from '@sandline/shared';
import { Spawner, type SpawnerHost } from '../ai/director/spawner.ts';
import { Session, type EnemyEntity } from './Session.ts';
import type { CampaignState } from '../persistence/CampaignDatabase.ts';
import { parseCheckpointWorld } from './checkpointWorld.ts';
import { resolveShot, type HitboxHistory } from '../net/lagComp.ts';

const starts = [-10, -6].flatMap((z) =>
  [-6, -2, 2].map((x) => ({ x, y: 8, z })),
);
const raw = () => ({
  id: 'elevated-start-test',
  floor: { halfExtent: 80 },
  squadStarts: starts,
  cover: [
    { id: 'road', x: 0, y: 5.5, z: 20, w: 40, d: 100, h: 2.5 },
    { id: 'bridge', x: 0, y: 12, z: 20, w: 40, d: 8, h: 4 },
  ],
  mission: {
    ...requireWorld('greybox-01').mission!,
    spawnZones: [
      { id: 'reserve', on: 'objective', x: 12, y: 8, z: 40, radius: 0.1 },
    ],
  },
});
const world = loadWorld(raw());
const encounter = parseEncounter(
  {
    world: world.id,
    aliveCap: 4,
    probes: [0.3, 1, 1.7],
    areas: {},
    groups: [
      {
        id: 'reserve',
        members: [{ archetype: 'rifleman', count: 1 }],
        zone: 'reserve',
        posture: { kind: 'hold' },
        trigger: { kind: 'time', seconds: 3600 },
      },
    ],
  },
  () => world,
);
const mission = parseMission({
  id: world.id,
  world: world.id,
  respawn: false,
  objectives: [{ type: 'survive', label: 'Wait', seconds: 3600 }],
});
const action = {
  kind: 'spawn-vehicle',
  vehicle: 'tank',
  x: 0,
  y: 8,
  z: 2,
  path: [{ x: 0, y: 8, z: 35 }],
};
const script = (a: object = action, w = world) =>
  parseEventScript(
    {
      world: w.id,
      blockers: [],
      events: [
        { id: 'tank', trigger: { kind: 'time', seconds: 0 }, actions: [a] },
      ],
    },
    encounter,
    w,
    mission,
  );
interface Internals {
  captureMissionCheckpoint(): void;
  hitboxes: HitboxHistory;
  buildSnapshot(): WorldSnapshot;
  turretPoint(
    e: EnemyEntity,
    offset: readonly [number, number, number],
  ): { x: number; y: number; z: number };
  fireShell(
    e: EnemyEntity,
    v: EnemyVehicle,
    at: { x: number; y: number; z: number },
  ): void;
  projectiles: { state: { y: number } }[];
}
function play(campaign?: CampaignState) {
  const saves: CampaignState[] = [];
  const session = new Session(undefined, '', world, {
    encounter,
    mission,
    events: script(),
    testHumanCount: 0,
    ...(campaign ? { campaign } : {}),
    onCampaignSave: (s) => saves.push(s),
  });
  let now = 0;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) session.step((now += TICK_SECONDS * 1000));
  };
  return { session, step, saves, x: session as unknown as Internals };
}
const feet = (session: Session) =>
  session.slots.map((s) => ({ x: s.state.x, y: s.state.y, z: s.state.z }));

describe('authored starts across the Session lifecycle (U-110)', () => {
  it('starts exact slot positions; joining possesses the existing bot in place; full restart restores the authored starts', () => {
    const m = play();
    expect(feet(m.session)).toEqual(starts);
    const pair = createLoopbackPair();
    m.session.addConnection(pair.a, 0);
    const client = new ClientConnection(pair.b, {});
    client.join('owner');
    pair.settle();
    expect(feet(m.session)).toEqual(starts);
    m.session.slots.forEach((s) => {
      s.state.x += 1;
      s.yaw = 256;
    });
    m.session.restartMission();
    expect(feet(m.session)).toEqual(starts);
    expect(m.session.slots.map((s) => s.yaw)).toEqual([0, 0, 0, 0, 0, 0]);
    const snap = m.x.buildSnapshot();
    for (const [i, slot] of m.session.slots.entries()) {
      const t = snap.entities.find((e) => e.netId === slot.netId)!.components[
        COMPONENT_IDS.Transform
      ]!;
      expect(dequantize(t[1]!, POSITION)).toBeCloseTo(starts[i]!.y, 2);
    }
  });

  it('uses authored starts for retry without a checkpoint, keeps saved positions on retry/load, and retains legacy defaults', () => {
    const m = play();
    m.session.slots.forEach((s) => (s.state.x += 1));
    m.session.retryMission(true);
    expect(feet(m.session)).toEqual(starts);
    m.session.slots.forEach((s) => (s.state.x += 1));
    const saved = feet(m.session);
    m.x.captureMissionCheckpoint();
    m.session.slots.forEach((s) => (s.state.x += 2));
    m.session.retryMission(true);
    expect(feet(m.session)).toEqual(saved);
    const state = JSON.parse(JSON.stringify(m.saves.at(-1))) as CampaignState;
    expect(feet(play(state).session)).toEqual(saved);
    const partial = JSON.parse(JSON.stringify(state)) as CampaignState;
    partial.checkpoint!.spawns = partial.checkpoint!.spawns.slice(0, 3);
    const loaded = play(partial).session;
    expect(feet(loaded).slice(3)).toEqual(starts.slice(3));
    const legacy = new Session(undefined, '', 'range');
    expect(feet(legacy)).toEqual(legacy.slots.map((s) => spawnFor(s.index)));
  });
});

describe('legacy navmesh height offsets (U-110)', () => {
  it('keeps an automatically projected 2D route flat without opting into authored height checks', () => {
    const session = new Session(undefined, '', 'range');
    for (const slot of session.slots) slot.state.x = -200;
    const y = 0.05000000074505806;
    const id = session.spawnEnemy('tank', {
      x: 0,
      y,
      z: 10,
      path: [{ x: 0, z: 40 }],
      authoredHeight: false,
    });
    const tank = session.enemies.find((e) => e.netId === id)!;
    expect(tank.drive!.origin?.y).toBeUndefined();
    expect(tank.drive!.path[0]!.y).toBeUndefined();
    for (let n = 1; n <= 900; n++) session.step(n * TICK_SECONDS * 1000);
    expect(tank.drive!.phase).toBe('arrived');
    expect(tank.state.y).toBeCloseTo(y, 9);
  });
});

describe('elevated tank script and persistence (U-110)', () => {
  it('drives beneath the bridge at y8; hull, turret, muzzle, projectile and wire transform retain the elevation', () => {
    const m = play();
    m.step();
    const tank = m.session.enemies.find((e) => e.def.vehicle)!;
    m.step(330);
    expect(tank.state.z).toBeGreaterThan(18);
    expect(tank.state.z).toBeLessThan(24);
    expect(tank.state.y).toBeCloseTo(8, 6);
    const hit = (y: number) =>
      resolveShot(
        m.x.hitboxes,
        {
          shooterNetId: 999,
          ray: {
            origin: { x: -10, y, z: tank.state.z },
            direction: { x: 1, y: 0, z: 0 },
            maxDistance: 30,
          },
          nowMs: 11000,
          clientRenderTimeMs: 11000,
        },
        undefined,
        [],
      );
    expect(hit(9)?.part).toBe('hull');
    expect(hit(10.6)?.part).toBe('turret');
    expect(hit(1)?.netId).not.toBe(tank.netId);
    expect(
      m.x.turretPoint(tank, tank.def.vehicle!.cannon.muzzle).y,
    ).toBeCloseTo(8 + tank.def.vehicle!.cannon.muzzle[1]);
    m.x.fireShell(tank, tank.def.vehicle!, { x: 0, y: 8, z: 40 });
    expect(m.x.projectiles.at(-1)!.state.y).toBeCloseTo(
      8 + tank.def.vehicle!.cannon.muzzle[1],
    );
    const t = m.x.buildSnapshot().entities.find((e) => e.netId === tank.netId)!
      .components[COMPONENT_IDS.Transform]!;
    expect(dequantize(t[1]!, POSITION)).toBeCloseTo(8, 2);
    m.step(500);
    expect(tank.drive!.phase).toBe('arrived');
    m.step(30);
    expect(tank.state.y).toBeCloseTo(8);
    withdrawDrive(tank.drive!, tank.state);
    m.step(60);
    expect(tank.state.y).toBeCloseTo(8);
  });

  it('waits for a soldier on its road, while a soldier on the storey below does not block it', () => {
    const m = play();
    m.step();
    const tank = m.session.enemies.find((e) => e.def.vehicle)!;
    const slot = m.session.slots[0]!;
    Object.assign(slot.state, { x: 0, y: 8, z: 12 });
    Object.assign(slot.health, { current: 100000, max: 100000 });
    m.step(200);
    expect(tank.drive!.phase).toBe('blocked');
    expect(tank.state.z).toBeLessThan(10);
    slot.state.y = 0;
    m.step(200);
    expect(tank.state.z).toBeGreaterThan(17);
    expect(tank.state.y).toBeCloseTo(8);
  });

  it('preserves the authored floor for an encounter vehicle spawn and its route', () => {
    const w = loadWorld({
      ...raw(),
      mission: {
        ...raw().mission,
        spawnZones: [
          { id: 'reserve', on: 'objective', x: 0, y: 8, z: 2, radius: 0.1 },
        ],
      },
    });
    const enc = parseEncounter(
      {
        world: w.id,
        aliveCap: 4,
        probes: [1],
        areas: {},
        groups: [
          {
            id: 'tank',
            zone: 'reserve',
            members: [{ archetype: 'tank', count: 1 }],
            posture: { kind: 'hold' },
            trigger: { kind: 'start' },
            path: [{ x: 0, y: 8, z: 35 }],
          },
        ],
      },
      () => w,
    );
    const session = new Session(undefined, '', w, {
      encounter: enc,
      mission,
      testHumanCount: 0,
    });
    for (let n = 1; n <= 120; n++) session.step(n * TICK_SECONDS * 1000);
    const tank = session.enemies.find((e) => e.def.vehicle)!;
    expect(tank.state.y).toBeCloseTo(8);
    expect(tank.drive!.path[0]!.y).toBe(8);
  });

  it('restores height, waypoint/origin heights and withdrawal through JSON checkpoint retry and host reload', () => {
    const m = play();
    m.step(180);
    const tank = m.session.enemies.find((e) => e.def.vehicle)!;
    withdrawDrive(tank.drive!, tank.state);
    m.x.captureMissionCheckpoint();
    const state = JSON.parse(JSON.stringify(m.saves.at(-1))) as CampaignState;
    const saved = parseCheckpointWorld(state.checkpoint!.world)!;
    expect(saved.enemies[0]!.vehicle!.path.every((p) => p.y === 8)).toBe(true);
    expect(saved.enemies[0]!.vehicle!.origin?.y).toBe(8);
    m.step(10);
    m.session.retryMission(true);
    expect(m.session.enemies.find((e) => e.def.vehicle)!.state.y).toBeCloseTo(
      8,
    );
    const reloaded = play(state);
    const after = reloaded.session.enemies.find((e) => e.def.vehicle)!;
    expect(after.drive!.withdrawing).toBe(true);
    expect(after.state.y).toBeCloseTo(8);
    reloaded.step(30);
    expect(after.state.y).toBeCloseTo(8);
    const bad = JSON.parse(JSON.stringify(saved));
    bad.enemies[0].vehicle.path[0].y = 'eight';
    expect(parseCheckpointWorld(bad)).toBeNull();
    const stationary = m.session.spawnEnemy('tank', { x: 12, y: 8, z: 25 })!;
    m.step(60);
    expect(
      m.session.enemies.find((e) => e.netId === stationary)!.state.y,
    ).toBeCloseTo(8);
  });

  it('keeps authored vehicle feet exact when navigation projects 5 cm above their floor', () => {
    const w = loadWorld({
      ...raw(),
      mission: {
        ...raw().mission,
        spawnZones: [
          { id: 'reserve', on: 'objective', x: 0, y: 8, z: 2, radius: 0.1 },
        ],
      },
    });
    const enc = parseEncounter(
      {
        world: w.id,
        aliveCap: 4,
        probes: [1],
        areas: {},
        groups: [
          {
            id: 'tank',
            zone: 'reserve',
            members: [{ archetype: 'tank', count: 1 }],
            posture: { kind: 'hold' },
            trigger: { kind: 'start' },
            path: [{ x: 0, y: 8, z: 35 }],
          },
        ],
      },
      () => w,
    );
    const placed: { y: number; authoredHeight?: boolean }[] = [];
    const host: SpawnerHost = {
      humanEyes: () => [],
      squadFeet: () => [],
      enemyFeet: () => [],
      isAlive: () => true,
      ground: (p) => ({ ...p, y: p.y + 0.05000000074505806 }),
      spawn: (_archetype, at) => {
        placed.push(at);
        return 1;
      },
    };
    new Spawner(enc, w, host).step(0);
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ y: 8, authoredHeight: true });
  });

  it('refuses unsupported script/group heights and full turret obstruction', () => {
    expect(() => script({ ...action, y: 7 })).toThrow(/support/);
    expect(() =>
      script({ ...action, path: [{ x: 0, y: Infinity, z: 30 }] }),
    ).toThrow(/number/);
    expect(() =>
      script(
        action,
        loadWorld({
          ...raw(),
          cover: raw().cover.map((b) =>
            b.id === 'bridge' ? { ...b, y: 11 } : b,
          ),
        }),
      ),
    ).toThrow(/clearance/);
    const group = {
      id: 'tank',
      zone: 'reserve',
      members: [{ archetype: 'tank', count: 1 }],
      posture: { kind: 'hold' },
      trigger: { kind: 'start' },
      path: [{ x: 12, y: 7, z: 30 }],
    };
    expect(() =>
      parseEncounter(
        {
          world: world.id,
          aliveCap: 4,
          probes: [1],
          areas: {},
          groups: [group],
        },
        () => world,
      ),
    ).toThrow(/support/);
    expect(() => script({ ...action, y: NaN })).toThrow(/number/);
    const noHeight = {
      ...world,
      mission: {
        ...world.mission!,
        spawnZones: world.mission!.spawnZones.map(({ y: _y, ...zone }) => zone),
      },
    };
    expect(() =>
      parseEncounter(
        {
          world: world.id,
          aliveCap: 4,
          probes: [1],
          areas: {},
          groups: [{ ...group, path: [{ x: 12, y: 8, z: 30 }] }],
        },
        () => noHeight,
      ),
    ).toThrow(/spawn-zone y/);
  });
});
