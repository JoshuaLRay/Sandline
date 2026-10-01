/**
 * An ordered attack on one rifleman who holds and fires, on a real `Session` over the range's navmesh and baked cover
 * (U-086): the bot stands where it has a line and fires, and wins. 24 starts (range 20-44 m, six lanes); measured per
 * run: the damage the bot takes before the rifleman is down and the ticks the rifleman has a clear line to it.
 *
 * Pinned because the obvious change was tried and made it worse: having the ordered attacker fight with the free-fight
 * cover cycle (take cover, peek, hide) lost the bot in 5 of the 24 and killed the rifleman in only 13, against 0 and 24
 * for standing and firing (mean damage 34 against 9). A change here has to beat these numbers, not the intuition.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ClientConnection,
  DEFAULT_MUZZLE_RIG,
  buildTree,
  createLoopbackPair,
  createMoveState,
  eyePosition,
  isDead,
  rayWorld,
  requireWorld,
} from '@sandline/shared';
import { createBrainRegistry } from '../Brain.ts';
import { type NavMesh, initNav } from '../nav/NavMesh.ts';
import { bakedCoverFor, loadWorldNavMesh } from '../nav/bakedNav.ts';
import { Session } from '../../session/Session.ts';

const TICK_MS = 1000 / 30;
const BOXES = requireWorld('range').boxes;
let mesh: NavMesh;
beforeAll(async () => {
  await initNav();
  mesh = loadWorldNavMesh('range');
});

interface Run {
  hpLost: number;
  exposedTicks: number;
  killedAfter: number | null;
  shots: number;
  foeShots: number;
}

/** Slot 1 ordered to attack a holding rifleman at `foeAt`; the rest parked far off; nobody healed. */
function duel(botAt: { x: number; z: number }, foeAt: { x: number; z: number }, seconds = 25): Run {
  const session = new Session(undefined, '', 'range', {
    navMesh: mesh,
    cover: bakedCoverFor('range'),
    brainTree: buildTree('friendly', createBrainRegistry()),
  });
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  let tick = 0;
  const client = new ClientConnection(pair.b, {});
  client.join('lead');
  pair.settle();
  session.slots.forEach((s, i) => (s.state = i === 0 ? createMoveState(40, 0, -40) : i === 1 ? createMoveState(botAt.x, 0, botAt.z) : createMoveState(40 - i * 3, 0, -42)));
  const foeId = session.spawnEnemy('rifleman', { x: foeAt.x, y: 0, z: foeAt.z, yaw: 0, posture: { kind: 'hold', post: { x: foeAt.x, y: 0, z: foeAt.z }, face: { x: botAt.x, z: botAt.z }, route: [], area: null, leg: 0 }, tree: buildTree('rifleman', createBrainRegistry()) }) as number;
  const foe = session.enemies.find((e) => e.netId === foeId)!;
  const bot = session.slots[1]!;
  client.send({ kind: 'Order', order: 'attack', address: { to: 'slot', index: 1 }, point: null, target: foeId });
  pair.settle();
  let exposed = 0;
  let killedAfter: number | null = null;
  for (let t = 0; t < seconds * 30; t++) {
    client.send({ kind: 'Input', tick: ++tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0 });
    pair.settle();
    session.step((session.tick + 1) * TICK_MS);
    if (isDead(foe.health)) {
      killedAfter ??= t / 30;
      break;
    }
    if (isDead(bot.health)) break;
    const eye = eyePosition(foe.state.x, foe.state.y, foe.state.z, DEFAULT_MUZZLE_RIG, 'standing');
    const chest = { x: bot.state.x, y: bot.state.y + (bot.state.crouched ? 0.6 : 1.1), z: bot.state.z };
    const d = { x: chest.x - eye.x, y: chest.y - eye.y, z: chest.z - eye.z };
    const len = Math.hypot(d.x, d.y, d.z);
    if (rayWorld({ origin: eye, direction: { x: d.x / len, y: d.y / len, z: d.z / len }, maxDistance: len }, BOXES) === null) exposed++;
  }
  return { hpLost: 100 - bot.health.current, exposedTicks: exposed, killedAfter, shots: bot.weaponState.shotIndex, foeShots: foe.weaponState.shotIndex };
}

describe('an ordered attack on a rifleman who holds and fires (U-086)', () => {
  it('stands, fires and wins over a grid of starts', () => {
    const runs: Run[] = [];
    for (const range of [20, 28, 36, 44]) {
      for (const dx of [-6, -3, 0, 3, 6, 9]) {
        runs.push(duel({ x: dx, z: -10 }, { x: dx + 4, z: -10 + range }));
      }
    }
    const down = runs.filter((r) => r.hpLost >= 100).length;
    const won = runs.filter((r) => r.killedAfter !== null).length;
    const mean = (f: (r: Run) => number) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
    const line = `grid x${runs.length}: bot down ${down}, foe down ${won}, mean hp lost ${mean((r) => r.hpLost).toFixed(1)}, mean exposed ${mean((r) => r.exposedTicks).toFixed(0)} ticks, mean foe-down time ${(runs.filter((r) => r.killedAfter !== null).reduce((a, r) => a + r.killedAfter!, 0) / Math.max(1, won)).toFixed(1)} s`;
    console.log(line);
    expect(down, line).toBe(0);
    expect(won, line).toBe(runs.length);
    expect(mean((r) => r.hpLost), line).toBeLessThan(20);
  }, 30000);
});
