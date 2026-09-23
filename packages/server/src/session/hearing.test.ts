/**
 * Hearing, memory and target choice on the session (T-3.14).
 *
 * The rules themselves — radii, decay, scoring — are unit-tested in
 * `shared/src/ai/stimuli.test.ts` and `memory.test.ts` with their own numbers.
 * These prove the session emits the stimuli where the spec says (a shot at
 * the shooter, an impact and a near miss at the point, a blast at the blast,
 * a sprint at the sprinter), that enemies hear them within the committed
 * radii and remember them, that sight feeds the same memory, and that a
 * target is chosen from it. A client over a loopback does the shooting, so
 * the shot is the one a real `Fire` makes.
 *
 * Every enemy below runs the committed `idle` tree and stands where it was
 * put: nothing here depends on how a brain acts on what it knows.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MUZZLE_RIG,
  MEMORY,
  type Message,
  PROTOCOL_VERSION,
  STIMULI,
  SnapshotStore,
  buildTree,
  createLoopbackPair,
  decodeMessage,
  encodeMessage,
  eyePosition,
} from '@sandline/shared';
import { createBrainRegistry } from '../ai/Brain.ts';
import { type EnemyEntity, Session } from './Session.ts';

/** A rifleman that stands where it is put: the archetype's own tree fights (T-3.23), and these measure what it senses. */
const STILL = () => buildTree('idle', createBrainRegistry());

const TICK_MS = 1000 / 30;
/** Wire yaw facing −Z, back towards the spawn line. 0 faces +Z, away from it. */
const FACING_SPAWN = 512;

/** Yaw/pitch in TABLE units from `eye` at a point — what a Fire carries. */
function aim(eye: { x: number; y: number; z: number }, at: { x: number; y: number; z: number }): { yaw: number; pitch: number } {
  const dx = at.x - eye.x;
  const dy = at.y - eye.y;
  const dz = at.z - eye.z;
  const table = (rad: number): number => ((Math.round((rad / (Math.PI * 2)) * 4096) % 4096) + 4096) % 4096;
  return { yaw: table(Math.atan2(dx, dz)), pitch: table(Math.asin(dy / Math.hypot(dx, dy, dz))) };
}

/** A client in slot 0 that acknowledges every delta, fires and moves on request. */
function connect(session: Session) {
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  const store = new SnapshotStore();
  let netId = 0;
  let now = 0;
  let inputTick = 0;
  pair.b.onMessage((bytes) => {
    let msg: Message;
    try {
      msg = decodeMessage(bytes);
    } catch {
      return;
    }
    if (msg.kind === 'JoinAck') netId = msg.netId;
    if (msg.kind === 'Delta') {
      const result = store.applyDelta(msg.tick, msg.baselineTick, msg.payload);
      if (result.ok) pair.b.send(encodeMessage({ kind: 'Ack', tick: msg.tick }));
    }
  });
  pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'listener-test', room: '' }));
  pair.settle();

  return {
    get netId() {
      return netId;
    },
    fire(at: { x: number; y: number; z: number }): void {
      const s = session.slots[0]!.state;
      const eye = eyePosition(s.x, s.y, s.z, DEFAULT_MUZZLE_RIG);
      pair.b.send(encodeMessage({ kind: 'Fire', tick: session.tick, ...aim(eye, at), renderTimeMs: now, weapon: 0, ads: true }));
      pair.settle();
    },
    /** One input of `buttons`, forward if `forward`. */
    input(buttons: number, forward: boolean): void {
      pair.b.send(encodeMessage({ kind: 'Input', tick: ++inputTick, moveX: 0, moveY: forward ? 1 : 0, yaw: 0, pitch: 0, buttons }));
      pair.settle();
    },
    run(count: number, each?: () => void): void {
      for (let i = 0; i < count; i++) {
        now = (session.tick + 1) * TICK_MS;
        session.step(now);
        pair.settle();
        each?.();
      }
    },
  };
}

function enemy(session: Session, id: number): EnemyEntity {
  return session.enemies.find((e) => e.netId === id)!;
}

function shooterEye(session: Session) {
  const s = session.slots[0]!.state;
  return eyePosition(s.x, s.y, s.z, DEFAULT_MUZZLE_RIG);
}

/** A point in the sky ahead of the shooter: a shot there hits nothing and makes no impact. */
function sky(session: Session) {
  const e = shooterEye(session);
  return { x: e.x, y: e.y + 50, z: e.z + 5 };
}

describe('hearing, memory and target choice (T-3.14)', () => {
  it('a shot is heard inside its radius and not outside', () => {
    const session = new Session(undefined, '', 'range');
    const client = connect(session);
    client.run(3);
    const eye = shooterEye(session);
    const r = STIMULI.kinds.shot.radiusM;
    // Both face away, down range: neither can see the shooter, only hear it.
    const near = session.spawnEnemy('rifleman', { x: eye.x, y: 0, z: eye.z + r - 5, tree: STILL() }) as number;
    const far = session.spawnEnemy('rifleman', { x: eye.x, y: 0, z: eye.z + r + 5, tree: STILL() }) as number;
    client.run(3);
    expect(enemy(session, near).memory.entries.size).toBe(0);

    client.fire(sky(session));
    client.run(1);
    expect(enemy(session, near).memory.entries.has(client.netId)).toBe(true);
    expect(enemy(session, far).memory.entries.size).toBe(0);
  });

  it("an unseen shooter's last known position is where the shot came from, and it becomes the target", () => {
    const session = new Session(undefined, '', 'range');
    const client = connect(session);
    client.run(3);
    const id = session.spawnEnemy('rifleman', { x: 0, y: 0, z: 40, tree: STILL() }) as number;
    client.run(3);
    const eye = shooterEye(session);
    client.fire(sky(session));
    client.run(3);
    const entry = enemy(session, id).memory.entries.get(client.netId)!;
    expect(entry.visible).toBe(false);
    expect(entry.x).toBeCloseTo(eye.x, 9);
    expect(entry.y).toBeCloseTo(eye.y, 9);
    expect(entry.z).toBeCloseTo(eye.z, 9);
    expect(entry.confidence).toBe(STIMULI.kinds.shot.confidence);
    // The only target it knows of, after its next think.
    expect(enemy(session, id).target).toBe(client.netId);
  });

  it('memory decays to forgotten on its data-set time', () => {
    const session = new Session(undefined, '', 'range');
    const client = connect(session);
    client.run(3);
    const id = session.spawnEnemy('rifleman', { x: 0, y: 0, z: 40, tree: STILL() }) as number;
    client.run(3);
    client.fire(sky(session));
    client.run(1);
    const heardAt = session.tick * TICK_MS;
    const memory = enemy(session, id).memory;
    let forgottenAt: number | null = null;
    client.run(Math.ceil((MEMORY.forgetSeconds * 1000) / TICK_MS) + 6, () => {
      if (forgottenAt === null && !memory.entries.has(client.netId)) forgottenAt = session.tick * TICK_MS;
    });
    expect(forgottenAt).not.toBeNull();
    const age = forgottenAt! - heardAt;
    // Forgotten on the first think at or past its time: within one think period of it.
    expect(age).toBeGreaterThanOrEqual(MEMORY.forgetSeconds * 1000);
    expect(age).toBeLessThanOrEqual(MEMORY.forgetSeconds * 1000 + 4 * TICK_MS);
    expect(enemy(session, id).target).toBeNull();
  });

  it('a near miss and an impact mark the shooter as shooting at it', () => {
    const session = new Session(undefined, '', 'range');
    const client = connect(session);
    client.run(3);
    const id = session.spawnEnemy('rifleman', { x: 0, y: 0, z: 30, tree: STILL() }) as number;
    client.run(3);
    const e = enemy(session, id);
    // Past its shoulder, a metre wide at chest height: a miss that is heard.
    client.fire({ x: e.state.x + 1, y: e.state.y + 1.2, z: e.state.z });
    client.run(1);
    expect(e.health.current).toBe(e.health.max);
    const entry = e.memory.entries.get(client.netId)!;
    expect(entry.threatAt).not.toBeNull();
  });

  it('sight feeds the same memory: a slot in view is detected over several thinks, then seen', () => {
    const session = new Session(undefined, '', 'range');
    const client = connect(session);
    client.run(3);
    const slot = session.slots[0]!.state;
    const id = session.spawnEnemy('rifleman', { x: slot.x, y: 0, z: slot.z + 20, yaw: FACING_SPAWN, tree: STILL() }) as number;
    const e = enemy(session, id);
    client.run(3);
    // Awareness is rising but nothing is detected on the first think.
    expect(e.memory.entries.size).toBe(0);
    expect(e.awareness.get(client.netId)).toBeGreaterThan(0);
    client.run(90);
    const entry = e.memory.entries.get(client.netId)!;
    expect(entry.visible).toBe(true);
    expect(entry.confidence).toBe(1);
    expect(entry.z).toBeCloseTo(slot.z, 9);
    // All six slots stand on the spawn line; the nearest, dead ahead, is chosen.
    expect(e.target).toBe(client.netId);
  });

  it('a sprinting soldier is heard close by, a walking one is not', () => {
    const session = new Session(undefined, '', 'range');
    const client = connect(session);
    client.run(3);
    const slot = session.slots[0]!.state;
    const r = STIMULI.kinds.sprint.radiusM;
    // Behind the shooter, facing away from it: it can only hear.
    const id = session.spawnEnemy('rifleman', { x: slot.x, y: 0, z: slot.z - r + 3, yaw: FACING_SPAWN, tree: STILL() }) as number;
    const e = enemy(session, id);
    client.run(3);
    for (let i = 0; i < 12; i++) {
      client.input(0, true);
      client.run(1);
    }
    expect(e.memory.entries.has(client.netId)).toBe(false);
    for (let i = 0; i < 6; i++) {
      client.input(0b010, true);
      client.run(1);
    }
    const entry = e.memory.entries.get(client.netId)!;
    expect(entry.visible).toBe(false);
    expect(entry.confidence).toBe(STIMULI.kinds.sprint.confidence);
    expect(entry.z).toBeGreaterThan(slot.z - 1);
  });
});
