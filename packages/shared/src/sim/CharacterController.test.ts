import { describe, expect, it } from 'vitest';
import { DEFAULT_MOVE_CONFIG, type MoveInput, createMoveState, stepCharacter } from './CharacterController.ts';
import { TICK_SECONDS } from './Clock.ts';
import { ANGLE_QUARTER, WIRE_ANGLE_UNITS } from '../math/angles.ts';
import { cos, sin } from '../math/trig.ts';
import { wireToTable } from '../math/angles.ts';

const input = (over: Partial<MoveInput> = {}): MoveInput => ({
  moveX: 0,
  moveY: 0,
  yaw: 0,
  jump: false,
  sprint: false,
  crouch: false,
  ...over,
});

/** Displacement produced by one tick of the given input. */
function move(inp: MoveInput) {
  const a = createMoveState(0, 0, 0);
  const b = stepCharacter(a, inp, TICK_SECONDS, DEFAULT_MOVE_CONFIG);
  return { x: b.x - a.x, z: b.z - a.z };
}

describe('movement directions (T-1.12)', () => {
  it('moves forward along +Z at yaw 0', () => {
    const d = move(input({ moveY: 1 }));
    expect(d.z).toBeGreaterThan(0);
    expect(Math.abs(d.x)).toBeLessThan(1e-9);
  });

  it('moves backward along -Z at yaw 0', () => {
    expect(move(input({ moveY: -1 })).z).toBeLessThan(0);
  });

  /**
   * The regression that shipped: strafe must be cross(forward, up).
   *
   * In a right-handed Y-up system a viewer looking along +Z has +X on their
   * LEFT, so using cross(up, forward) makes D move the player leftward on
   * screen. Asserting against the cross product rather than a hardcoded axis
   * keeps this correct if the forward convention ever changes.
   */
  it('strafes right along cross(forward, up), not the reverse', () => {
    for (const yaw of [0, 128, 256, 512, 768, 1000]) {
      const a = wireToTable(yaw);
      const fx = sin(a);
      const fz = cos(a);
      // cross((fx,0,fz), (0,1,0)) = (-fz, 0, fx)
      const rightX = -fz;
      const rightZ = fx;

      const d = move(input({ moveX: 1, yaw }));
      const len = Math.sqrt(d.x * d.x + d.z * d.z);
      expect(len).toBeGreaterThan(0);
      // Normalised displacement must point along the right vector.
      expect(d.x / len).toBeCloseTo(rightX, 6);
      expect(d.z / len).toBeCloseTo(rightZ, 6);
    }
  });

  it('strafes left opposite to right', () => {
    const r = move(input({ moveX: 1 }));
    const l = move(input({ moveX: -1 }));
    expect(l.x).toBeCloseTo(-r.x, 9);
    expect(l.z).toBeCloseTo(-r.z, 9);
  });

  it('keeps forward and right perpendicular', () => {
    for (const yaw of [0, 200, 450, 900]) {
      const f = move(input({ moveY: 1, yaw }));
      const r = move(input({ moveX: 1, yaw }));
      expect(f.x * r.x + f.z * r.z).toBeCloseTo(0, 9);
    }
  });

  it('turns the movement frame with yaw', () => {
    const atZero = move(input({ moveY: 1, yaw: 0 }));
    const atQuarter = move(input({ moveY: 1, yaw: WIRE_ANGLE_UNITS / 4 }));
    expect(atZero.z).toBeGreaterThan(0);
    expect(atQuarter.x).toBeGreaterThan(0);
    expect(Math.abs(atQuarter.z)).toBeLessThan(1e-9);
    void ANGLE_QUARTER;
  });

  it('does not let diagonal movement outrun straight movement', () => {
    const straight = move(input({ moveY: 1 }));
    const diagonal = move(input({ moveX: 1, moveY: 1 }));
    const speedOf = (d: { x: number; z: number }) => Math.sqrt(d.x * d.x + d.z * d.z);
    expect(speedOf(diagonal)).toBeCloseTo(speedOf(straight), 9);
  });

  it('applies sprint and crouch speeds', () => {
    const speedOf = (i: MoveInput) => {
      const d = move(i);
      return Math.sqrt(d.x * d.x + d.z * d.z) / TICK_SECONDS;
    };
    expect(speedOf(input({ moveY: 1 }))).toBeCloseTo(DEFAULT_MOVE_CONFIG.walkSpeed, 6);
    expect(speedOf(input({ moveY: 1, sprint: true }))).toBeCloseTo(DEFAULT_MOVE_CONFIG.sprintSpeed, 6);
    expect(speedOf(input({ moveY: 1, crouch: true }))).toBeCloseTo(DEFAULT_MOVE_CONFIG.crouchSpeed, 6);
  });

  it('ignores absurd input magnitudes from a hostile client', () => {
    const sane = move(input({ moveY: 1 }));
    const absurd = move(input({ moveY: 1e9 }));
    expect(absurd.z).toBeCloseTo(sane.z, 9);
  });
});
