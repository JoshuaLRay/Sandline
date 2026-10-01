/**
 * Bots against armour (U-079): the searches (`ai/armour.ts`) on their own, and the leaves on real `Session`s over the
 * range's navmesh and cover with the friendly tree in every bot slot and a tank to fight.
 *
 * - The data parses and refuses bad rows.
 * - The shell's danger is its flight line, the lock and where it ends.
 * - A rocket is aimed at the hull, led, and never down a lane with a squadmate in it, nor out of its band.
 * - A bot with a launcher fires at a tank in sight and hurts it; one with a squadmate in the way does not.
 * - A bot in the way of a locked shell leaves it before the shell is away and keeps clear until it has landed.
 * - A bot with C4 or a claymore uses it on a tank that has stopped, with the squad unhurt.
 * - An attack order on a tank makes it the bot's target.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ClientConnection,
  PROJECTILE_IDS,
  buildTree,
  createLoopbackPair,
  boxFrom,
  createMoveState,
  getEnemy,
  projectileByIndex,
  requireWorld,
} from '@sandline/shared';
import { type NavMesh, initNav } from '../nav/NavMesh.ts';
import { bakedCoverFor, loadWorldNavMesh } from '../nav/bakedNav.ts';
import { createBrainRegistry } from '../Brain.ts';
import { Session } from '../../session/Session.ts';
import type { ArmourView } from '../actions/combat.ts';
import RAW_ARMOUR from '../armour.json' with { type: 'json' };
import { ARMOUR, chooseRocket, dodgeRing, parseArmourConfig, shellDanger } from '../armour.ts';

const TICK_MS = 1000 / 30;
const ROCKET = PROJECTILE_IDS.indexOf('rocket');
const C4 = PROJECTILE_IDS.indexOf('c4');
const CLAYMORE = PROJECTILE_IDS.indexOf('claymore');
const range = requireWorld('range');
const WORLD = { boxes: range.boxes, groundY: 0 };
const VEHICLE = getEnemy('tank').vehicle!;

let mesh: NavMesh;
beforeAll(async () => {
  await initNav();
  mesh = loadWorldNavMesh('range');
});

/** A stationary tank's view at (x, z), turned toward −z, with a lock when `lock` is given. */
function view(x: number, z: number, lock?: { x: number; y: number; z: number }): ArmourView {
  return {
    netId: 9000,
    x,
    y: 0,
    z,
    centre: { x, y: 1, z },
    radiusM: VEHICLE.hull.radius,
    headingX: 0,
    headingZ: -1,
    speedMps: 0,
    tell: lock ? { until: 10, point: lock } : null,
    shellBlastM: VEHICLE.cannon.blastRadiusM,
    muzzle: { x, y: 2.2, z: z - 3 },
  };
}

describe('armour tuning (U-079)', () => {
  it('parses the committed data and refuses bad rows', () => {
    expect(parseArmourConfig(RAW_ARMOUR)).toEqual(ARMOUR);
    expect(() => parseArmourConfig({ ...RAW_ARMOUR, luck: 1 })).toThrow(/luck/);
    expect(() => parseArmourConfig({ ...RAW_ARMOUR, rocketMaxRangeM: 5 })).toThrow(/rocketMaxRangeM/);
    expect(() => parseArmourConfig({ ...RAW_ARMOUR, hitFraction: 0 })).toThrow(/hitFraction/);
    const { approachM: _gone, ...missing } = RAW_ARMOUR;
    expect(() => parseArmourConfig(missing)).toThrow(/approachM/);
  });
});

describe('where a locked shell hurts (U-079)', () => {
  const lock = { x: 0, y: 1.5, z: 20 };
  const danger = shellDanger(view(0, 45, lock), [])!;

  it('is nothing without a lock', () => {
    expect(shellDanger(view(0, 45), [])).toBeNull();
  });

  it('is the flight line, the lock and where the shell ends, and nowhere beside them', () => {
    // In the line, short of and beyond the lock.
    expect(danger({ x: 0.5, y: 0, z: 30 })).toBe(true);
    expect(danger({ x: 0, y: 0, z: 5 })).toBe(true);
    // At the lock, a little off the line.
    expect(danger({ x: 3, y: 0, z: 20 })).toBe(true);
    // Well off to the side, outside the lock's blast and the line.
    expect(danger({ x: 12, y: 0, z: 20 })).toBe(false);
    expect(danger({ x: -9, y: 0, z: 30 })).toBe(false);
  });

  it('ends at the first wall, so the blast is there and not at the far end of the map', () => {
    const wall = [boxFrom({ id: 'b:wall', x: 0, y: 0, z: 9.5, w: 12, h: 3, d: 1 }, 'blocker')];
    const walled = shellDanger(view(0, 45, lock), wall)!;
    // Beyond the wall the line is no danger; at the wall it is.
    expect(walled({ x: 0, y: 0, z: 2 })).toBe(false);
    expect(walled({ x: 0, y: 0, z: 11 })).toBe(true);
  });

  it('finds the nearest walkable place out of it, or none when it is already out', () => {
    const near = dodgeRing({ x: 0, y: 0, z: 25 }, danger, () => true)!;
    expect(danger(near)).toBe(false);
    expect(Math.hypot(near.x, near.z - 25)).toBeLessThan(10.5);
    expect(dodgeRing({ x: 30, y: 0, z: 25 }, danger, () => true)).toBeNull();
    // Nowhere the mesh can walk to: none.
    expect(dodgeRing({ x: 0, y: 0, z: 25 }, danger, () => false)).toBeNull();
  });
});

describe('a rocket at a tank (U-079)', () => {
  const def = projectileByIndex(ROCKET)!;
  const tank = view(0, 45);
  const at = { x: 1, y: 0, z: 5 };

  it('is found for a tank in its band, meeting the hull', () => {
    const shot = chooseRocket(def, at, tank, [], WORLD)!;
    expect(shot).not.toBeNull();
    expect(Math.hypot(shot.hit.x - tank.centre.x, shot.hit.y - tank.centre.y, shot.hit.z - tank.centre.z)).toBeLessThan(tank.radiusM);
  });

  it('is led: a tank crossing to the right is aimed ahead of where it is', () => {
    const still = chooseRocket(def, at, tank, [], WORLD)!;
    const moving = chooseRocket(def, at, { ...tank, headingX: 1, headingZ: 0, speedMps: 1.6 }, [], WORLD)!;
    expect(moving).not.toBeNull();
    // Yaw is table units; ahead of a tank moving along +x is a different yaw from straight at it.
    expect(moving.yaw).not.toBe(still.yaw);
  });

  it('is not fired outside its band', () => {
    expect(chooseRocket(def, { x: 1, y: 0, z: 39 }, tank, [], WORLD)).toBeNull();
    expect(chooseRocket(def, { x: 1, y: 0, z: -40 }, tank, [], WORLD)).toBeNull();
  });

  it('is not fired down a lane with a squadmate in it, nor with one by the hit', () => {
    const inLane = [{ x: 1, y: 0, z: 12 }];
    expect(chooseRocket(def, at, tank, inLane, WORLD)).toBeNull();
    const byTank = [{ x: 4, y: 0, z: 42 }];
    expect(chooseRocket(def, at, tank, byTank, WORLD)).toBeNull();
    // Off to the side, clear of both, it is fired.
    expect(chooseRocket(def, at, tank, [{ x: 9, y: 0, z: 8 }], WORLD)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// On a session
// ---------------------------------------------------------------------------

type Pouch = { rocket?: number; c4?: number; claymore?: number };

/** A session with the bots far off until a test places one, each very tough, carrying only what a test gives. */
function arena() {
  const session = new Session(undefined, '', 'range', {
    navMesh: mesh,
    cover: bakedCoverFor('range'),
    brainTree: buildTree('friendly', createBrainRegistry()),
    testHumanCount: 1,
  });
  let now = 0;
  const place = (slot: number, x: number, z: number, pouch: Pouch = {}) => {
    const s = session.slots[slot]!;
    s.state = createMoveState(x, 0, z);
    s.pouch.fill(0);
    s.pouch[ROCKET] = pouch.rocket ?? 0;
    s.pouch[C4] = pouch.c4 ?? 0;
    s.pouch[CLAYMORE] = pouch.claymore ?? 0;
  };
  session.slots.forEach((s, i) => place(i, -300 - i * 4, 0));
  const tankAt = (x: number, z: number, yaw = 512) => {
    const id = session.spawnEnemy('tank', { x, y: 0, z, yaw }) as number;
    return session.enemies.find((e) => e.netId === id)!;
  };
  const step = (ticks: number, each?: () => void) => {
    for (let i = 0; i < ticks; i++) {
      now += TICK_MS;
      session.step(now);
      // The squad is not what is measured here, and a shell would kill a soldier outright: very tough, kept so.
      for (const s of session.slots) if (s.health.diedAt === null && s.health.current > 0) Object.assign(s.health, { max: 1e6, current: 1e6 });
      each?.();
    }
  };
  return { session, place, tankAt, step, seconds: () => now / 1000 };
}

describe('a bot with a launcher (U-079)', () => {
  it('fires at a tank in sight and hurts it', () => {
    const a = arena();
    const tank = a.tankAt(0, 45);
    a.place(1, 1, 5, { rocket: 2 });
    a.step(30 * 8);
    const bot = a.session.slots[1]!;
    expect(bot.pouch[ROCKET]).toBeLessThan(2);
    // Bullets are a tenth: a tank down by a rocket's blast, not a bot's rifle.
    expect(tank.health.current).toBeLessThanOrEqual(tank.health.max - 100);
  });

  it('fires nothing without one', () => {
    const a = arena();
    const tank = a.tankAt(0, 45);
    a.place(1, 1, 5);
    a.step(30 * 6);
    const rockets = a.session.projectilesNow().filter((p) => p.kind === ROCKET && p.ownerNetId === a.session.slots[1]!.netId);
    expect(rockets).toHaveLength(0);
    expect(tank.health.current).toBeGreaterThan(tank.health.max - 100);
  });
});

describe('a bot in the way of a locked shell (U-079)', () => {
  it('is out of it before the shell is away, and stays out until it has landed', () => {
    const a = arena();
    const tank = a.tankAt(0, 60);
    a.place(1, 0, 20);
    a.step(2);
    const bot = a.session.slots[1]!;
    const lock = { x: 0, y: 1.5, z: 20 };
    // The tank has locked on the bot's place and will fire in a second: the lock holds because it has nobody it can see.
    const until = a.seconds() + 1;
    tank.tell = { until, netId: bot.netId, point: lock };
    const danger = shellDanger({ ...view(tank.state.x, tank.state.z, lock), tell: { until, point: lock }, muzzle: { x: 0, y: 2.2, z: 57 } }, range.boxes)!;
    expect(danger(bot.state)).toBe(true);
    let outAt: number | null = null;
    a.step(30, () => {
      if (outAt === null && !danger(bot.state)) outAt = a.seconds();
    });
    expect(outAt).not.toBeNull();
    expect(outAt!).toBeLessThan(until);
    // The lock ends (the shell is away); the bot does not walk back into its way.
    tank.tell = null;
    const there = { x: bot.state.x, z: bot.state.z };
    a.step(30);
    expect(danger(bot.state)).toBe(false);
    expect(Math.hypot(bot.state.x - there.x, bot.state.z - there.z)).toBeLessThan(3);
  });
});

describe('a bot with C4 or a claymore (U-079)', () => {
  it('puts C4 by a stopped tank and sets it off with the squad clear', () => {
    const a = arena();
    const tank = a.tankAt(0, 20);
    a.place(1, 0, 6, { c4: 2 });
    a.place(2, 4, 4);
    const before = tank.health.current;
    a.step(30 * 12);
    const bot = a.session.slots[1]!;
    expect(bot.pouch[C4]).toBeLessThan(2);
    // C4 is what hurts armour: well past a rifle's tenth.
    expect(before - tank.health.current).toBeGreaterThanOrEqual(100);
    expect(a.session.projectilesNow().filter((p) => p.kind === C4 && p.ownerNetId === bot.netId)).toHaveLength(0);
  });

  it('lays a claymore before a stopped tank', () => {
    const a = arena();
    const tank = a.tankAt(0, 20);
    a.place(1, 0, 6, { claymore: 1 });
    const before = tank.health.current;
    a.step(30 * 8);
    expect(a.session.slots[1]!.pouch[CLAYMORE]).toBe(0);
    expect(before - tank.health.current).toBeGreaterThanOrEqual(100);
  });
});

describe('an attack order on a tank (U-079)', () => {
  it('makes the tank the bot’s target', () => {
    const a = arena();
    const tank = a.tankAt(0, 45);
    a.place(1, 1, 5);
    // A lead in slot 0 over loopback gives the order, as a player does.
    const pair = createLoopbackPair();
    a.session.addConnection(pair.a, 0);
    const client = new ClientConnection(pair.b, {});
    client.join('lead');
    pair.settle();
    a.place(0, 40, -40);
    client.send({ kind: 'Order', order: 'attack', address: { to: 'slot', index: 1 }, point: null, target: tank.netId });
    pair.settle();
    a.step(30 * 3);
    expect(a.session.slots[1]!.target).toBe(tank.netId);
  });
});
