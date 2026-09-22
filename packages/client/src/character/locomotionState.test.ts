import { describe, expect, it } from 'vitest';
import {
  classifyLocomotion,
  LOCOMOTION_SPEED_EPSILON,
  type LocomotionSpeeds,
} from './locomotionState.ts';

const speeds: LocomotionSpeeds = {
  walkSpeed: 4.2,
  sprintSpeed: 6.8,
  crouchSpeed: 1.9,
  proneSpeed: 1.1,
};

function sample(
  velocityX: number,
  velocityZ: number,
  over: Partial<Parameters<typeof classifyLocomotion>[0]> = {},
) {
  return classifyLocomotion(
    {
      velocityX,
      velocityZ,
      grounded: true,
      crouched: false,
      downed: false,
      facingYaw: 0,
      ...over,
    },
    speeds,
  );
}

describe('locomotion state classifier (T-2.17)', () => {
  it('classifies zero speed as idle', () => {
    const result = sample(0, 0);
    expect(result.state).toBe('idle');
    expect(result.direction).toBe('forward');
    expect(result.normalizedSpeed).toBe(0);
    expect(result.gaitRate).toBe(0);
  });

  it('covers all eight directions', () => {
    const expected = [
      ['forward', 0, 1],
      ['forward-right', -1, 1],
      ['right', -1, 0],
      ['back-right', -1, -1],
      ['back', 0, -1],
      ['back-left', 1, -1],
      ['left', 1, 0],
      ['forward-left', 1, 1],
    ] as const;

    for (const [direction, x, z] of expected) {
      expect(sample(x, z).direction).toBe(direction);
    }
  });

  it('handles yaw when deriving local movement direction', () => {
    // At 90 degrees, world +X is local forward.
    expect(sample(1, 0, { facingYaw: 256 }).direction).toBe('forward');
    // At the same yaw, world +Z is local right.\n    expect(sample(0, 1, { facingYaw: 256 }).direction).toBe('right');
  });

  it('distinguishes walk and sprint from the resulting speed', () => {
    expect(sample(speeds.walkSpeed, 0).state).toBe('walk');
    expect(sample((speeds.walkSpeed + speeds.sprintSpeed) / 2, 0).state).toBe('sprint');
    expect(sample(speeds.sprintSpeed, 0).state).toBe('sprint');
  });

  it('uses an explicit crouch state rather than re-selecting movement speed', () => {
    expect(sample(speeds.crouchSpeed, 0, { crouched: true }).state).toBe('crouch-walk');
  });

  it('treats downed as idle even if a stale velocity sample is nonzero (B-05: no crawling)', () => {
    expect(sample(speeds.walkSpeed, 0, { downed: true }).state).toBe('idle');
  });

  it('uses an explicit prone state, distinct from crouch, at the prone speed', () => {
    const proneSpeed = speeds.proneSpeed as number;
    const result = sample(proneSpeed, 0, { prone: true });
    expect(result.state).toBe('prone');
    expect(result.state).not.toBe('crouch-walk');
    expect(result.normalizedSpeed).toBeCloseTo(1);
    // A crouch flag alongside prone does not win: the stance ladder only
    // has one level active at a time, and prone reads as the lower one.
    expect(sample(proneSpeed, 0, { prone: true, crouched: true }).state).toBe('prone');
  });

  it('goes idle rather than crawling when prone and stationary, at the prone speed', () => {
    expect(sample(0, 0, { prone: true }).state).toBe('idle');
  });

  it('marks airborne samples without inventing a separate movement state', () => {
    const result = sample(3, 0, { grounded: false });
    expect(result.state).toBe('walk');
    expect(result.airborne).toBe(true);
  });

  it('keeps zero-speed airborne, crouched, and downed samples deterministic', () => {
    expect(sample(0, 0, { grounded: false }).airborne).toBe(true);
    expect(sample(0, 0, { crouched: true }).state).toBe('idle');
    expect(sample(0, 0, { downed: true }).state).toBe('idle');
  });

  it('normalizes speed and gait rate against the selected mode', () => {
    const walk = sample(speeds.walkSpeed / 2, 0);
    expect(walk.normalizedSpeed).toBeCloseTo(0.5);
    expect(walk.gaitRate).toBeCloseTo(0.5);

    const sprint = sample(speeds.sprintSpeed, 0, { grounded: true });
    expect(sprint.normalizedSpeed).toBe(1);
    expect(sprint.gaitRate).toBe(1);
  });

  it('has a deterministic dead zone', () => {
    expect(sample(LOCOMOTION_SPEED_EPSILON * 0.5, 0).state).toBe('idle');
    expect(sample(LOCOMOTION_SPEED_EPSILON * 1.1, 0).state).toBe('walk');
  });

  it('contains no renderer or wall-clock dependency', () => {
    // This is intentionally a behavioural assertion: the module can be
    // imported and called without constructing a browser renderer or reading time.
    const a = sample(2, 3);
    const b = sample(2, 3);
    expect(b).toEqual(a);
  });

  it('reads a vault in progress as the vault state, whatever the body is doing (T-2.23)', () => {
    const mid = sample(0, 2.7, { grounded: false, vaultProgress: 0.4 });
    expect(mid.state).toBe('vault');
    expect(mid.vaultProgress).toBe(0.4);
    expect(mid.gaitRate).toBe(0);
    expect(mid.airborne).toBe(true);
    // Direction still comes from the rendered velocity.
    expect(mid.direction).toBe('forward');
    // Clamped, and null or absent means no vault.
    expect(sample(0, 2.7, { vaultProgress: 1.7 }).vaultProgress).toBe(1);
    expect(sample(0, 2.7, { vaultProgress: null }).state).toBe('walk');
    expect(sample(0, 2.7).vaultProgress).toBe(0);
    // Crouched or downed flags do not override an authoritative vault.
    expect(sample(0, 1, { crouched: true, vaultProgress: 0.1 }).state).toBe('vault');
    expect(sample(0, 1, { prone: true, vaultProgress: 0.1 }).state).toBe('vault');
  });
});
