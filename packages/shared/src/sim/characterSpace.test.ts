import { describe, expect, it } from 'vitest';
import { DEFAULT_MOVE_CONFIG as config, createMoveState } from './CharacterController.ts';
import { characterSpace, keepCharacterSpace } from './characterSpace.ts';
import { boxFrom } from './world.ts';
import { Predictor } from '../net/prediction.ts';

describe('character space (U-099)', () => {
  it('stops an approaching character and keeps sliding along an occupied footprint', () => {
    const from = createMoveState(0, 0, -0.8);
    const next = createMoveState(0.1, 0, -0.6);
    const result = keepCharacterSpace(from, next, [characterSpace(createMoveState())], config, []);
    expect(result.z).toBe(from.z);
    expect(result.x).toBe(next.x);
  });
  it('separates exact coincidence deterministically without crossing a wall', () => {
    const state = createMoveState();
    const wall = boxFrom({ id: 'wall', x: -1, y: 0, z: 0, w: 1, h: 3, d: 4 }, 'cover');
    const run = () => keepCharacterSpace(state, state, [characterSpace(state)], config, [wall]);
    expect(run()).toEqual(run());
    expect(run().x).toBeGreaterThanOrEqual(0);
    expect(Math.max(Math.abs(run().x), Math.abs(run().z))).toBeGreaterThanOrEqual(config.radius * 2);
  });
  it('ignores another floor and includes lying bodies on this floor', () => {
    const state = createMoveState();
    expect(keepCharacterSpace(state, state, [characterSpace(createMoveState(0, 3, 0))], config, [])).toBe(state);
    const result = keepCharacterSpace(state, state, [characterSpace(state, config, true)], config, []);
    expect(Math.max(Math.abs(result.x), Math.abs(result.z))).toBeGreaterThanOrEqual(config.radius * 2);
  });
  it('prediction does not continually walk through a stationary character', () => {
    const other = characterSpace(createMoveState());
    const predictor = new Predictor(createMoveState(0, 0, -2), config, undefined, [], () => [other]);
    for (let tick = 1; tick <= 90; tick++) predictor.predict(tick, { moveX: 0, moveY: 1, yaw: 0, jump: false, sprint: false, crouch: false });
    expect(predictor.simulated.z).toBeLessThanOrEqual(-2 * config.radius);
  });
});
