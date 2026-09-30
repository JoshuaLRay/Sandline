/**
 * U-067: a tank on a session drives its path at the set speed, stops at the end, waits at a wall or a script's
 * blocker and goes on when it opens, does not run a soldier over, and drives no more once it is dead. The hitbox
 * follows its heading.
 */
import { describe, expect, it } from 'vitest';
import { TICK_SECONDS, type WorldBox, boxFrom, getEnemy } from '@sandline/shared';
import { resolveShot } from '../net/lagComp.ts';
import { Session } from './Session.ts';

const VEHICLE = getEnemy('tank').vehicle!;
const TICK_MS = TICK_SECONDS * 1000;
/** The range is open ground along x = 0 from z = 10 to z = 70. */
const START = { x: 0, y: 0, z: 10 };

interface Internals {
  setBlocker(b: { id: string; active: boolean; boxes: WorldBox[] }): void;
  hitboxes: import('../net/lagComp.ts').HitboxHistory;
  nowMs: number;
}

function play(path: { x: number; z: number }[] | undefined, at = START, yaw = 0) {
  const session = new Session(undefined, '', 'range', { roomLobby: false });
  const id = session.spawnEnemy('tank', { ...at, yaw, ...(path ? { path } : {}) }) as number;
  const enemy = session.enemies.find((e) => e.netId === id)!;
  let now = 0;
  const step = (n: number) => {
    for (let i = 0; i < n; i++) {
      now += TICK_MS;
      session.step(now);
    }
  };
  // The soldiers stand clear of the road, off to one side.
  for (const s of session.slots) s.state = { ...s.state, x: -40 - s.index, z: 0 };
  const wall = (id: string, z: number, active: boolean) =>
    (session as unknown as Internals).setBlocker({ id, active, boxes: [boxFrom({ id: `b:${id}`, x: 0, y: 0, z, w: 12, h: 3, d: 0.5 }, 'blocker')] });
  return { session, enemy, step, wall, x: session as unknown as Internals };
}

describe('a tank driving on a session (U-067)', () => {
  it('drives its path at the set speed and stops at the end', () => {
    const { enemy, step } = play([{ x: 0, z: 40 }]);
    step(30);
    const a = enemy.state.z;
    step(30);
    // A steady 1.6 m/s.
    expect(enemy.state.z - a).toBeCloseTo(VEHICLE.speedMps, 1);
    expect(enemy.speed).toBeCloseTo(VEHICLE.speedMps, 1);
    step(30 * 40);
    expect(enemy.drive?.phase).toBe('arrived');
    expect(Math.abs(enemy.state.z - 40)).toBeLessThanOrEqual(VEHICLE.arriveM + 0.1);
    const there = enemy.state.z;
    step(60);
    expect(enemy.state.z).toBe(there);
    expect(enemy.speed).toBe(0);
  });

  it('stands still when given no path', () => {
    const { enemy, step } = play(undefined);
    step(90);
    expect([enemy.state.x, enemy.state.z]).toEqual([START.x, START.z]);
    expect(enemy.drive).toBeNull();
  });

  it('turns its hull on the spot toward a path that leaves to the side, and replicates the heading', () => {
    const { enemy, step } = play([{ x: 30, z: 10 }]);
    step(60);
    expect(enemy.state.x).toBe(0);
    expect(enemy.yaw).toBeGreaterThan(0);
    step(30 * 6);
    // A quarter turn right is 256 wire units; it has turned and is on its way.
    expect(enemy.yaw).toBeGreaterThan(240);
    expect(enemy.yaw).toBeLessThan(272);
    expect(enemy.state.x).toBeGreaterThan(1);
    expect(enemy.turretYaw).toBe(enemy.yaw);
  });

  it('waits at a wall that crosses the road and goes on when the script opens it', () => {
    const { enemy, step, wall } = play([{ x: 0, z: 60 }]);
    wall('gate', 30, true);
    step(30 * 30);
    const held = enemy.state.z;
    expect(enemy.drive?.phase).toBe('blocked');
    // Stopped short: its nose (half a length and a margin ahead of it) is clear of the wall.
    expect(held).toBeLessThan(30 - 0.25 - 1.6);
    expect(held).toBeGreaterThan(30 - 0.25 - 1.6 - 1.5);
    step(60);
    expect(enemy.state.z).toBe(held);
    wall('gate', 30, false);
    step(30 * 40);
    expect(enemy.drive?.phase).toBe('arrived');
    expect(enemy.state.z).toBeGreaterThan(55);
  });

  it('does not run a soldier over: it waits for them to move', () => {
    const { session, enemy, step } = play([{ x: 0, z: 60 }]);
    const soldier = session.slots[2]!;
    soldier.state = { ...soldier.state, x: 0, z: 25 };
    step(30 * 30);
    expect(enemy.drive?.phase).toBe('blocked');
    expect(enemy.state.z).toBeLessThan(25 - VEHICLE.radiusM);
    soldier.state = { ...soldier.state, x: -40, z: 0 };
    step(30 * 40);
    expect(enemy.drive?.phase).toBe('arrived');
  });

  it('drives no more once it is dead, and its hitbox lies where and as it last stood', () => {
    const { enemy, step, x } = play([{ x: 0, z: 60 }]);
    step(60);
    Object.assign(enemy.health, { current: 0, diedAt: x.nowMs / 1000 });
    const z = enemy.state.z;
    step(120);
    expect(enemy.state.z).toBe(z);
  });

  it('its body turns with the heading it drives: 2.5 m off its middle along the road it is hit, as a hull long on that road is, and not if it still faced north', () => {
    const { enemy, step, x } = play([{ x: 30, z: 10 }]);
    step(30 * 8);
    const hit = resolveShot(
      x.hitboxes,
      { shooterNetId: 1, ray: { origin: { x: enemy.state.x + 2.5, y: 1, z: enemy.state.z - 8 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 30 }, nowMs: x.nowMs, clientRenderTimeMs: x.nowMs },
      undefined,
      [],
    );
    expect(enemy.yaw).toBeGreaterThan(240);
    expect(hit).toMatchObject({ netId: enemy.netId, part: 'hull' });
  });

  it('the same shot misses a tank that faces north', () => {
    const { enemy, step, x } = play([{ x: 0, z: 60 }]);
    step(30);
    const hit = resolveShot(
      x.hitboxes,
      { shooterNetId: 1, ray: { origin: { x: enemy.state.x + 2.5, y: 1, z: enemy.state.z - 8 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 30 }, nowMs: x.nowMs, clientRenderTimeMs: x.nowMs },
      undefined,
      [],
    );
    // (The range has targets of its own down the road: whatever this meets, it is not the tank.)
    expect(hit?.netId).not.toBe(enemy.netId);
  });
});
