import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encounterFor, rayWorld, requireWorld, supportUnder, createMoveState, stepCharacter, TICK_SECONDS, DEFAULT_MOVE_CONFIG } from '@sandline/shared';
import { initNav, type NavMesh, type NavPoint } from '../../server/src/ai/nav/NavMesh.ts';
import { loadWorldNavMesh } from '../../server/src/ai/nav/bakedNav.ts';

import { PathFollower } from '../../server/src/ai/locomotion/followPath.ts';

const world = requireWorld('qalat-road');
const surface = (p: { x: number; z: number }): NavPoint => ({ ...p, y: supportUnder(p.x, p.z, 0, Infinity, world.boxes, 0) });
let nav: NavMesh;
function clear(from: NavPoint, to: NavPoint): boolean {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return rayWorld({ origin: from, direction: { x: dx / distance, y: dy / distance, z: dz / distance }, maxDistance: distance }, world.boxes) === null;
}
function connected(from: NavPoint, to: NavPoint): void {
  const path = nav.path(from, to);
  expect(path).not.toBeNull();
  const end = path!.points.at(-1)!;
  expect(Math.sqrt((end.x - to.x) ** 2 + (end.z - to.z) ** 2)).toBeLessThan(.5);
  expect(Math.abs(end.y - to.y)).toBeLessThan(.5);
}

describe('U-092 valley routes and authored sight lines', () => {
  beforeAll(async () => { await initNav(); nav = loadWorldNavMesh(world.id); });
  afterAll(() => nav.destroy());
  it('connects each named lane to the compound and back to extraction', () => {
    const m = world.mission!;
    expect(m.routes.map((r) => r.id)).toEqual(['riverbed', 'road', 'terraces']);
    for (const route of m.routes) {
      const stops = [m.start, ...route.via, m.objective].map(surface);
      for (let i = 1; i < stops.length; i++) {
        connected(stops[i - 1]!, stops[i]!);
        connected(stops[i]!, stops[i - 1]!);
      }
    }
  });
  it('connects the terraces along continuous higher ground and down to the east gate', () => {
    const stops = [surface({ x: 40, z: 16 }), surface({ x: 40, z: 44 }), surface({ x: 40, z: 96 }), surface({ x: 40, z: 164 }), surface({ x: 40, z: 188 })];
    expect(stops.map((p) => p.y)).toEqual([0, 1, 2, 3.25, 0]);
    for (let i = 1; i < stops.length; i++) {
      connected(stops[i - 1]!, stops[i]!);
      connected(stops[i]!, stops[i - 1]!);
    }
    connected(surface({ x: 40, z: 162 }), surface({ x: 12, z: 162 }));
    connected(surface({ x: 12, z: 162 }), surface({ x: 40, z: 162 }));
    expect(clear({ x: 26, y: 4.85, z: 164 }, { x: 20, y: 1.6, z: 182 })).toBe(true);
  });
  it('keeps the river lower than the road banks and adds shallow walkable river sills', () => {
    expect(surface({ x: -40, z: 60 }).y).toBe(0);
    expect(surface({ x: -20, z: 60 }).y).toBe(1);
    expect(surface({ x: 19, z: 110 }).y).toBe(1);
    expect(surface({ x: -40, z: 32 }).y).toBe(.75);
    expect(surface({ x: -40, z: 158 }).y).toBe(.75);
  });
  for (const route of world.mission!.routes) {
    for (const reverse of [false, true]) {
      it(`walks ${route.id} ${reverse ? 'south' : 'north'} with the actual character controller and bot path follower`, () => {
        const stops = [world.mission!.start, ...route.via, world.mission!.objective].map(surface);
        if (reverse) stops.reverse();
        let state = createMoveState(stops[0]!.x, stops[0]!.y, stops[0]!.z);
        const follower = new PathFollower(nav, world.boxes);
        let highest = state.y;
        for (const goal of stops.slice(1)) {
          let arrived = false;
          for (let tick = 0; tick < 2400; tick++) {
            const { input, status } = follower.step(state, { goal, pace: 'walk' }, 0);
            if (status === 'arrived') {
              for (let settle = 0; settle < 30; settle++) state = stepCharacter(state, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, world.boxes);
              arrived = true; break;
            }
            state = stepCharacter(state, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, world.boxes);
            highest = Math.max(highest, state.y);
            expect(state.y).toBeGreaterThanOrEqual(0);
            expect(state.y).toBeLessThanOrEqual(3.5);
          }
          expect(arrived, `${route.id} failed to reach ${JSON.stringify(goal)} from ${JSON.stringify(state)}`).toBe(true);
          expect(Math.abs(state.y - goal.y)).toBeLessThan(.5);
        }
        expect(highest).toBeGreaterThanOrEqual(route.id === 'terraces' ? 3.25 : route.id === 'road' ? 1 : .75);
      });
    }
  }
  it('gives the MG a long road line and a visible northern tank bend', () => {
    expect(clear({ x: 0, y: 1.6, z: 169 }, { x: 0, y: 1.6, z: 34 })).toBe(true);
    expect(clear({ x: 8, y: 1.6, z: 174 }, { x: 8, y: 1.6, z: 126 })).toBe(true);
    connected({ x: 8, y: 0, z: 174 }, { x: 8, y: 0, z: 126 });
  });
  it('screens the squad start and authors a captive prisoner', () => {
    expect(clear({ x: 0, y: 1.6, z: -6 }, { x: 0, y: 1.6, z: 60 })).toBe(false);
    expect(encounterFor(world.id)!.groups.find((g) => g.id === 'prisoner')!.captive).toBe(true);
  });
});
