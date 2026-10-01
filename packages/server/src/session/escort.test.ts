/**
 * U-075: the escorted character on a real session. He is a non-slot, unarmed friendly: he follows the squad, stays or
 * goes on an order to the whole squad, is not an enemy (not counted, not shot at by the bots), is hunted by enemies
 * like a squad member, and his death fails the mission; an extraction with `escort` needs him alive in the area.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ENEMY_IDS, type MissionDef, getEnemy, parseEncounter, requireWorld, spawnFor } from '@sandline/shared';
import { type NavMesh, initNav } from '../ai/nav/NavMesh.ts';
import { loadWorldNavMesh } from '../ai/nav/bakedNav.ts';
import { Session } from './Session.ts';

const TICK_MS = 1000 / 30;
const world = requireWorld('greybox-01');
let mesh: NavMesh;
beforeAll(async () => {
  await initNav();
  mesh = loadWorldNavMesh('greybox-01');
});

const ENCOUNTER = parseEncounter({
  world: 'greybox-01',
  aliveCap: 10,
  probes: [0.3, 1.0, 1.7],
  areas: {},
  groups: [{ id: 'a', members: [{ archetype: 'rifleman', count: 1 }], zone: 'behind-objective', posture: { kind: 'garrison', at: 'objective' }, trigger: { kind: 'time', seconds: 9999 } }],
});

const home = spawnFor(0);
const AREA = { x: home.x + 30, z: home.z, radius: 6 };
const MISSION: MissionDef = {
  id: 'test',
  world: 'greybox-01',
  respawn: false,
  objectives: [{ type: 'reach', label: 'the road', area: AREA, who: 'all', escort: true }],
} as unknown as MissionDef;

function play(mission: MissionDef = MISSION) {
  const session = new Session(undefined, '', world, { encounter: ENCOUNTER, mission, testHumanCount: 0, navMesh: mesh });
  let now = 0;
  const step = (n: number) => {
    for (let i = 0; i < n; i++) {
      now += TICK_MS;
      session.step(now);
    }
  };
  const pow = () => session.enemies.find((e) => e.def.friendly)!;
  const placePow = (x: number, z: number) => session.spawnEnemy('pow', { x, y: home.y, z });
  return { session, step, pow, placePow };
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);

describe('the escorted character', () => {
  it('is a friendly archetype on the wire with its own side and no gun in play', () => {
    expect(ENEMY_IDS.indexOf('pow')).toBe(6);
    expect(getEnemy('pow').friendly).toBe(true);
    expect(getEnemy('rifleman').friendly).toBe(false);
    const { session, placePow } = play();
    expect(session.slots).toHaveLength(6);
    placePow(home.x + 2, home.z);
    expect(session.slots).toHaveLength(6);
    expect(session.enemies).toHaveLength(1);
    expect(session.enemies[0]!.faction).toBe(3);
  });

  it('follows the squad when it moves away', () => {
    const { session, step, placePow, pow } = play();
    placePow(home.x + 2, home.z + 2);
    const squadAt = () => session.slots[0]!.state;
    step(30);
    const before = dist(pow().state, squadAt());
    for (const s of session.slots) s.state = { ...s.state, x: s.state.x + 25 };
    step(30 * 12);
    expect(dist(pow().state, squadAt())).toBeLessThan(Math.max(before, 12));
  });

  it('stays where he is on a hold to the whole squad, and goes on a move', () => {
    const { session, step, placePow, pow } = play();
    placePow(home.x + 2, home.z + 2);
    step(5);
    session.orderFrom(0, { order: 'hold', address: { to: 'all' }, point: null, target: null });
    const stayed = { x: pow().state.x, z: pow().state.z };
    for (const s of session.slots) s.state = { ...s.state, x: s.state.x + 25 };
    step(30 * 5);
    expect(dist(pow().state, stayed)).toBeLessThan(0.5);
    const point = { x: home.x + 12, y: home.y, z: home.z + 2 };
    session.orderFrom(0, { order: 'move', address: { to: 'all' }, point, target: null });
    step(30 * 12);
    expect(dist(pow().state, point)).toBeLessThan(2.5);
    session.orderFrom(0, { order: 'regroup', address: { to: 'all' }, point: null, target: null });
  });

  it('is not an enemy: the mission does not count him and the bots do not target him', () => {
    const { session, step, placePow } = play();
    placePow(home.x + 3, home.z);
    step(60);
    for (const slot of session.slots) expect(slot.target).not.toBe(session.enemies[0]!.netId);
    expect(session.enemies.filter((e) => !e.def.friendly)).toHaveLength(0);
  });

  it('is hunted by an enemy that sees him, as a squad member is', () => {
    const { session, step, placePow, pow } = play();
    for (const s of session.slots) s.state = { ...s.state, x: home.x - 150, z: home.z - 150 };
    placePow(home.x + 2, home.z);
    session.orderFrom(0, { order: 'hold', address: { to: 'all' }, point: null, target: null });
    // One on each side, so whichever way they happen to face, one has him in its view.
    for (const [dx, dz] of [[14, 0], [-14, 0], [0, 14], [0, -14]] as const) {
      expect(session.spawnEnemy('rifleman', { x: home.x + 2 + dx, y: home.y, z: home.z + dz })).not.toBeNull();
    }
    step(30 * 6);
    // They saw him, shot him, and the squad's mission is lost with him.
    expect(pow().health.current).toBeLessThan(pow().health.max);
    expect(session.mission?.state).toBe('failed');
  });

  it('fails the mission when he dies', () => {
    const { session, step, placePow, pow } = play();
    placePow(home.x + 3, home.z);
    step(10);
    expect(session.mission?.state).toBe('progress');
    pow().health.current = 0;
    pow().health.diedAt = 1;
    step(5);
    expect(session.mission?.state).toBe('failed');
  });

  it('does not finish the extraction until he is in the area with the squad', () => {
    const { session, step, placePow, pow } = play();
    placePow(home.x + 3, home.z);
    step(5);
    // The squad is in the area, he is not: not done.
    for (const s of session.slots) s.state = { ...s.state, x: AREA.x, z: AREA.z };
    pow().state = { ...pow().state, x: home.x, z: home.z + 20 };
    step(3);
    expect(session.mission?.state).toBe('progress');
    // He arrives, and it is done.
    pow().state = { ...pow().state, x: AREA.x, z: AREA.z };
    step(5);
    expect(session.mission?.state).toBe('complete');
  });
});
