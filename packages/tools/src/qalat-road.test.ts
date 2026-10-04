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
    connected(surface({ x: 40, z: 154 }), surface({ x: 8, z: 154 }));
    connected(surface({ x: 8, z: 154 }), surface({ x: 40, z: 154 }));
    expect(clear({ x: 26, y: 4.85, z: 164 }, { x: 20, y: 1.6, z: 182 })).toBe(true);
  });
  it('keeps the river lower than the road banks and adds shallow walkable river sills', () => {
    expect(surface({ x: -40, z: 60 }).y).toBe(0);
    expect(surface({ x: -20, z: 60 }).y).toBe(6);
    expect(surface({ x: 8, z: 110 }).y).toBe(0);
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
        expect(highest).toBeGreaterThanOrEqual(route.id === 'terraces' ? 3.25 : route.id === 'road' ? 0 : .75);
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

describe('U-106 declared crossings and lane isolation', () => {
  beforeAll(async () => { await initNav(); nav = loadWorldNavMesh(world.id); });
  afterAll(() => nav.destroy());
  const crossings = [44, 104, 154];
  const legal = (z: number) => z <= 16.5 || z >= 169.5 || crossings.some((c) => Math.abs(z - c) <= 2.1);
  it('keeps every authored path inside its own approach corridor', () => {
    for (const route of world.mission!.routes) {
      const stops = [world.mission!.start, ...route.via, world.mission!.objective].map(surface);
      for (let i = 1; i < stops.length; i++) {
        const path = nav.path(stops[i - 1]!, stops[i]!)!;
        for (const point of path.points) {
          if (point.z <= 16.5 || point.z >= 169.5) continue;
          expect(point.x, `${route.id} left its corridor at ${JSON.stringify(point)}`).toBeGreaterThan(route.id === 'riverbed' ? -46 : route.id === 'road' ? -10 : 25);
          expect(point.x).toBeLessThan(route.id === 'riverbed' ? -36 : route.id === 'road' ? 11 : 41);
        }
      }
    }
  });
  it('samples both directions along boundaries and permits only declared path transitions', () => {
    for (let z = 22; z <= 166; z += 6) {
      for (const [a, b, cut] of [[-40, 0, -10], [0, 33, 11]] as const) {
        for (const reverse of [false, true]) {
          const endpoints = [surface({ x: a, z }), surface({ x: b, z })];
          if (reverse) endpoints.reverse();
          const path = nav.path(endpoints[0]!, endpoints[1]!);
          expect(path).not.toBeNull();
          for (let i = 1; i < path!.points.length; i++) {
            const p = path!.points[i - 1]!, q = path!.points[i]!;
            if ((p.x < cut) === (q.x < cut)) continue;
            const t = (cut - p.x) / (q.x - p.x);
            const at = p.z + (q.z - p.z) * t;
            expect(cut === -10 ? at <= 16.5 || at >= 169.5 : legal(at), `undeclared transition at z=${at}`).toBe(true);
          }
        }
      }
    }
  });
  it('disconnects all three lanes when hubs and C12 passages are closed in the test mesh', () => {
    const isolated = loadWorldNavMesh(world.id);
    try {
      isolated.setBlocker('junctions', [
        { minX: -64, maxX: 64, minZ: -16, maxZ: 17 },
        { minX: -64, maxX: 64, minZ: 169, maxZ: 202 },
        ...crossings.map((z) => ({ minX: 9, maxX: 26, minZ: z - 2.1, maxZ: z + 2.1 })),
      ], true);
      for (const [a, b] of [[-40, 0], [0, 33], [-40, 33]]) {
        const target = surface({ x: b!, z: 68 });
        const path = isolated.path(surface({ x: a!, z: 68 }), target);
        expect(path === null || Math.abs(path.points.at(-1)!.x - target.x) > 2).toBe(true);
      }
    } finally { isolated.destroy(); }
  });
  for (const z of crossings) for (const reverse of [false, true]) {
    it(`walks C12 at z=${z} ${reverse ? 'to road' : 'to terrace'} without vaulting`, () => {
      const goals = [surface({ x: 8, z }), surface({ x: 28, z })];
      if (reverse) goals.reverse();
      let state = createMoveState(goals[0]!.x, goals[0]!.y, z);
      const follower = new PathFollower(nav, world.boxes);
      let arrived = false;
      for (let tick = 0; tick < 600; tick++) {
        const { input, status } = follower.step(state, { goal: goals[1]!, pace: 'walk' }, 0);
        if (status === 'arrived') { arrived = true; break; }
        state = stepCharacter(state, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, world.boxes);
        expect(state.vault).toBeNull();
        expect(Math.abs(state.z - z)).toBeLessThan(2);
      }
      expect(arrived).toBe(true);
    });
  }
  it('blocks standing, jumping, crouched and prone controller shortcut attempts in both directions', () => {
    const attempts = [
      { x: -61.5, z: 0, yaw: 768 }, { x: 61.5, z: 0, yaw: 256 },
      { x: -61.5, z: 196, yaw: 768 }, { x: 61.5, z: 196, yaw: 256 },
      { x: 0, z: -13.5, yaw: 512 }, { x: 0, z: 199.5, yaw: 0 },
      ...[24, 40, 68, 88, 120, 140, 166].flatMap((z) => {
        const face = world.boxes.find((b) => b.id.startsWith('flank-inner-') && z > b.minZ && z < b.maxZ)!;
        return [{ x: face.minX - .5, z, yaw: 256 }, { x: -9.5, z, yaw: 768 }];
      }),
      ...[30, 60, 86, 112, 140, 164].flatMap((z) => [{ x: 10.5, z, yaw: 256 }, { x: [60, 112, 164].includes(z) ? 11.8 : 25.5, z, yaw: 768 }]),
    ];
    for (const at of attempts) for (const posture of ['stand', 'jump', 'crouch', 'prone']) {
      // Surface picks the actual floor, including elevated firing-bay approaches.
      const start = surface(at);
      let state = createMoveState(start.x, start.y, start.z);
      for (let tick = 0; tick < 120; tick++) state = stepCharacter(state, { moveX: 0, moveY: 1, yaw: at.yaw, sprint: false, jump: posture === 'jump', crouch: posture === 'crouch', prone: posture === 'prone' }, TICK_SECONDS, DEFAULT_MOVE_CONFIG, world.boxes);
      expect(Math.hypot(state.x - start.x, state.z - start.z), `${posture} crossed at ${JSON.stringify(at)}`).toBeLessThan(1);
    }
  });
  it('provides three measured road support angles, blind spots and the screened west gate', () => {
    for (const [z, y] of [[60, 1], [112, 2], [164, 3.25]]) {
      const eye = { x: 11.8, y: y! + 1.6, z: z! };
      expect(clear(eye, { x: 0, y: 1.6, z: z! })).toBe(true);
      expect(clear(eye, { x: -40, y: 1.6, z: z! })).toBe(false);
    }
    expect(clear({ x: 11.8, y: 2.6, z: 60 }, { x: 0, y: 1.6, z: 120 })).toBe(false);
    expect(clear({ x: -24, y: 1.6, z: 182 }, { x: -8, y: 1.6, z: 182 })).toBe(true);
    expect(clear({ x: -40, y: 1.6, z: 140 }, { x: 0, y: 1.6, z: 169 })).toBe(false);
  });
});
