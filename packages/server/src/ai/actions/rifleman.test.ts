/**
 * The rifleman's leaves and what the session does with them (T-3.20).
 *
 * The fight as a whole is measured by `cover-duel` (tools/src/scenarios);
 * these pin the pieces it stands on: the committed tree binds, a body that is
 * not a fighter stands down, the hands a leaf asks for reach the input (a
 * crouch, a reload that completes, a walk that faces somewhere else), and a
 * crouched rifleman does not shoot over a wall only a standing one sees over.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_MUZZLE_RIG,
  type Message,
  PROTOCOL_VERSION,
  TREE_DEFS,
  buildTree,
  createLoopbackPair,
  createMoveState,
  decodeMessage,
  encodeMessage,
  getWeapon,
  parseTreeDef,
} from '@sandline/shared';
import { type BrainMemory, type BrainTree, Brain, createBrainRegistry } from '../Brain.ts';
import { type NavMesh, initNav } from '../nav/NavMesh.ts';
import { bakedCoverFor, loadWorldNavMesh } from '../nav/bakedNav.ts';
import { type EnemyEntity, Session } from '../../session/Session.ts';

const TICK_MS = 1000 / 30;
const CARBINE = getWeapon('carbine');

let mesh: NavMesh;
beforeAll(async () => {
  await initNav();
  mesh = loadWorldNavMesh('range');
});

/** A fixture tree of one action that writes `memory` onto the blackboard every think. */
function wants(memory: (m: { tick: number }) => Partial<BrainMemory>): BrainTree {
  const registry = createBrainRegistry().action('want', ({ blackboard, tick }) => {
    for (const [k, v] of Object.entries(memory({ tick }))) blackboard.set(k as keyof BrainMemory, v as never);
    return 'running';
  });
  return buildTree(parseTreeDef({ id: 'test-want', root: { type: 'action', name: 'want' } }), registry);
}

function enemy(session: Session, id: number): EnemyEntity {
  return session.enemies.find((e) => e.netId === id)!;
}

function run(session: Session, ticks: number, each?: () => void): void {
  for (let i = 0; i < ticks; i++) {
    session.step((session.tick + 1) * TICK_MS);
    each?.();
  }
}

describe('the rifleman tree (T-3.20)', () => {
  it('is committed, and binds to the server registry', () => {
    expect(TREE_DEFS.has('rifleman')).toBe(true);
    expect(() => buildTree('rifleman', createBrainRegistry())).not.toThrow();
  });

  it('stands a body that is not a fighter down: no target, no trigger, no cover', () => {
    const body = { netId: 3, state: createMoveState(0, 0, 0), yaw: 0, health: { current: 100, max: 100, downedAt: null, diedAt: null } };
    const brain = new Brain(body, buildTree('rifleman', createBrainRegistry()));
    for (let t = 0; t < 30; t += 3) brain.think(t);
    expect(brain.tree.runningPath().at(-1)).toMatch(/standDown/);
    expect(brain.read('fireAt')).toBeNull();
    expect(brain.read('intent')).toBeNull();
    expect(brain.read('crouch')).toBe(false);
  });

  it('with a known threat and cover on the map, heads for a point that hides it', () => {
    const session = new Session(undefined, '', 'range', { navMesh: mesh, cover: bakedCoverFor('range') });
    // Everyone parked far away but slot 0, which stands on the spawn line.
    session.slots.forEach((s, i) => {
      if (i > 0) s.state = createMoveState(-60 + i * 4, 0, -95);
    });
    session.slots[0]!.state = createMoveState(-2, 0, -4);
    const id = session.spawnEnemy('rifleman', { x: -6, y: 0, z: 22, yaw: 512, tree: buildTree('rifleman', createBrainRegistry()) }) as number;
    // Closest it came to the point it held, tick by tick: it may be out on a peek by the end.
    let closest = Infinity;
    run(session, 30 * 8, () => {
      const p = session.cover!.heldPoint(id);
      const e = enemy(session, id);
      if (p) closest = Math.min(closest, Math.hypot(e.state.x - p.x, e.state.z - p.z));
    });
    const e = enemy(session, id);
    expect(e.target).toBe(session.slots[0]!.netId);
    const held = session.cover!.heldPoint(id);
    expect(held).not.toBeNull();
    expect(closest).toBeLessThan(0.4);
    const eye = { x: -2, y: DEFAULT_MUZZLE_RIG.eyeHeight, z: -4 };
    expect(session.cover!.stillProtects(id, [eye])).toBe(true);
  });
});

describe('advancing when unopposed (T-3.20)', () => {
  it('moves up cover to cover towards a threat that never fires, and stops short of it', () => {
    const session = new Session(undefined, '', 'range', { navMesh: mesh, cover: bakedCoverFor('range') });
    session.slots.forEach((s, i) => {
      if (i > 0) s.state = createMoveState(-60 + i * 4, 0, -95);
    });
    const threat = { x: 10, y: 0, z: -30 };
    session.slots[0]!.state = createMoveState(threat.x, threat.y, threat.z);
    const id = session.spawnEnemy('rifleman', { x: 10, y: 0, z: 20, yaw: 512, tree: buildTree('rifleman', createBrainRegistry()) }) as number;
    const across = (p: { x: number; z: number }) => Math.hypot(p.x - threat.x, p.z - threat.z);
    const held: number[] = [];
    run(session, 30 * 30, () => {
      const p = session.cover!.heldPoint(id);
      if (p && held.at(-1) !== across(p)) held.push(across(p));
    });
    console.log(`advance: held points at ${held.map((d) => d.toFixed(1)).join(' → ')} m from the threat`);
    // It took cover, then took nearer cover at least once, each step a real gain.
    expect(held.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < held.length; i++) expect(held[i]!).toBeLessThanOrEqual(held[i - 1]! - 4 + 1e-9);
    // And never closer than the tree's closestM (12 m).
    expect(Math.min(...held)).toBeGreaterThanOrEqual(12 - 1e-9);
  });
});

describe('a brain’s hands on the session (T-3.20)', () => {
  it('walks where its intent says while facing its lookAt: a strafe, not a turn', () => {
    const session = new Session(undefined, '', 'range', { navMesh: mesh });
    session.slots.forEach((s, i) => (s.state = createMoveState(-60 + i * 4, 0, -95)));
    // East along z = 14, looking north the whole way.
    const id = session.spawnEnemy('rifleman', {
      x: -3,
      y: 0,
      z: 14,
      tree: wants(() => ({ intent: { goal: { x: 5, y: 0, z: 14 }, pace: 'walk' }, lookAt: { x: 1, y: 0, z: 60 } })),
    }) as number;
    const yaws: number[] = [];
    run(session, 60, () => yaws.push(enemy(session, id).yaw));
    const e = enemy(session, id);
    expect(e.state.x).toBeGreaterThan(-1);
    expect(Math.abs(e.state.z - 14)).toBeLessThan(0.3);
    // Facing north (wire yaw 0) within a few degrees throughout the walk, not east (256).
    for (const yaw of yaws.slice(10)) expect(Math.min(yaw, 1024 - yaw)).toBeLessThan(20);
  });

  it('holds a crouch it asks for, and stands when it stops asking', () => {
    const session = new Session(undefined, '', 'range');
    let crouch = true;
    const id = session.spawnEnemy('rifleman', { x: 0, y: 0, z: 20, tree: wants(() => ({ crouch })) }) as number;
    run(session, 6);
    expect(enemy(session, id).state.crouched).toBe(true);
    crouch = false;
    run(session, 6);
    expect(enemy(session, id).state.crouched).toBe(false);
  });

  it('completes a reload it keeps asking for, rather than restarting it on the tick it ends', () => {
    const session = new Session(undefined, '', 'range');
    const id = session.spawnEnemy('rifleman', { x: 0, y: 0, z: 20, tree: wants(() => ({ reload: true })) }) as number;
    const e = enemy(session, id);
    e.weaponState.ammo = 5;
    run(session, Math.ceil((CARBINE.reloadSeconds + 0.3) * 30));
    expect(e.weaponState.ammo).toBe(CARBINE.magSize);
  });

  it('shoots from its own eye: crouched behind the low wall it has no shot a standing one would', () => {
    const session = new Session(undefined, '', 'range');
    const pair = createLoopbackPair();
    session.addConnection(pair.a, 0);
    const hits: Extract<Message, { kind: 'HitEvent' }>[] = [];
    pair.b.onMessage((bytes) => {
      const msg = decodeMessage(bytes);
      if (msg.kind === 'HitEvent') hits.push(msg);
      if (msg.kind === 'Delta') pair.b.send(encodeMessage({ kind: 'Ack', tick: msg.tick }));
    });
    pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'target', room: '' }));
    pair.settle();
    const target = session.slots[0]!;
    // The low wall runs x −12..−6 at z −1, 1.0 m tall. Rifleman just north of it, target 6 m south, crouched too.
    target.state = { ...createMoveState(-9, 0, -7), crouched: true };
    let crouch = true;
    const id = session.spawnEnemy('rifleman', {
      x: -9,
      y: 0,
      z: -0.4,
      yaw: 512,
      tree: wants(() => ({ crouch, fireAt: target.netId })),
    }) as number;
    const step = (n: number) => {
      for (let i = 0; i < n; i++) {
        session.step((session.tick + 1) * TICK_MS);
        pair.settle();
        target.state = { ...target.state, crouched: true };
        target.input.crouch = true;
      }
    };
    step(30);
    expect(enemy(session, id).state.crouched).toBe(true);
    expect(hits.filter((h) => h.shooterNetId === id)).toEqual([]);
    crouch = false;
    step(30);
    expect(hits.filter((h) => h.shooterNetId === id).length).toBeGreaterThan(0);
  });
});

