/**
 * Named worlds (T-3.02): a session is built with a world and collides, shoots
 * and throws against that world's boxes and no other.
 *
 * The range is the only world this build ships, so the second world here is
 * a fixture: one wall three metres ahead of slot 0, and nothing else. The
 * range keeps that lane clear (`worlds/range.json`: x −4.2..6 is open north of
 * spawn), so the same walk, shot and throw that stop at the wall in the
 * fixture sail on in the range — and the fixture has none of the range's
 * posts, rails, figure or cover.
 *
 * Driven over the real wire, as `fire.test.ts` and `projectiles.test.ts` are.
 */
import { describe, expect, it } from 'vitest';
import {
  type Message,
  PROTOCOL_VERSION,
  createLoopbackPair,
  decodeMessage,
  encodeMessage,
  loadWorld,
  spawnFor,
} from '@sandline/shared';
import { Session } from './Session.ts';
import { Registry } from './Registry.ts';

const TICK_MS = 1000 / 30;
const FRAG = 0;
/** Slot 0 faces +Z at yaw 0; the wall's near face is at z = −3.2. */
const WALL_NEAR_Z = -3.2;
const WALL_WORLD = loadWorld({
  id: 'wall-test',
  cover: [{ id: 'wall', x: -3.75, y: 0, z: -3, w: 20, h: 3, d: 0.4 }],
});

/** A client on slot 0 that holds an input, fires, throws, and collects replies. */
function connect(session: Session) {
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  const acks: Extract<Message, { kind: 'JoinAck' }>[] = [];
  const hits: Extract<Message, { kind: 'HitEvent' }>[] = [];
  const detonations: Extract<Message, { kind: 'Detonation' }>[] = [];
  let held = { moveX: 0, moveY: 0 };
  let tick = 0;
  pair.b.onMessage((bytes) => {
    const msg = decodeMessage(bytes);
    if (msg.kind === 'JoinAck') acks.push(msg);
    if (msg.kind === 'HitEvent') hits.push(msg);
    if (msg.kind === 'Detonation') detonations.push(msg);
  });
  pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'walker', room: '' }));
  pair.settle();
  const send = (msg: Message): void => {
    pair.b.send(encodeMessage(msg));
    pair.settle();
  };
  return {
    acks,
    hits,
    detonations,
    hold(moveY: number): void {
      held = { moveX: 0, moveY };
    },
    fire(): void {
      send({ kind: 'Fire', tick, yaw: 0, pitch: 0, renderTimeMs: tick * TICK_MS, weapon: 0, ads: false });
    },
    throwLevel(): void {
      send({ kind: 'Throw', tick, yaw: 0, pitch: 0, projectile: FRAG });
    },
    /** Step `count` ticks, resending the held input every tick as a real client does. */
    run(count: number): void {
      for (let i = 0; i < count; i++) {
        tick += 1;
        send({ kind: 'Input', tick, ...held, yaw: 0, pitch: 0, buttons: 0 });
        session.step(session.tick * TICK_MS + TICK_MS);
        pair.settle();
      }
    },
  };
}

describe('a session built with a named world (T-3.02)', () => {
  it('names its world in JoinAck: the range by default, or whatever it was built with', () => {
    const range = connect(new Session());
    expect(range.acks[0]?.world).toBe('range');
    const walled = connect(new Session(undefined, '', WALL_WORLD));
    expect(walled.acks[0]?.world).toBe('wall-test');
    expect(new Session(undefined, '', 'range').world.id).toBe('range');
    expect(() => new Session(undefined, '', 'atlantis')).toThrow(/unknown world 'atlantis'/);
  });

  it('collides with its own boxes and no other', () => {
    const rangeSession = new Session();
    const range = connect(rangeSession);
    const walled = new Session(undefined, '', WALL_WORLD);
    const wall = connect(walled);
    for (const c of [range, wall]) {
      c.hold(1);
      c.run(60); // two seconds at 4.2 m/s: 8.4 m, well past the wall's line
    }
    const radius = 0.35;
    // Stopped at the wall's face, one capsule radius short of it.
    expect(walled.slots[0]!.state.z).toBeCloseTo(WALL_NEAR_Z - radius, 3);
    // The same walk in the range goes straight through where the wall would be.
    expect(rangeSession.slots[0]!.state.z).toBeGreaterThan(spawnFor(0).z + 7);
  });

  it('stops a shot on its own boxes and no other', () => {
    const rangeSession = new Session();
    const range = connect(rangeSession);
    const wall = connect(new Session(undefined, '', WALL_WORLD));
    for (const c of [range, wall]) {
      c.run(2);
      c.fire();
      c.run(2);
    }
    const onWall = wall.hits[0];
    expect(onWall).toBeDefined();
    expect(onWall!.targetNetId).toBe(0);
    expect(onWall!.z).toBeCloseTo(WALL_NEAR_Z, 1);
    // In the range the lane is clear: the round goes far beyond z = −3.2.
    expect(range.hits[0]).toBeDefined();
    expect(range.hits[0]!.z).toBeGreaterThan(10);
  });

  it('bounces a grenade off its own boxes and no other', () => {
    const range = connect(new Session());
    const wall = connect(new Session(undefined, '', WALL_WORLD));
    for (const c of [range, wall]) {
      c.run(2);
      c.throwLevel();
      c.run(150); // five seconds: longer than any fuse
    }
    expect(wall.detonations).toHaveLength(1);
    expect(range.detonations).toHaveLength(1);
    // Thrown level at a wall three metres off: it comes down on this side of it.
    expect(wall.detonations[0]!.z).toBeLessThan(WALL_NEAR_Z);
    // The same throw in the range carries past where the wall would be.
    expect(range.detonations[0]!.z).toBeGreaterThan(WALL_NEAR_Z);
  });

  it('holds only its own boxes: none of the range pieces come with a world that does not ask', () => {
    expect(WALL_WORLD.boxes.map((b) => b.id)).toEqual(['wall']);
  });
});

describe('the registry builds every room with the host world (T-3.02)', () => {
  it('passes the configured world to each session', () => {
    const registry = new Registry({ world: 'range' });
    expect(registry.create(0)?.session.world.id).toBe('range');
    expect(new Registry().create(0)?.session.world.id).toBe('range');
  });
});
