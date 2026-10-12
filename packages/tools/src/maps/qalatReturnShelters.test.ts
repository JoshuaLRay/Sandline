import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, TICK_SECONDS, blockedAt, createMoveState, rayWorld, stepCharacter, supportUnder, type WorldBox,
} from '@sandline/shared';
import { buildRoadSupportWorld } from './qalatRoadSupports.ts';
import { RETURN_SHELTERS, buildReturnShelters, returnShelterFloors } from './qalatReturnShelters.ts';

const world = buildRoadSupportWorld();
const store = world.boxes.filter((b) => b.id.startsWith('D0-weigh-station-store-'));
const nearStore = world.boxes.filter((b) => b.minX < 58 && b.maxX > 38 && b.minZ < 66 && b.maxZ > 50);
const rayBetween = (from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, boxes: readonly WorldBox[] = world.boxes) => {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }, length = Math.hypot(d.x, d.y, d.z);
  return rayWorld({ origin: from, direction: { x: d.x / length, y: d.y / length, z: d.z / length }, maxDistance: length }, boxes);
};

describe('U-152 exact D0 weigh-station return store', () => {
  it('keeps the approved clear interior, holding point and complete 4 m court connector', () => {
    expect(RETURN_SHELTERS.store).toMatchObject({
      minX: 46, maxX: 54, minZ: 54, maxZ: 62, floorY: 8, ceilingY: 12, wallM: .6,
      doorMinZ: 56, doorMaxZ: 60, doorTopY: 11,
      connector: { minX: 44, maxX: 46, minZ: 56, maxZ: 60 }, holding: { x: 50, y: 8, z: 58 },
    });
    expect(returnShelterFloors()).toEqual([
      [{ x: 45.4, z: 53.4 }, { x: 54.6, z: 53.4 }, { x: 54.6, z: 62.6 }, { x: 45.4, z: 62.6 }],
      [{ x: 44, z: 56 }, { x: 46, z: 56 }, { x: 46, z: 60 }, { x: 44, z: 60 }],
    ]);
    expect(store).toHaveLength(7);
    expect(buildReturnShelters().map((b) => b.id)).toEqual(store.map((b) => b.id));
    for (let x = 46.25; x < 54; x += .25) for (let z = 54.25; z < 62; z += .25) {
      expect(supportUnder(x, z, .01, 8.45, nearStore, 0), `unsupported store ${x},${z}`).toBe(8);
      expect(blockedAt(x, z, .01, 8, 0, DEFAULT_MOVE_CONFIG.height, nearStore), `rock inside store ${x},${z}`).toBe(false);
    }
    for (let x = 44; x <= 46; x += .25) for (let z = 56.25; z < 60; z += .25) {
      expect(supportUnder(x, z, .01, 8.45, nearStore, 0)).toBe(8);
      expect(blockedAt(x, z, .01, 8, 0, DEFAULT_MOVE_CONFIG.height, nearStore)).toBe(false);
    }
  });

  it('places all 0.6 m walls outside the floor and closes the doorway above its 3 m clearance', () => {
    const bounds = (id: string) => {
      const b = store.find((s) => s.id === `D0-weigh-station-store-${id}`)!;
      return [b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ].map((n) => Number(n.toFixed(8)));
    };
    expect(bounds('east')).toEqual([54, 54.6, 8, 12, 54, 62]);
    expect(bounds('north')).toEqual([45.4, 54.6, 8, 12, 62, 62.6]);
    expect(bounds('south')).toEqual([45.4, 54.6, 8, 12, 53.4, 54]);
    expect(bounds('west-south')).toEqual([45.4, 46, 8, 12, 54, 56]);
    expect(bounds('west-north')).toEqual([45.4, 46, 8, 12, 60, 62]);
    expect(bounds('door-lintel')).toEqual([45.4, 46, 11, 12, 56, 60]);
    expect(bounds('roof')).toEqual([45.4, 54.6, 12, 12.6, 53.4, 62.6]);
    expect(rayBetween({ x: 44, y: 10.99, z: 58 }, { x: 50, y: 10.99, z: 58 })).toBeNull();
    expect(rayBetween({ x: 44, y: 11.01, z: 58 }, { x: 50, y: 11.01, z: 58 })?.box.id).toBe('D0-weigh-station-store-door-lintel');
  });

  it('screens the holding torso with the north wall from X-stop and with its solid ceiling from above', () => {
    // Backing terrain may stop the shot before it reaches the shell. Prove
    // both that the complete build occludes it and that the authored wall
    // itself closes the line rather than relying only on the insertion rock.
    for (const y of [8.5, 9.1, 9.75]) {
      const origin = { x: 32, y: 11.2, z: 98 }, hold = { x: 50, y, z: 58 };
      expect(rayBetween(origin, hold)).not.toBeNull();
      expect(rayBetween(origin, hold, store)?.box.id).toBe('D0-weigh-station-store-north');
      expect(rayBetween({ x: 60, y: 11.2, z: 58 }, hold, store)?.box.id).toBe('D0-weigh-station-store-east');
    }
    expect(rayBetween({ x: 50, y: 15, z: 58 }, { x: 50, y: 9.1, z: 58 })?.box.id).toBe('D0-weigh-station-store-roof');
  });

  it('walks both doorway edges in both directions with the production standing controller', () => {
    for (const z of [56.35, 59.65]) for (const inward of [true, false]) {
      let state = createMoveState(inward ? 44 : 50, 8, z);
      for (let tick = 0; tick < 65; tick++) {
        state = stepCharacter(state, { moveX: 0, moveY: 1, yaw: inward ? 256 : 768,
          sprint: false, jump: false, crouch: false, prone: false }, TICK_SECONDS, DEFAULT_MOVE_CONFIG, nearStore);
        expect(state.y).toBeCloseTo(8); expect(state.vault).toBeNull();
      }
      expect(inward ? state.x > 48 : state.x < 46, `door edge ${z} ${inward ? 'entry' : 'exit'} ${JSON.stringify(state)}`).toBe(true);
    }
  });

  it('retains at least 4 m of clear passage through the D0 insertion and depot connections', () => {
    const court = { x: 32, z: 64 };
    for (const from of [{ x: 48, z: 46.75 }, { x: 12, z: 68 }]) {
      const dx = court.x - from.x, dz = court.z - from.z, length = Math.hypot(dx, dz);
      const steps = Math.ceil(length / .25);
      for (let i = 0; i <= steps; i++) for (const offset of [-2, -1, 0, 1, 2]) {
        const x = from.x + dx * i / steps - dz / length * offset;
        const z = from.z + dz * i / steps + dx / length * offset;
        expect(supportUnder(x, z, .01, 8.45, world.boxes, 0)).toBe(8);
        expect(blockedAt(x, z, .01, 8, 0, DEFAULT_MOVE_CONFIG.height, world.boxes)).toBe(false);
      }
    }
  });

  it('keeps ordinary standing jump attempts inside the closed north/east walls', () => {
    for (const yaw of [0, 256]) {
      let state = createMoveState(50, 8, 58);
      for (let tick = 0; tick < 120; tick++) {
        state = stepCharacter(state, { moveX: 0, moveY: 1, yaw,
          sprint: false, jump: tick % 30 === 0, crouch: false, prone: false }, TICK_SECONDS, DEFAULT_MOVE_CONFIG, nearStore);
        expect(state.y).toBeLessThan(11); expect(state.vault).toBeNull();
        expect(state.x).toBeLessThan(54); expect(state.z).toBeLessThan(62);
      }
    }
  });
});
