/**
 * Enemy entities (T-3.10), driven over the real wire.
 *
 * Over the wire and through the real delta path for the reason
 * `projectiles.test.ts` gives: the `Enemy` component is new, the component
 * mask got a bit wider and enemies spawn and despawn, so these decode what a
 * client would decode, acknowledging as they go, rather than reading the
 * session's own lists. The lag-compensated headshot runs through `NetSim` on
 * both directions of the link, so the rewind is the one a real client's shot
 * gets, not one this file asserts into existence.
 *
 * What is NOT here: how an enemy decides anything (every tree below is a test
 * fixture that walks to a point), perception, aim, or how one is drawn (T-3.11).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  COMPONENT_IDS,
  DAMAGE,
  DEFAULT_MUZZLE_RIG,
  ENEMY_IDS,
  type Message,
  NetSim,
  POSITION,
  PROTOCOL_VERSION,
  RANGE_TARGETS,
  SnapshotStore,
  type WorldSnapshot,
  buildTree,
  createLoopbackPair,
  damageAtDistance,
  decodeMessage,
  dequantize,
  encodeMessage,
  eyePosition,
  getEnemy,
  getWeapon,
  isEnemyNetId,
  isRangeTarget,
  parseTreeDef,
  vitalityFromCode,
  zoneAt,
  zoneDamage,
} from '@sandline/shared';
import { type NavMesh, initNav } from '../ai/nav/NavMesh.ts';
import { loadWorldNavMesh } from '../ai/nav/bakedNav.ts';
import { type BrainTree, createBrainRegistry } from '../ai/Brain.ts';
import { DEFAULT_HITBOX } from '../net/lagComp.ts';
import { MAX_ENEMIES, Session } from './Session.ts';

const TICK_MS = 1000 / 30;
const HITBOX_HEIGHT = 2 * (DEFAULT_HITBOX.halfHeight + DEFAULT_HITBOX.radius);
const RIFLEMAN = getEnemy('rifleman');
const RIFLEMAN_INDEX = ENEMY_IDS.indexOf('rifleman');

let mesh: NavMesh;
beforeAll(async () => {
  await initNav();
  mesh = loadWorldNavMesh('range');
});

/** A fixture tree: walk to `goal` at walk pace, forever. */
function walkTo(goal: { x: number; y: number; z: number }): BrainTree {
  const registry = createBrainRegistry().action('walk', ({ blackboard }) => {
    blackboard.set('intent', { goal, pace: 'walk' });
    return 'running';
  });
  return buildTree(parseTreeDef({ id: 'test-walk', root: { type: 'action', name: 'walk' } }), registry);
}

/** One entity of a decoded snapshot, as a client would read it. */
interface Seen {
  x: number;
  y: number;
  z: number;
  enemy: readonly number[] | undefined;
  health: readonly number[] | undefined;
  slot: readonly number[] | undefined;
}

function seen(snapshot: WorldSnapshot | null, netId: number): Seen | null {
  const entity = snapshot?.entities.find((e) => e.netId === netId);
  const t = entity?.components[COMPONENT_IDS.Transform];
  if (!entity || !t) return null;
  return {
    x: dequantize(t[0] as number, POSITION),
    y: dequantize(t[1] as number, POSITION),
    z: dequantize(t[2] as number, POSITION),
    enemy: entity.components[COMPONENT_IDS.Enemy],
    health: entity.components[COMPONENT_IDS.Health],
    slot: entity.components[COMPONENT_IDS.PlayerSlot],
  };
}

/**
 * Yaw/pitch from `eye` at a point, in TABLE units (1/4096 turn) — what a Fire
 * carries. Math.* is fine: this is `packages/server`, outside ADR-014's ban.
 */
function aim(eye: { x: number; y: number; z: number }, at: { x: number; y: number; z: number }): { yaw: number; pitch: number } {
  const dx = at.x - eye.x;
  const dy = at.y - eye.y;
  const dz = at.z - eye.z;
  const table = (rad: number): number => ((Math.round((rad / (Math.PI * 2)) * 4096) % 4096) + 4096) % 4096;
  return { yaw: table(Math.atan2(dx, dz)), pitch: table(Math.asin(dy / Math.hypot(dx, dy, dz))) };
}

/** The point a head shot aims at: high in the head zone, inside the capsule's top cap. */
function headOf(feet: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return { x: feet.x, y: feet.y + 0.88 * HITBOX_HEIGHT, z: feet.z };
}

/**
 * A client over a loopback, optionally with `latencyMs` each way through
 * NetSim: it handshakes, decodes and acknowledges every delta, and collects
 * hit events. `run` advances the session in ticks, pumping the link every
 * millisecond so a datagram lands when it is due rather than on a tick edge.
 */
function connect(session: Session, latencyMs = 0) {
  const pair = createLoopbackPair();
  const toClient = latencyMs > 0 ? new NetSim(pair.a, { latencyMs, seed: 1 }) : null;
  const toServer = latencyMs > 0 ? new NetSim(pair.b, { latencyMs, seed: 2 }) : null;
  const serverSide = toClient ?? pair.a;
  const clientSide = toServer ?? pair.b;
  session.addConnection(serverSide, 0);

  const store = new SnapshotStore();
  const hits: Extract<Message, { kind: 'HitEvent' }>[] = [];
  let netId = 0;
  let now = 0;
  clientSide.onMessage((bytes) => {
    let msg: Message;
    try {
      msg = decodeMessage(bytes);
    } catch {
      return;
    }
    if (msg.kind === 'JoinAck') netId = msg.netId;
    if (msg.kind === 'HitEvent') hits.push(msg);
    if (msg.kind === 'Delta') {
      const result = store.applyDelta(msg.tick, msg.baselineTick, msg.payload);
      if (result.ok) clientSide.send(encodeMessage({ kind: 'Ack', tick: msg.tick }));
    }
  });

  const pump = (t: number): void => {
    toServer?.pump(t);
    toClient?.pump(t);
    pair.settle();
  };

  clientSide.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'shooter', room: '' }));
  pump(0);
  pump(latencyMs);
  pump(2 * latencyMs);

  return {
    store,
    hits,
    get netId() {
      return netId;
    },
    get now() {
      return now;
    },
    fire(overrides: Partial<Extract<Message, { kind: 'Fire' }>>): void {
      clientSide.send(
        encodeMessage({ kind: 'Fire', tick: 0, yaw: 0, pitch: 0, renderTimeMs: now, weapon: 0, ads: true, ...overrides }),
      );
      pump(now);
    },
    /** Advance `count` ticks; `each` runs after every tick. */
    run(count: number, each?: () => void): void {
      for (let i = 0; i < count; i++) {
        const next = (session.tick + 1) * TICK_MS;
        for (let t = Math.floor(now) + 1; t < next; t++) pump(t);
        session.step(next);
        now = next;
        pump(now);
        each?.();
      }
    },
  };
}

describe('an enemy on the wire (T-3.10)', () => {
  it('spawns, moves and despawns in the deltas a client decodes', () => {
    const session = new Session(undefined, '', 'range', { navMesh: mesh });
    const client = connect(session);
    client.run(3);

    const start = { x: -4, y: 0, z: 14 };
    const netId = session.spawnEnemy('rifleman', { ...start, faction: 1, tree: walkTo({ x: 4, y: 0, z: 14 }) });
    expect(netId).not.toBeNull();
    const id = netId as number;
    client.run(1);

    // Spawned: a soldier's components and an Enemy naming its archetype and
    // side, and no PlayerSlot — nothing that would put it in the squad.
    const first = seen(client.store.current, id);
    expect(first).not.toBeNull();
    expect(first?.enemy).toEqual([RIFLEMAN_INDEX, 1]);
    expect(first?.slot).toBeUndefined();
    expect(first?.health?.slice(0, 3)).toEqual([RIFLEMAN.health, RIFLEMAN.health, 0]);
    expect(first?.x).toBeCloseTo(start.x, 1);

    // Moves: its brain's intent walked by path following, in the client's view.
    client.run(30);
    const later = seen(client.store.current, id);
    expect((later?.x ?? 0) - (first?.x ?? 0)).toBeGreaterThan(2);
    expect(later?.z).toBeCloseTo(start.z, 0);

    // Dies (through the one applyDamage, from a human's Fire) and despawns
    // once its corpse time is up, and not a tick before.
    const enemy = session.enemies.find((e) => e.netId === id)!;
    const eye = eyePosition(session.slots[0]!.state.x, session.slots[0]!.state.y, session.slots[0]!.state.z, DEFAULT_MUZZLE_RIG);
    for (let shot = 0; shot < 20 && enemy.health.diedAt === null; shot++) {
      client.fire({ ...aim(eye, headOf(enemy.state)), renderTimeMs: client.now });
      client.run(3);
    }
    expect(enemy.health.diedAt).not.toBeNull();
    client.run(1);
    expect(vitalityFromCode(seen(client.store.current, id)?.health?.[2] ?? 0)).toBe('dead');

    const diedAtMs = (enemy.health.diedAt as number) * 1000;
    let goneAtMs: number | null = null;
    client.run(Math.ceil((RIFLEMAN.corpseSeconds * 1000) / TICK_MS) + 3, () => {
      if (goneAtMs === null && seen(client.store.current, id) === null) goneAtMs = client.now;
    });
    expect(goneAtMs).not.toBeNull();
    const lay = (goneAtMs as unknown as number) - diedAtMs;
    expect(lay).toBeGreaterThanOrEqual(RIFLEMAN.corpseSeconds * 1000);
    expect(lay).toBeLessThan(RIFLEMAN.corpseSeconds * 1000 + TICK_MS + 1);
    expect(session.enemies).toHaveLength(0);
  });

  it('lands a lag-compensated head shot at 20 m under 150 ms of simulated latency', () => {
    /**
     * 150 ms round trip: 75 ms each way through NetSim. The client renders
     * 100 ms behind its (here exact) server clock, so its shot is rewound by
     * the fire's one-way trip plus the interpolation delay — about 170 ms,
     * inside the 200 ms cap. The enemy walks across the line of fire at
     * 4.2 m/s, so in that time it moves about 0.7 m, twice the capsule's
     * radius: the shot lands only if it is resolved against the rewound
     * enemy, exactly as against a rewound slot.
     */
    const session = new Session(undefined, '', 'range', { navMesh: mesh });
    const client = connect(session, 75);
    client.run(6);
    const id = session.spawnEnemy('rifleman', { x: -3, y: 0, z: 13.6, tree: walkTo({ x: 8, y: 0, z: 13.6 }) }) as number;

    // Walk until the client's view, 100 ms behind, has it near x = 0.
    let renderTick = 0;
    for (let i = 0; i < 90; i++) {
      client.run(1);
      renderTick = session.tick - 3; // renderTime = now - 100 ms, exactly three ticks back.
      const view = seen(client.store.get(renderTick), id);
      if (view && view.x >= -0.5) break;
    }
    const view = seen(client.store.get(renderTick), id)!;
    const me = seen(client.store.get(renderTick), client.netId)!;
    expect(view).not.toBeNull();
    expect(me).not.toBeNull();

    const eye = eyePosition(me.x, me.y, me.z, DEFAULT_MUZZLE_RIG);
    const distance = Math.hypot(view.x - eye.x, view.z - eye.z);
    expect(distance).toBeGreaterThan(19.5);
    expect(distance).toBeLessThan(20.5);

    const renderTimeMs = renderTick * TICK_MS;
    expect(client.now - renderTimeMs).toBeCloseTo(100, 6);
    const enemy = session.enemies.find((e) => e.netId === id)!;
    client.fire({ ...aim(eye, headOf(view)), renderTimeMs });
    const before = enemy.health.current;
    for (let i = 0; i < 10 && client.hits.length === 0; i++) client.run(1);

    const hit = client.hits.at(-1);
    expect(hit?.targetNetId).toBe(id);
    // Head zone, judged from the impact height up the enemy as the client saw it.
    expect(zoneAt(hit!.y, view.y, HITBOX_HEIGHT)).toBe('head');
    const carbine = getWeapon('carbine');
    const expected = zoneDamage(damageAtDistance(carbine, distance), 'head', DAMAGE);
    expect(hit!.damage).toBeCloseTo(expected, 0);
    expect(before - enemy.health.current).toBeCloseTo(hit!.damage, 6);

    // And the rewind is what made it: where the enemy is now is well clear of
    // where it was at the render time.
    const moved = Math.abs(enemy.state.x - view.x);
    console.log(`[T-3.10] head shot at ${distance.toFixed(2)} m, 75 ms each way: enemy moved ${moved.toFixed(2)} m since the render time, ${hit!.damage.toFixed(1)} damage`);
    expect(moved).toBeGreaterThan(2 * DEFAULT_HITBOX.radius);
  });
});

describe('an enemy dies, and stays dead (T-3.10)', () => {
  it('dies rather than going down, stops producing input the tick it dies, and despawns on schedule', () => {
    const session = new Session(undefined, '', 'range', { navMesh: mesh });
    const client = connect(session);
    client.run(3);
    const id = session.spawnEnemy('rifleman', { x: -4, y: 0, z: 6, tree: walkTo({ x: 4, y: 0, z: 6 }) }) as number;
    const enemy = session.enemies.find((e) => e.netId === id)!;
    client.run(10);

    const codes = new Set<number>();
    const eye = eyePosition(session.slots[0]!.state.x, session.slots[0]!.state.y, session.slots[0]!.state.z, DEFAULT_MUZZLE_RIG);
    let deadAt: { x: number; z: number; tick: number } | null = null;
    for (let shot = 0; shot < 30 && deadAt === null; shot++) {
      client.fire({ ...aim(eye, { x: enemy.state.x, y: enemy.state.y + 1.1, z: enemy.state.z }), renderTimeMs: client.now });
      if (enemy.health.diedAt !== null) {
        // Killed between ticks: its brain is stopped already, and its input is idle.
        expect(enemy.brain?.isStopped).toBe(true);
        expect(enemy.follower).toBeNull();
        expect(enemy.input.moveX === 0 && enemy.input.moveY === 0).toBe(true);
        deadAt = { x: enemy.state.x, z: enemy.state.z, tick: session.tick };
      }
      client.run(3, () => {
        const code = seen(client.store.current, id)?.health?.[2];
        if (code !== undefined) codes.add(code);
      });
    }
    expect(deadAt).not.toBeNull();
    // Never downed on the way: alive, then dead.
    expect([...codes].map(vitalityFromCode).sort()).toEqual(['alive', 'dead']);
    // It went nowhere after it died: not one more step, not one more thought.
    const thoughts = enemy.brain?.thoughtCount;
    client.run(30);
    expect(enemy.state.x).toBe(deadAt!.x);
    expect(enemy.state.z).toBe(deadAt!.z);
    expect(enemy.brain?.thoughtCount).toBe(thoughts);

    // The corpse still stops a bullet until it despawns; after, nothing is there.
    client.run(Math.ceil((RIFLEMAN.corpseSeconds * 1000) / TICK_MS));
    expect(session.enemies).toHaveLength(0);
    client.run(10);
    const hitsBefore = client.hits.length;
    client.fire({ ...aim(eye, { x: deadAt!.x, y: 0.9, z: deadAt!.z }), renderTimeMs: client.now });
    expect(client.hits.length).toBe(hitsBefore + 1);
    expect(client.hits.at(-1)?.targetNetId).not.toBe(id);
  });

  it('is killed by a blast through the same applyDamage, and never downed by one', () => {
    const session = new Session(undefined, '', 'range', { navMesh: mesh });
    const pair = createLoopbackPair();
    session.addConnection(pair.a, 0);
    pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'thrower', room: '' }));
    pair.settle();
    const me = session.slots[0]!.state;
    // At the thrower's feet, where a frag dropped straight down goes off.
    const id = session.spawnEnemy('rifleman', { x: me.x + 0.8, y: 0, z: me.z }) as number;
    const enemy = session.enemies.find((e) => e.netId === id)!;
    const detonations: Extract<Message, { kind: 'Detonation' }>[] = [];
    pair.b.onMessage((bytes) => {
      const msg = decodeMessage(bytes);
      if (msg.kind === 'Detonation') detonations.push(msg);
    });
    pair.b.send(encodeMessage({ kind: 'Throw', tick: 0, yaw: 0, pitch: (-1024 >>> 0) & 0xfff, projectile: 0 }));
    pair.settle();
    for (let i = 0; i < 90 && detonations.length === 0; i++) {
      pair.settle();
      session.step((session.tick + 1) * TICK_MS);
      pair.settle();
    }
    expect(detonations).toHaveLength(1);
    expect(detonations[0]?.targets.some((t) => t.netId === id)).toBe(true);
    expect(enemy.health.current).toBe(0);
    expect(enemy.health.downedAt).toBeNull();
    expect(enemy.health.diedAt).not.toBeNull();
    expect(enemy.brain?.isStopped).toBe(true);
  });
});

describe('enemy netIds (T-3.10)', () => {
  it('never collide with slots, range targets or projectiles, and are never reused', () => {
    const session = new Session();
    const pair = createLoopbackPair();
    session.addConnection(pair.a, 0);
    pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'thrower', room: '' }));
    pair.settle();
    pair.b.send(encodeMessage({ kind: 'Throw', tick: 0, yaw: 0, pitch: 0, projectile: 0 }));
    pair.settle();

    const spawned: number[] = [];
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const id = session.spawnEnemy('rifleman', { x: -30 + (i % 8) * 2, y: 0, z: 20 + Math.floor(i / 8) * 2 });
      expect(id).not.toBeNull();
      spawned.push(id as number);
    }
    // The rail: no room for one more.
    expect(session.spawnEnemy('rifleman', { x: 0, y: 0, z: 30 })).toBeNull();
    session.step(TICK_MS);

    const slotIds = session.slots.map((s) => s.netId);
    const rangeIds = RANGE_TARGETS.map((t) => t.netId);
    const snapshotIds = session['buildSnapshot']().entities.map((e: { netId: number }) => e.netId);
    const projectileIds = snapshotIds.filter((n: number) => !slotIds.includes(n) && !spawned.includes(n));
    expect(projectileIds).toHaveLength(1);

    const all = [...slotIds, ...rangeIds, ...spawned, ...projectileIds];
    expect(new Set(all).size).toBe(all.length);
    for (const id of spawned) {
      expect(isEnemyNetId(id)).toBe(true);
      expect(isRangeTarget(id)).toBe(false);
    }
    for (const id of [...slotIds, ...rangeIds, ...projectileIds]) expect(isEnemyNetId(id)).toBe(false);

    // Kill them all, let the corpses go, and the next enemy is a new number.
    for (const e of session.enemies) e.health.diedAt = 0;
    for (let i = 1; i <= Math.ceil((RIFLEMAN.corpseSeconds * 1000) / TICK_MS) + 2; i++) session.step((i + 1) * TICK_MS);
    expect(session.enemies).toHaveLength(0);
    const next = session.spawnEnemy('rifleman', { x: 0, y: 0, z: 30 });
    expect(next).not.toBeNull();
    expect(spawned).not.toContain(next);
    expect(isEnemyNetId(next as number)).toBe(true);
  });
});
