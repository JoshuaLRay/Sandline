import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, TICK_SECONDS, blockedAt, createMoveState, stepCharacter, supportUnder,
} from '@sandline/shared';
import { buildRoadSupportWorld } from './qalatRoadSupports.ts';

const world = buildRoadSupportWorld();
const floors = world.boxes.filter((b) => b.id.startsWith('crossing-floor-') || /^ridge-(floor|slab)/.test(b.id));
const nearby = world.boxes.filter((b) => b.maxX >= 40 && b.minX <= 75 && b.maxZ >= 120 && b.minZ <= 150);

describe('U-169 C12-L upper terminal cheek is not a shortcut onto the lower flight', () => {
  for (const start of [{ x: 59.5, y: 19.2, z: 133.4 }, { x: 61.5, y: 20, z: 133.4 }, { x: 62, y: 20, z: 133.4 }])
    for (const turn of [768, 832])
      it(`rejects a north sprint-jump then ${turn === 768 ? 'west' : 'northwest'} from supported x${start.x}/y${start.y}`, () => {
        // The terminal cut leaves x59.5 on an actual y19.2 tread. Creating
        // a grounded y20 actor there would invent 0.8 m of launch height.
        expect(supportUnder(start.x, start.z, DEFAULT_MOVE_CONFIG.radius, start.y + .01, nearby, 0)).toBeCloseTo(start.y, 6);
        expect(supportUnder(start.x, start.z, DEFAULT_MOVE_CONFIG.radius, start.y + .01, floors, 0)).toBeCloseTo(start.y, 6);
        expect(blockedAt(start.x, start.z, DEFAULT_MOVE_CONFIG.radius, start.y, .05, DEFAULT_MOVE_CONFIG.height, nearby)).toBe(false);
        let state = { ...createMoveState(start.x, start.y, start.z), grounded: true };
        for (let tick = 0; tick < 180; tick++) {
          state = stepCharacter(state, {
            moveX: 0, moveY: tick < 135 ? 1 : 0, yaw: tick < 60 ? 0 : turn,
            sprint: tick < 60, jump: tick < 60, crouch: false, prone: false,
          }, TICK_SECONDS, DEFAULT_MOVE_CONFIG, nearby);
          expect(state.vault, `vaulted onto the terminal cheek at tick${tick}`).toBeNull();
          if (state.grounded) expect(supportUnder(state.x, state.z, DEFAULT_MOVE_CONFIG.radius, state.y + .01, floors, 0),
            `landed on a rock/cheek shortcut at tick${tick}: ${JSON.stringify(state)}`).toBeCloseTo(state.y, 6);
        }
        expect(state.grounded, 'never settled on a legal route floor').toBe(true);
      });
});

it('rejects the lower C12-L approach climbing A-C03 onto the road rock', () => {
  const start = { x: 26.489694022880965, y: 8, z: 134.92883591401093 };
  const boxes = world.boxes.filter((b) => b.maxX >= 10 && b.minX <= 40 && b.maxZ >= 120 && b.minZ <= 150);
  const allowed = boxes.filter((b) => b.id.startsWith('road-support-') || b.id.startsWith('crossing-floor-')
    || b.id.startsWith('road-combat-A-C03-'));
  expect(supportUnder(start.x, start.z, DEFAULT_MOVE_CONFIG.radius, start.y + .01, boxes, 0)).toBe(8);
  expect(blockedAt(start.x, start.z, DEFAULT_MOVE_CONFIG.radius, 8, 0, DEFAULT_MOVE_CONFIG.height, boxes)).toBe(false);
  let state = { ...createMoveState(start.x, start.y, start.z), grounded: true };
  for (let tick = 0; tick < 135; tick++) {
    state = stepCharacter(state, { moveX: 0, moveY: tick < 90 ? 1 : 0, yaw: 966,
      sprint: tick < 90, jump: tick < 90, crouch: false, prone: false }, TICK_SECONDS, DEFAULT_MOVE_CONFIG, boxes);
    if (state.grounded) expect(supportUnder(state.x, state.z, DEFAULT_MOVE_CONFIG.radius, state.y + .01, allowed, 0),
      `landed on road rock beyond A-C03 at tick${tick}: ${JSON.stringify(state)}`).toBeCloseTo(state.y, 6);
  }
  expect(state.grounded).toBe(true);
});
