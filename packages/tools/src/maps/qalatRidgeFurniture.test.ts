import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, TICK_SECONDS, blockedAt, createMoveState, stepCharacter, supportUnder,
} from '@sandline/shared';
import { buildRoadSupportWorld } from './qalatRoadSupports.ts';
import { buildRidgeFurniture } from './qalatRidge.ts';

const world = buildRoadSupportWorld(), furniture = buildRidgeFurniture();
const byId = (id: string) => world.boxes.find((b) => b.id === id)!;
const near = (p: { x: number; z: number }, r = 10) => world.boxes.filter((b) =>
  b.maxX > p.x - r && b.minX < p.x + r && b.maxZ > p.z - r && b.minZ < p.z + r);
const floor = world.boxes.filter((b) => /^ridge-(floor|slab|bridge-deck)/.test(b.id));
const yaw = (x: number, z: number) => Math.round(Math.atan2(x, z) / (2 * Math.PI) * 1024 + 1024) % 1024;

describe('U-165 exact inland ridge furnishings', () => {
  it('builds the four north-south cover sockets at independently transcribed standard dimensions', () => {
    const expected = [
      ['R3-low-rock', 84, 26, 170, .8, 1.1, 4], ['R5-high-rock', 94, 30, 238, 1.2, 2.2, 4],
      ['R6-low-wall', 76, 26, 286, .8, 1.1, 5], ['R7-high-rock', 82, 20, 320, 1.2, 2.2, 4],
    ] as const;
    for (const [id, x, y, z, w, h, d] of expected) {
      expect(furniture.find((b) => b.id === `ridge-cover-${id}`)).toEqual({ id: `ridge-cover-${id}`, x, y, z, w, h, d });
      for (const dx of [-w / 2, 0, w / 2]) for (const dz of [-d / 2, 0, d / 2])
        expect(supportUnder(x + dx, z + dz, .001, y + .01, floor, 0), `${id} unsupported corner ${dx}/${dz}`).toBeCloseTo(y, 9);
    }
  });

  it('keeps clear shell bounds, open west faces, four east-wall sacks and two high broken beams', () => {
    for (const [id, minX, maxX, minZ, maxZ, y] of [
      ['hut', 82, 90, 98, 106, 14], ['survey', 78, 86, 278, 288, 26],
    ] as const) {
      expect(byId(`ridge-${id}-east`)).toMatchObject({ minX: maxX, maxX: maxX + .6, minZ, maxZ, minY: y, maxY: y + 3 });
      expect(byId(`ridge-${id}-south`)).toMatchObject({ minX, minZ: minZ - .6, maxZ: minZ, minY: y, maxY: y + 3 });
      expect(byId(`ridge-${id}-north`)).toMatchObject({ minX, minZ: maxZ, maxZ: maxZ + .6, minY: y, maxY: y + 3 });
      // Test each clear interior, including its entrance. The sacks occupy
      // only the hut's eastern metre; beams are wholly above this body.
      for (let x = minX; x <= maxX - 1.1; x += .5) for (let z = minZ + .4; z <= maxZ - .4; z += .5) {
        const boxes = near({ x, z }, 1);
        expect(supportUnder(x, z, .35, y + .01, boxes, 0), `${id} floor ${x}/${z}`).toBeCloseTo(y, 9);
        expect(blockedAt(x, z, .35, y, 0, DEFAULT_MOVE_CONFIG.height, boxes), `${id} clear body ${x}/${z}`).toBe(false);
      }
      const overhead = furniture.filter((b) => b.id.startsWith(`ridge-${id}-`) && b.y >= y + DEFAULT_MOVE_CONFIG.height);
      expect(overhead).toHaveLength(id === 'hut' ? 0 : 2);
    }
    const sacks = world.boxes.filter((b) => b.id.startsWith('ridge-hut-sack-'));
    expect(sacks).toHaveLength(4);
    expect(sacks.map((b) => b.maxX)).toEqual([90, 90, 90, 90]);
    expect(sacks.map((b) => b.minY)).toEqual([14, 14, 14, 14]);
    const beams = world.boxes.filter((b) => b.id.startsWith('ridge-survey-beam-'));
    expect(beams).toHaveLength(2);
    for (const b of beams) expect(b.minY - 26).toBe(3);
    expect(beams[0]!.maxX).toBeLessThan(beams[1]!.minX);
    // Each broken beam bears on an authored wall cap rather than floating.
    expect(beams[0]!.minZ).toBeLessThan(byId('ridge-survey-south').maxZ);
    expect(beams[1]!.maxX).toBeGreaterThan(byId('ridge-survey-east').minX);
  });

  it('walks into both shells and around both high rocks from their existing ridge pads', () => {
    const trips = [
      [{ x: 78, y: 14, z: 96 }, { x: 80, y: 14, z: 100 }, { x: 87, y: 14, z: 100 }],
      [{ x: 72, y: 26, z: 286 }, { x: 73.5, y: 26, z: 282 }, { x: 82, y: 26, z: 282 }],
      [{ x: 86, y: 30, z: 248 }, { x: 95.8, y: 30, z: 243 }, { x: 95.8, y: 30, z: 238 }],
      [{ x: 70, y: 20, z: 321 }, { x: 79, y: 20, z: 321 }, { x: 79, y: 20, z: 322.5 },
        { x: 83.8, y: 20, z: 322.5 }, { x: 83.8, y: 20, z: 320 }],
    ];
    for (const points of trips) {
      let state = { ...createMoveState(points[0]!.x, points[0]!.y, points[0]!.z), grounded: true };
      const boxes = near(points[0]!, 24);
      for (const goal of points.slice(1)) {
        let arrived = false;
        for (let tick = 0; tick < 350; tick++) {
          const dx = goal.x - state.x, dz = goal.z - state.z;
          if (Math.hypot(dx, dz) < .15) { arrived = true; break; }
          state = stepCharacter(state, { moveX: 0, moveY: 1, yaw: yaw(dx, dz), sprint: false, jump: false, crouch: false, prone: false },
            TICK_SECONDS, DEFAULT_MOVE_CONFIG, boxes);
          expect(state.vault).toBeNull();
          expect(state.y).toBeCloseTo(goal.y, 6);
        }
        expect(arrived, `unreachable furniture goal ${JSON.stringify(goal)} from ${JSON.stringify(state)}`).toBe(true);
      }
    }
  });

  it('rejects chained vaults/jumps from accessible sacks and low cover onto shell, beam or ridge-rock tops', () => {
    // Starting on each reachable low top is stricter than merely walking
    // into its side. The 2.2 m high rocks are separately tested from the floor.
    const starts = [
      { x: 84, y: 27.1, z: 170 }, { x: 76, y: 27.1, z: 286 },
      ...[99, 101, 103, 105].map((z) => ({ x: 89.55, y: 14.7, z })),
      { x: 93, y: 30, z: 238 }, { x: 95, y: 30, z: 238 },
      { x: 81, y: 20, z: 320 }, { x: 83, y: 20, z: 320 },
    ];
    let attempts = 0;
    for (const start of starts) {
      const boxes = near(start, 30), allowed = boxes.filter((b) => /^ridge-(floor|slab|bridge-deck)/.test(b.id)
        || /^ridge-cover-(R3-low-rock|R6-low-wall)$/.test(b.id) || b.id.startsWith('ridge-hut-sack-'));
      for (let direction = 0; direction < 1024; direction += 128) for (const stance of ['walk', 'jump', 'crouch', 'prone']) {
        let state = { ...createMoveState(start.x, start.y, start.z), grounded: true };
        const assertSupported = () => {
          const support = supportUnder(state.x, state.z, DEFAULT_MOVE_CONFIG.radius, state.y + .01, allowed, 0);
          expect(state.y, `${stance} reached an unintended top from ${JSON.stringify(start)}: ${JSON.stringify(state)}`).toBeCloseTo(support, 6);
          expect(support, `${stance} dropped out of the ridge from ${JSON.stringify(start)} to ${JSON.stringify(state)}`).toBeGreaterThan(0);
        };
        for (let tick = 0; tick < 90; tick++) {
          state = stepCharacter(state, {
            moveX: 0, moveY: 1, yaw: direction, sprint: stance !== 'walk', jump: stance === 'jump', crouch: stance === 'crouch', prone: stance === 'prone',
          }, TICK_SECONDS, DEFAULT_MOVE_CONFIG, boxes);
          if (state.grounded) assertSupported();
        }
        for (let tick = 0; tick < 60; tick++) {
          state = stepCharacter(state, {
            moveX: 0, moveY: 0, yaw: direction, sprint: false, jump: false, crouch: false, prone: false,
          }, TICK_SECONDS, DEFAULT_MOVE_CONFIG, boxes);
          if (state.grounded) assertSupported();
        }
        assertSupported();
        attempts++;
      }
    }
    expect(attempts).toBe(320);
  }, 90_000);
});
