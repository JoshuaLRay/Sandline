/**
 * World and body sounds in play (T-2.47): footsteps land on the gait's foot
 * contacts — checked against the real pose driver's phase — alternating
 * feet, two a cycle, none standing still or mid-vault; a near miss plays
 * its crack on the side it passed and a round that stopped short plays
 * none; an explosion's distant version is chosen by distance; an impact by
 * what it struck.
 */
import { describe, expect, it } from 'vitest';
import { WORLD_SOUNDS, boxFrom } from '@sandline/shared';
import { createHumanoidPlaceholder } from '../character/humanoidPlaceholder.ts';
import { createLocomotionPoseDriver } from '../character/locomotionPose.ts';
import type { LocomotionResult } from '../character/locomotionState.ts';
import { FOOT_CONTACTS, FootstepTracker, explosionSound, footstepSound, impactSound, nearMissAt, nearestOnSegment } from './worldSounds.ts';

const TWO_PI = Math.PI * 2;
const walk: LocomotionResult = { state: 'walk', direction: 'forward', speed: 4.2, normalizedSpeed: 1, gaitRate: 1, airborne: false, directionAngle: 0, vaultProgress: 0 };

describe('footsteps on the gait (T-2.47)', () => {
  it("land in the frame the pose driver's phase crosses a heel strike, alternating feet, two a cycle", () => {
    const driver = createLocomotionPoseDriver(createHumanoidPlaceholder('local'));
    const tracker = new FootstepTracker();
    const dt = 1 / 60;
    let prev = driver.phase;
    let cycles = 0;
    const steps: { foot: string; from: number; to: number }[] = [];
    for (let frame = 0; frame < 600; frame += 1) {
      driver.update(walk, dt);
      const now = driver.phase;
      if (now < prev) cycles += 1;
      for (const foot of tracker.update(now, walk.state)) steps.push({ foot, from: prev, to: now });
      prev = now;
    }
    expect(steps.length).toBeGreaterThan(4);
    for (const s of steps) {
      // The contact's angle lies inside the frame's step of phase: the sound is on the frame the heel lands.
      const contact = FOOT_CONTACTS.find((c) => c.foot === s.foot)!.phase;
      const moved = (s.to - s.from + TWO_PI) % TWO_PI;
      const ahead = (contact - s.from + TWO_PI) % TWO_PI;
      expect(ahead).toBeGreaterThan(0);
      expect(ahead).toBeLessThanOrEqual(moved + 1e-12);
    }
    for (let i = 1; i < steps.length; i += 1) expect(steps[i]!.foot).not.toBe(steps[i - 1]!.foot);
    // Two contacts every full cycle of the gait (give or take the cycle in progress).
    expect(Math.abs(steps.length - 2 * cycles)).toBeLessThanOrEqual(2);
  });

  it('plays none standing still or mid-vault, and picks the stance sound', () => {
    const tracker = new FootstepTracker();
    expect(tracker.update(0, 'idle')).toEqual([]);
    expect(tracker.update(1, 'walk')).toEqual([]);
    expect(tracker.update(Math.PI, 'vault')).toEqual([]);
    expect(tracker.update(Math.PI + 0.1, 'walk')).toEqual([]);
    expect(tracker.update(Math.PI * 1.6, 'walk')).toEqual(['left']);
    expect(footstepSound('sprint')).toBe(WORLD_SOUNDS.footsteps.sprint);
    expect(footstepSound('prone')).toBe(WORLD_SOUNDS.footsteps.prone);
    expect(footstepSound('idle')).toBeNull();
    expect(footstepSound('vault')).toBeNull();
  });
});

describe('rounds going past (T-2.47)', () => {
  const head = { x: 0, y: 1.6, z: 0 };
  it("plays the crack at the path's nearest point, on the side it passed", () => {
    // A round down the +Z axis 1 m to the listener's +X side, and one 1 m to the -X side.
    const right = nearMissAt({ x: 1, y: 1.6, z: -50 }, { x: 1, y: 1.6, z: 50 }, head)!;
    const left = nearMissAt({ x: -1, y: 1.6, z: -50 }, { x: -1, y: 1.6, z: 50 }, head)!;
    expect(right).toEqual({ x: 1, y: 1.6, z: 0 });
    expect(left).toEqual({ x: -1, y: 1.6, z: 0 });
    expect(Math.sign(right.x)).toBe(1);
    expect(Math.sign(left.x)).toBe(-1);
  });

  it('plays none for a round that passed wide, or stopped short of us', () => {
    expect(nearMissAt({ x: 10, y: 1.6, z: -50 }, { x: 10, y: 1.6, z: 50 }, head)).toBeNull();
    expect(nearMissAt({ x: 1, y: 1.6, z: -50 }, { x: 1, y: 1.6, z: -2 }, head)).toBeNull();
    expect(nearestOnSegment({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, head).distanceM).toBeCloseTo(1.6, 9);
  });
});

describe('explosions and impacts (T-2.47)', () => {
  it("chooses an explosion's distant version by distance", () => {
    expect(explosionSound(5)).toBe(WORLD_SOUNDS.explosion.near);
    expect(explosionSound(WORLD_SOUNDS.explosion.farM - 1)).toBe(WORLD_SOUNDS.explosion.near);
    expect(explosionSound(WORLD_SOUNDS.explosion.farM)).toBe(WORLD_SOUNDS.explosion.far);
    expect(explosionSound(400)).toBe(WORLD_SOUNDS.explosion.far);
  });

  it('plays an impact by what it struck', () => {
    const at = { x: 0, y: 0, z: 0, w: 1, h: 1, d: 1 };
    expect(impactSound(boxFrom({ id: 'post 10,10', ...at }, 'post-major'))).toBe(WORLD_SOUNDS.impacts.post);
    expect(impactSound(boxFrom({ id: 'rail left', ...at }, 'rail'))).toBe(WORLD_SOUNDS.impacts.post);
    expect(impactSound(boxFrom({ id: 'crate-a', ...at }, 'cover'))).toBe(WORLD_SOUNDS.impacts.crate);
    expect(impactSound(boxFrom({ id: 'west-wall-a', ...at }, 'cover'))).toBe(WORLD_SOUNDS.impacts.wall);
    expect(impactSound(null)).toBe(WORLD_SOUNDS.impacts.ground);
  });
});
