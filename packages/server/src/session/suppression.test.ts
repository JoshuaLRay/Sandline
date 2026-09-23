/**
 * Suppression on the session (T-3.16).
 *
 * The curve, the capsule test and the cone arithmetic are unit-tested in
 * `shared/src/sim/suppression.test.ts` with numbers of their own. These prove
 * the session applies them: a round past an enemy's capsule raises its level
 * and one that hits or goes wide does not, an impact and a blast nearby count,
 * a squadmate's fire does not pin the squad, a suppressed human's shots spread
 * wider by the data's amount, a suppressed enemy's aim widens, and the level
 * reaches the page as the `Suppression` component. A loopback client in slot 0
 * does the shooting, so its shots are the ones a real `Fire` makes.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPONENT_IDS,
  DEFAULT_MUZZLE_RIG,
  type Message,
  PROTOCOL_VERSION,
  SUPPRESSION,
  SnapshotStore,
  buildTree,
  createHealth,
  createLoopbackPair,
  createMoveState,
  decodeMessage,
  encodeMessage,
  eyePosition,
  getWeapon,
  parseTreeDef,
  suppressionFromWire,
  suppressionLevel,
  suppressionToWire,
} from '@sandline/shared';
import { type BrainTree, createBrainRegistry } from '../ai/Brain.ts';
import { DEFAULT_HITBOX } from '../net/lagComp.ts';
import { type EnemyEntity, Session } from './Session.ts';

/** A rifleman that stands where it is put: the archetype's own tree fights (T-3.23), and these measure what it senses. */
const STILL = () => buildTree('idle', createBrainRegistry());

const TICK_MS = 1000 / 30;
const CARBINE = getWeapon('carbine');
/** Wire yaw facing −Z, towards the spawn line. */
const FACING_SPAWN = 512;

type HitEvent = Extract<Message, { kind: 'HitEvent' }>;

/** Yaw/pitch in TABLE units from `eye` at a point — what a Fire carries. */
function aim(eye: { x: number; y: number; z: number }, at: { x: number; y: number; z: number }): { yaw: number; pitch: number } {
  const dx = at.x - eye.x;
  const dy = at.y - eye.y;
  const dz = at.z - eye.z;
  const table = (rad: number): number => ((Math.round((rad / (Math.PI * 2)) * 4096) % 4096) + 4096) % 4096;
  return { yaw: table(Math.atan2(dx, dz)), pitch: table(Math.asin(dy / Math.hypot(dx, dy, dz))) };
}

/** A client in slot 0 that acknowledges deltas, keeps the latest decoded snapshot, and fires on request. */
function connect(session: Session) {
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  const store = new SnapshotStore();
  const hits: HitEvent[] = [];
  let latestTick = -1;
  let now = 0;
  pair.b.onMessage((bytes) => {
    let msg: Message;
    try {
      msg = decodeMessage(bytes);
    } catch {
      return;
    }
    if (msg.kind === 'HitEvent') hits.push(msg);
    if (msg.kind === 'Delta') {
      const result = store.applyDelta(msg.tick, msg.baselineTick, msg.payload);
      if (result.ok) {
        latestTick = msg.tick;
        pair.b.send(encodeMessage({ kind: 'Ack', tick: msg.tick }));
      }
    }
  });
  pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'shooter', room: '' }));
  pair.settle();
  const slot = session.slots[0]!;
  return {
    hits,
    eye() {
      return eyePosition(slot.state.x, slot.state.y, slot.state.z, DEFAULT_MUZZLE_RIG);
    },
    fire(at: { x: number; y: number; z: number }): void {
      pair.b.send(encodeMessage({ kind: 'Fire', tick: session.tick, ...aim(this.eye(), at), renderTimeMs: now, weapon: 0, ads: true }));
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
    /** The replicated `Suppression` of slot 0 in the newest snapshot, as a level. */
    replicated(): number | null {
      const snap = store.get(latestTick);
      const mine = snap?.entities.find((e) => e.netId === slot.netId);
      const wire = mine?.components[COMPONENT_IDS.Suppression]?.[0];
      return wire === undefined ? null : suppressionFromWire(wire as number);
    },
  };
}

function enemy(session: Session, id: number): EnemyEntity {
  return session.enemies.find((e) => e.netId === id)!;
}

function level(session: Session, id: number): number {
  return suppressionLevel(enemy(session, id).suppression, session.tick * (TICK_MS / 1000));
}

/** At chest height beside a soldier standing at `feet`, `gap` clear of its capsule. */
function beside(feet: { x: number; y: number; z: number }, gap: number) {
  return { x: feet.x + DEFAULT_HITBOX.radius + gap, y: feet.y + DEFAULT_HITBOX.centerOffsetY, z: feet.z };
}

/** A shooter 30 m down range facing the spawn line, and the client, both ready. */
function withEnemy() {
  const session = new Session(undefined, '', 'range');
  const client = connect(session);
  client.run(3);
  const eye = client.eye();
  const id = session.spawnEnemy('rifleman', { x: eye.x, y: 0, z: eye.z + 30, yaw: FACING_SPAWN, tree: STILL() }) as number;
  client.run(3);
  return { session, client, id };
}

/** The angle, degrees, between a shot's path and the line from its origin to `at`. */
function errorDeg(hit: HitEvent, at: { x: number; y: number; z: number }): number {
  const a = { x: hit.x - hit.originX, y: hit.y - hit.originY, z: hit.z - hit.originZ };
  const b = { x: at.x - hit.originX, y: at.y - hit.originY, z: at.z - hit.originZ };
  const cos = (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
  return (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
}

describe('suppression on the session (T-3.16)', () => {
  it('a round 0.4 m past an enemy suppresses it; one 3 m wide, and one that hits, do not', () => {
    const { session, client, id } = withEnemy();
    const feet = enemy(session, id).state;
    // Far past the enemy and into the sky beyond, so no impact lands near it either.
    const through = (p: { x: number; y: number; z: number }) => {
      const e = client.eye();
      return { x: e.x + (p.x - e.x) * 3, y: e.y + (p.y - e.y) * 3, z: e.z + (p.z - e.z) * 3 };
    };
    client.fire(through(beside(feet, 3)));
    client.run(1);
    expect(level(session, id)).toBe(0);

    client.run(10);
    client.fire(through(beside(feet, 0.4)));
    client.run(1);
    expect(level(session, id)).toBeCloseTo(SUPPRESSION.nearMiss, 9);

    // A second enemy, hit square: hurt, not suppressed.
    const other = session.spawnEnemy('rifleman', { x: feet.x + 6, y: 0, z: feet.z, yaw: FACING_SPAWN, tree: STILL() }) as number;
    client.run(3);
    client.fire({ x: feet.x + 6, y: DEFAULT_HITBOX.centerOffsetY, z: feet.z });
    client.run(1);
    expect(enemy(session, other).health.current).toBeLessThan(enemy(session, other).health.max);
    expect(level(session, other)).toBe(0);
  });

  it('rises per near miss, saturates, then decays on the data curve', () => {
    const { session, client, id } = withEnemy();
    const feet = enemy(session, id).state;
    const past = beside(feet, 0.3);
    const far = { x: past.x + (past.x - client.eye().x) * 2, y: past.y + (past.y - client.eye().y) * 2, z: past.z + 60 };
    const levels: number[] = [];
    for (let i = 0; i < 8; i++) {
      client.fire(far);
      client.run(3);
      levels.push(level(session, id));
    }
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1]!);
    expect(levels[0]).toBeGreaterThan(0);
    expect(levels.at(-1)).toBe(1);

    // Held for the hold, then down the line.
    const at = enemy(session, id).suppression.at;
    client.run(Math.round((SUPPRESSION.holdSeconds / 2) * 30));
    expect(level(session, id)).toBe(1);
    const t0 = at + SUPPRESSION.holdSeconds + 1;
    while (session.tick * (TICK_MS / 1000) < t0) client.run(1);
    const expected = 1 - (session.tick * (TICK_MS / 1000) - at - SUPPRESSION.holdSeconds) * SUPPRESSION.decayPerSec;
    expect(level(session, id)).toBeCloseTo(expected, 9);
    client.run(Math.ceil((1 / SUPPRESSION.decayPerSec) * 30));
    expect(level(session, id)).toBe(0);
  });

  it('a round striking cover beside it suppresses it; a squadmate is not suppressed by the squad', () => {
    const session = new Session(undefined, '', 'range');
    const client = connect(session);
    client.run(3);
    // Behind east wall A (x 6..9, z 3.85..4.15, 2.4 m tall), 1.3 m clear of
    // its face: the round stops on the wall, too far off for a near miss and
    // close enough for an impact.
    const id = session.spawnEnemy('rifleman', { x: 7.5, y: 0, z: 4.15 + DEFAULT_HITBOX.radius + 1.3, yaw: FACING_SPAWN, tree: STILL() }) as number;
    client.run(3);
    client.fire({ x: 7.5, y: 1.2, z: 3.85 });
    client.run(1);
    expect(client.hits.at(-1)?.targetNetId).toBe(0);
    expect(level(session, id)).toBeCloseTo(SUPPRESSION.impact, 9);

    // Past a squadmate's ear: the squad's own fire pins nobody down.
    const mate = session.slots[1]!;
    mate.state = createMoveState(client.eye().x + 0.4, 0, client.eye().z + 10);
    client.run(1);
    client.fire({ x: mate.state.x - DEFAULT_HITBOX.radius - 0.2, y: 1.2, z: mate.state.z + 50 });
    client.run(1);
    expect(suppressionLevel(mate.suppression, session.tick * (TICK_MS / 1000))).toBe(0);
  });

  it("a suppressed human's measured spread is wider by the data's amount", () => {
    /** Widest angular error over a run of single aimed shots, bloom recovered between them. */
    const widest = (suppressed: boolean): number => {
      const session = new Session(undefined, '', 'range');
      const client = connect(session);
      client.run(3);
      const slot = session.slots[0]!;
      const eye = client.eye();
      const at = { x: eye.x, y: eye.y + 20, z: eye.z + 100 };
      let worst = 0;
      let shots = 0;
      for (let t = 0; shots < 400 && t < 30 * 600; t++) {
        if (suppressed) slot.suppression = { level: 1, at: session.tick * (TICK_MS / 1000) };
        if (t % 10 === 0) {
          const before = client.hits.length;
          client.fire(at);
          for (const h of client.hits.slice(before)) {
            worst = Math.max(worst, errorDeg(h, at));
            shots++;
          }
        }
        client.run(1);
      }
      expect(shots).toBe(400);
      return worst;
    };
    const plain = widest(false);
    const suppressed = widest(true);
    console.log(`spread: ${plain.toFixed(3)}° plain, ${suppressed.toFixed(3)}° at full suppression (data: +${SUPPRESSION.coneDeg}°)`);
    // The widest of 400 uniform-disc samples is within a percent of the edge; one angle unit is 0.088°.
    expect(plain).toBeGreaterThan(CARBINE.adsSpreadDeg * 0.9);
    expect(suppressed - plain).toBeGreaterThan(SUPPRESSION.coneDeg - 0.15);
    expect(suppressed - plain).toBeLessThan(SUPPRESSION.coneDeg + 0.15);
  });

  it("a suppressed enemy's aim is wider", () => {
    const meanError = (suppressed: boolean): number => {
      const session = new Session(undefined, '', 'range');
      const client = connect(session);
      client.run(3);
      const target = session.slots[0]!;
      const tree: BrainTree = buildTree(
        parseTreeDef({ id: 'test-shoot', root: { type: 'action', name: 'shoot' } }),
        createBrainRegistry().action('shoot', ({ blackboard }) => {
          blackboard.set('fireAt', target.netId);
          return 'running';
        }),
      );
      const id = session.spawnEnemy('rifleman', { x: target.state.x, y: 0, z: target.state.z + 20, yaw: FACING_SPAWN, tree }) as number;
      const chest = { x: target.state.x, y: target.state.y + DEFAULT_HITBOX.centerOffsetY, z: target.state.z };
      client.run(60, () => Object.assign(target.health, createHealth()));
      const from = client.hits.length;
      client.run(30 * 20, () => {
        Object.assign(target.health, createHealth());
        if (suppressed) enemy(session, id).suppression = { level: 1, at: session.tick * (TICK_MS / 1000) };
      });
      const errors = client.hits.slice(from).filter((h) => h.shooterNetId === id).map((h) => errorDeg(h, chest));
      expect(errors.length).toBeGreaterThan(50);
      return errors.reduce((a, b) => a + b, 0) / errors.length;
    };
    const plain = meanError(false);
    const suppressed = meanError(true);
    console.log(`enemy aim: mean error ${plain.toFixed(2)}° plain, ${suppressed.toFixed(2)}° at full suppression`);
    expect(suppressed).toBeGreaterThan(plain * 1.5);
  });

  it("the level reaches the page as the slot's Suppression component", () => {
    const session = new Session(undefined, '', 'range');
    const client = connect(session);
    client.run(3);
    expect(client.replicated()).toBe(0);
    const slot = session.slots[0]!;
    slot.suppression = { level: 0.5, at: session.tick * (TICK_MS / 1000) };
    client.run(1);
    expect(client.replicated()).toBeCloseTo(suppressionFromWire(suppressionToWire(0.5)), 12);
    // It decays on the wire as it does on the server.
    client.run(Math.round((SUPPRESSION.holdSeconds + 0.5) * 30));
    const now = session.tick * (TICK_MS / 1000);
    expect(client.replicated()).toBe(suppressionFromWire(suppressionToWire(suppressionLevel(slot.suppression, now))));
    expect(client.replicated()).toBeLessThan(0.5);
  });
});
