/**
 * U-062: an enemy with nothing to shoot takes a downed character prisoner — only one downed at least 2 s, with no
 * squadmate up within 15 m and someone up somewhere — by walking to them and holding them for 5 s. A kill,
 * suppression, a lost path, a squadmate arriving or a revive cancels the hold and it starts over.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DAMAGE, buildTree, createMoveState, raiseSuppression, rememberSeen } from '@sandline/shared';
import { createBrainRegistry } from '../ai/Brain.ts';
import { type NavMesh, initNav } from '../ai/nav/NavMesh.ts';
import { loadWorldNavMesh } from '../ai/nav/bakedNav.ts';
import { type EnemyEntity, Session, type Slot } from './Session.ts';

const TICK_MS = 1000 / 30;
const CAP = DAMAGE.capture;
let mesh: NavMesh;
beforeAll(async () => {
  await initNav();
  mesh = loadWorldNavMesh('range');
});

interface Scene {
  session: Session;
  victim: Slot;
  foe: () => EnemyEntity;
  run: (ticks: number) => void;
  seconds: () => number;
  down: () => void;
}

/** The victim alone and far from everyone (who are up, and far away), one rifleman with nothing in sight. */
function scene(): Scene {
  const session = new Session(undefined, '', 'range', { navMesh: mesh });
  session.slots.forEach((s, i) => {
    if (i > 0) s.state = createMoveState(-60 + i * 4, 0, -95);
  });
  const victim = session.slots[0]!;
  victim.state = createMoveState(-2, 0, -4);
  const id = session.spawnEnemy('rifleman', { x: -6, y: 0, z: 14, yaw: 512, tree: buildTree('rifleman', createBrainRegistry()) }) as number;
  const seconds = () => (session.tick * TICK_MS) / 1000;
  return {
    session,
    victim,
    foe: () => session.enemies.find((e) => e.netId === id)!,
    run: (ticks) => {
      for (let i = 0; i < ticks; i++) session.step((session.tick + 1) * TICK_MS);
    },
    seconds,
    down: () => Object.assign(victim.health, { current: 0, downedAt: seconds() }),
  };
}

/** Runs until a capture job exists, or the limit; returns whether one does. */
function untilJob(s: Scene, seconds: number): boolean {
  for (let i = 0; i < seconds * 30 && s.session.captures.length === 0; i++) s.run(1);
  return s.session.captures.length > 0;
}

describe('capture eligibility (U-062)', () => {
  it('takes no one who has been down less than the minimum', () => {
    const s = scene();
    s.down();
    s.run(Math.floor((CAP.downedMinSeconds - 0.3) * 30));
    expect(s.session.captures).toEqual([]);
    expect(untilJob(s, 3)).toBe(true);
  });

  it('takes no one with a living squadmate within 15 m', () => {
    const s = scene();
    const mate = s.session.slots[1]!;
    mate.state = createMoveState(-2 + CAP.squadmateRadiusM - 1, 0, -4);
    s.down();
    // The squadmate is in sight of the rifleman, who would shoot them down: keep them up.
    for (let i = 0; i < 30 * 5; i++) {
      Object.assign(mate.health, { current: mate.health.max, downedAt: null, diedAt: null });
      s.run(1);
    }
    expect(s.session.captures).toEqual([]);
    expect(s.victim.captured).toBe(false);
  });

  it('takes no one when the squad has no one else up: a wipe is a failure, not a capture', () => {
    const s = scene();
    s.session.slots.forEach((o, i) => {
      if (i > 0) Object.assign(o.health, { current: 0, diedAt: 1 });
    });
    s.down();
    s.run(30 * 6);
    expect(s.session.captures).toEqual([]);
    expect(s.victim.captured).toBe(false);
  });

  it('counts a downed squadmate as no one up, and a captured one too', () => {
    const s = scene();
    s.session.slots.forEach((o, i) => {
      if (i > 0) Object.assign(o.health, { current: 0, downedAt: 0 });
    });
    s.down();
    s.run(30 * 3);
    // The others, downed far away, are themselves eligible: someone is sent, but not because anyone is "up".
    expect(s.session.captures.some((c) => c.slot === s.victim.index)).toBe(false);
  });

  it('refuses a capture that could not finish inside the bleed-out', () => {
    const s = scene();
    // Down long ago: less bleed-out left than a channel takes.
    Object.assign(s.victim.health, { current: 0, downedAt: s.seconds() - (DAMAGE.downed.bleedOutSeconds - CAP.channelSeconds + 1) });
    s.run(30 * 2);
    expect(s.session.captures).toEqual([]);
  });

  it('is not sent while it has a squadmate to shoot', () => {
    const s = scene();
    const mate = s.session.slots[1]!;
    // In the rifleman's sight, but past the radius that would protect the downed one.
    mate.state = createMoveState(-6, 0, -19);
    s.foe().state = createMoveState(-6, 0, 2);
    s.down();
    for (let i = 0; i < 30 * 6; i++) {
      Object.assign(mate.health, { current: mate.health.max, downedAt: null, diedAt: null });
      s.run(1);
    }
    expect(s.foe().target).toBe(mate.netId);
    expect(s.session.captures).toEqual([]);
  });
});

describe('the channel (U-062)', () => {
  it('walks up, holds for the channel time, and the character leaves the map', () => {
    const s = scene();
    s.down();
    expect(untilJob(s, 4)).toBe(true);
    let first: number | null = null;
    for (let i = 0; i < 30 * 20 && !s.victim.captured; i++) {
      s.run(1);
      if (first === null && (s.session.captures[0]?.seconds ?? 0) > 0) first = s.seconds();
    }
    expect(s.victim.captured).toBe(true);
    expect(first).not.toBeNull();
    expect(s.seconds() - first!).toBeGreaterThan(CAP.channelSeconds - 0.2);
    expect(s.seconds() - first!).toBeLessThan(CAP.channelSeconds + 0.2);
    expect(s.victim.prisoner).not.toBeNull();
    expect(s.session.captures).toEqual([]);
    expect(s.victim.health.downedAt).toBeNull();
    // It fires at no one while it does so (U-031 stays): nothing was ever fired.
    expect(s.foe().weaponState.shotIndex).toBe(0);
  });

  it('is cancelled by the capturer dying, and progress is not kept', () => {
    const s = scene();
    s.down();
    untilJob(s, 4);
    while ((s.session.captures[0]?.seconds ?? 0) < 1.5) s.run(1);
    Object.assign(s.foe().health, { current: 0, diedAt: s.seconds() });
    s.run(1);
    expect(s.session.captures).toEqual([]);
    expect(s.victim.captured).toBe(false);
  });

  it('is cancelled by suppression past the threshold, and the capturer is barred before it tries again', () => {
    const s = scene();
    s.down();
    untilJob(s, 4);
    while ((s.session.captures[0]?.seconds ?? 0) < 1.5) s.run(1);
    raiseSuppression(s.foe().suppression, 1, s.seconds());
    s.run(1);
    expect(s.session.captures).toEqual([]);
    // Suppression fades; the barred capturer is not sent again until the retry time has passed.
    s.foe().suppression.level = 0;
    const cancelledAt = s.seconds();
    expect(untilJob(s, 20)).toBe(true);
    expect(s.seconds() - cancelledAt).toBeGreaterThanOrEqual(CAP.retrySeconds - 0.1);
    // and the new channel starts from nothing.
    expect(s.session.captures[0]!.seconds).toBeLessThan(0.1);
  });

  it('is cancelled by the path being lost', () => {
    const s = scene();
    s.down();
    untilJob(s, 4);
    s.foe().pathStatus = 'unreachable';
    s.run(1);
    expect(s.session.captures).toEqual([]);
  });

  it('is cancelled by a squadmate arriving, who can then revive normally', () => {
    const s = scene();
    s.down();
    untilJob(s, 4);
    while ((s.session.captures[0]?.seconds ?? 0) < 1.5) s.run(1);
    s.session.slots[1]!.state = createMoveState(-2, 0, -3);
    s.run(1);
    expect(s.session.captures).toEqual([]);
    expect(s.victim.captured).toBe(false);
    expect(s.victim.health.downedAt).not.toBeNull();
    // They leave again: a fresh hold needs the whole channel.
    s.session.slots[1]!.state = createMoveState(-60, 0, -95);
    expect(untilJob(s, 10)).toBe(true);
    expect(s.session.captures[0]!.seconds).toBeLessThan(0.1);
  });

  it('is cancelled by a revive, and the character is restored, not taken', () => {
    const s = scene();
    s.down();
    untilJob(s, 4);
    while ((s.session.captures[0]?.seconds ?? 0) < 1.5) s.run(1);
    // What a completed revive does to the health (`revive`, T-2.15): back up with a fraction of health.
    Object.assign(s.victim.health, { current: 40, downedAt: null });
    s.run(1);
    expect(s.session.captures).toEqual([]);
    expect(s.victim.captured).toBe(false);
    expect(s.victim.health.current).toBe(40);
  });
});

describe('bots and a capture in progress (U-062)', () => {
  interface Bots {
    botTarget(slot: Slot, now: number): number | null;
    downedNear(index: number): { index: number } | null;
  }

  it('treats the capturer as the priority target, and the prisoner-to-be as the priority revive', () => {
    const s = scene();
    const bots = s.session as unknown as Bots;
    const bot = s.session.slots[1]!;
    // Another downed squadmate is nearer the bot than the one being taken; and a second enemy is nearer the bot too.
    const other = s.session.slots[2]!;
    bot.state = createMoveState(-60, 0, -60);
    other.state = createMoveState(-58, 0, -60);
    Object.assign(other.health, { current: 0, downedAt: s.seconds() });
    const nearer = s.session.spawnEnemy('rifleman', { x: -55, y: 0, z: -60 }) as number;
    s.down();
    expect(untilJob(s, 4)).toBe(true);
    const now = s.seconds();
    rememberSeen(bot.memory, nearer, { x: -55, y: 0, z: -60 }, now, false);
    rememberSeen(bot.memory, s.foe().netId, { x: s.foe().state.x, y: 0, z: s.foe().state.z }, now, false);
    // Before the hold begins nothing is out of the ordinary.
    expect(bots.downedNear(1)?.index).toBe(2);
    while ((s.session.captures[0]?.seconds ?? 0) <= 0) s.run(1);
    expect(bots.botTarget(bot, s.seconds())).toBe(s.foe().netId);
    expect(bots.downedNear(1)?.index).toBe(s.victim.index);
  });
});
