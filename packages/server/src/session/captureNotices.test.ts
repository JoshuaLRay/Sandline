/**
 * U-064: the squad is told, once each, that a character is being taken, that a capture was stopped, that they were
 * taken, and that they were rescued; the roster names the capturer while the hold lasts.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildTree, createMoveState } from '@sandline/shared';
import { createBrainRegistry } from '../ai/Brain.ts';
import { type NavMesh, initNav } from '../ai/nav/NavMesh.ts';
import { loadWorldNavMesh } from '../ai/nav/bakedNav.ts';
import { Session } from './Session.ts';

const TICK_MS = 1000 / 30;
let mesh: NavMesh;
beforeAll(async () => {
  await initNav();
  mesh = loadWorldNavMesh('range');
});

function scene() {
  const session = new Session(undefined, '', 'range', { navMesh: mesh });
  session.slots.forEach((s, i) => {
    if (i > 0) s.state = createMoveState(-60 + i * 4, 0, -95);
  });
  const victim = session.slots[0]!;
  victim.state = createMoveState(-2, 0, -4);
  const id = session.spawnEnemy('rifleman', { x: -6, y: 0, z: 14, yaw: 512, tree: buildTree('rifleman', createBrainRegistry()) }) as number;
  const said: string[] = [];
  vi.spyOn(session as unknown as { sayToSquad(t: string): void }, 'sayToSquad').mockImplementation((t) => void said.push(t));
  const seconds = () => (session.tick * TICK_MS) / 1000;
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) session.step((session.tick + 1) * TICK_MS);
  };
  Object.assign(victim.health, { current: 0, downedAt: seconds() });
  return { session, victim, id, said, run };
}

function untilHeld(s: ReturnType<typeof scene>): void {
  for (let i = 0; i < 30 * 20 && (s.session.captures[0]?.seconds ?? 0) <= 0; i++) s.run(1);
}

describe('capture notices (U-064)', () => {
  it('says a hold has begun once, names the capturer on the roster, then says they were taken once', () => {
    const s = scene();
    expect(s.session.roster[0]!.takenBy).toBe(-1);
    untilHeld(s);
    s.run(10);
    expect(s.said).toHaveLength(1);
    expect(s.said[0]).toMatch(/is being taken$/);
    expect(s.session.roster[0]).toMatchObject({ captured: false, takenBy: s.id });
    for (let i = 0; i < 30 * 20 && !s.victim.captured; i++) s.run(1);
    s.run(60);
    expect(s.said).toHaveLength(2);
    expect(s.said[1]).toMatch(/was taken prisoner$/);
    expect(s.session.roster[0]).toMatchObject({ captured: true, takenBy: -1 });
  });

  it('says a cancelled capture once, and the roster no longer names a capturer', () => {
    const s = scene();
    untilHeld(s);
    Object.assign(s.session.enemies.find((e) => e.netId === s.id)!.health, { current: 0, diedAt: s.session.tick / 30 });
    s.run(60);
    expect(s.said).toHaveLength(2);
    expect(s.said[1]).toMatch(/was not taken$/);
    expect(s.session.roster[0]).toMatchObject({ captured: false, takenBy: -1 });
  });

  it('says a rescue once', () => {
    const s = scene();
    s.session.captureCharacter(0, { x: 1, y: 0, z: 1 });
    s.said.length = 0;
    expect(s.session.freeCharacter(0)).toBe(true);
    expect(s.session.freeCharacter(0)).toBe(false);
    expect(s.said).toHaveLength(1);
    expect(s.said[0]).toMatch(/was rescued$/);
  });
});
