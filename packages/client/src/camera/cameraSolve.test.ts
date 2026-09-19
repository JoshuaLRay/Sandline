/**
 * Camera solve (T-2.01).
 *
 * These pin the behaviours four QA rounds had to find by playing: that the
 * camera actually pitches rather than hovering, that it stops at the floor
 * instead of going under it looking up, that it sits over the RIGHT shoulder,
 * and that aiming pulls it in rather than teleporting it. All of that was
 * previously inline in the render loop, where the only available test was a
 * person noticing.
 *
 * Tolerances are loose where a value comes through the trig TABLE and tight
 * where the arithmetic is exact. Bounded, not bit-exact (§2.3).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CAMERA_CONFIG } from './cameraConfig.ts';
import { CAMERA_COLLISION_MARGIN, type CameraCollider } from './cameraColliders.ts';
import { type CameraView, createCameraSolve, solveCamera } from './cameraSolve.ts';

const cfg = DEFAULT_CAMERA_CONFIG;
/** Wire-angle units per degree: the wire carries 1024 per turn. */
const PER_DEG = 1024 / 360;

function view(over: Partial<CameraView> = {}): CameraView {
  return {
    x: 0,
    y: 0,
    z: 0,
    yawWire: 0,
    pitchWire: 0,
    pitchFraction: 0,
    ads: false,
    firstPerson: false,
    ...over,
  };
}

const solve = (over: Partial<CameraView> = {}, collider?: CameraCollider) =>
  solveCamera(view(over), cfg, createCameraSolve(), 1 / 60, collider);

describe('camera solve (T-2.01)', () => {
  it('writes into the target it is given', () => {
    const target = createCameraSolve();
    expect(solveCamera(view(), cfg, target)).toBe(target);
  });

  it('puts the first-person camera exactly on the pivot, with no arm', () => {
    const s = solve({ x: 3, y: 1, z: -2, firstPerson: true });
    expect(s.position).toEqual({ x: 3, y: 1 + cfg.eyeHeight, z: -2 });
    expect(s.focus).toEqual(s.position);
    expect(s.distance).toBe(0);
  });

  it('hangs the third-person camera an arm behind the shoulder pivot', () => {
    const s = solve();
    // Facing +Z, level. Right is cross(forward, up) = (-1, 0, 0), so the
    // shoulder pivot moves to -X and the arm runs straight back along -Z.
    expect(s.direction).toEqual({ x: 0, y: 0, z: 1 });
    expect(s.focus.x).toBeCloseTo(-cfg.shoulderRight, 6);
    expect(s.focus.y).toBeCloseTo(cfg.eyeHeight + cfg.shoulderUp, 6);
    expect(s.distance).toBeCloseTo(cfg.distance, 6);
    expect(s.position.z).toBeCloseTo(-cfg.distance, 6);
    expect(s.position.y).toBeCloseTo(s.focus.y, 6);
  });

  it('keeps the shoulder on the right as the character turns', () => {
    // Facing +X: right becomes +Z, so the pivot must swing there and not stay
    // on -X. Getting this backwards mirrors the aim offset as well as the view.
    const s = solve({ yawWire: 90 * PER_DEG });
    expect(s.forward.x).toBeCloseTo(1, 3);
    expect(s.forward.z).toBeCloseTo(0, 3);
    expect(s.focus.z).toBeCloseTo(cfg.shoulderRight, 3);
    expect(s.focus.x).toBeCloseTo(0, 3);
  });

  it('draws the camera in and tightens the shoulder when aiming', () => {
    const hip = solve();
    const ads = solve({ ads: true });
    expect(ads.distance).toBeCloseTo(cfg.distance * cfg.adsDistanceScale, 6);
    expect(ads.distance).toBeLessThan(hip.distance);
    expect(ads.focus.x).toBeCloseTo(-cfg.shoulderRightAds, 6);
    expect(Math.abs(ads.focus.x)).toBeLessThan(Math.abs(hip.focus.x));
  });

  it('shortens the arm at full pitch', () => {
    // pitchFraction is a separate input from the pitch angle, so this isolates
    // the shortening term rather than testing it through a real look-up.
    const level = solve({ pitchFraction: 0 });
    const full = solve({ pitchFraction: 1 });
    expect(full.distance).toBeCloseTo(cfg.distance * (1 - cfg.pitchShorten), 6);
    expect(full.distance).toBeLessThan(level.distance);
    // Symmetric: looking down shortens by the same amount as looking up.
    expect(solve({ pitchFraction: -1 }).distance).toBeCloseTo(full.distance, 6);
  });

  it('lands the camera ON the floor when looking up, never under it', () => {
    const s = solve({ pitchWire: 45 * PER_DEG, pitchFraction: 45 / 89 });
    expect(s.direction.y).toBeGreaterThan(0);
    expect(s.position.y).toBeCloseTo(cfg.minCameraY, 3);
    expect(s.position.y).toBeGreaterThanOrEqual(cfg.minCameraY - 1e-6);
    // The arm shortened to achieve that, rather than the position being clamped.
    expect(s.distance).toBeLessThan(cfg.distance);
  });

  it('never collapses the arm past minDistance, even at the pitch limit', () => {
    const s = solve({ pitchWire: 89 * PER_DEG, pitchFraction: 1 });
    expect(s.distance).toBeGreaterThanOrEqual(cfg.minDistance);
  });

  it('shortens the arm to the first scenery hit less a near-plane margin', () => {
    const collider: CameraCollider = {
      cast(origin, direction, maxDistance) {
        // Facing +Z, level: the camera ray starts at the shoulder and runs -Z.
        expect(origin.z).toBeCloseTo(0, 6);
        expect(direction).toEqual({ x: 0, y: 0, z: -1 });
        expect(maxDistance).toBeCloseTo(cfg.distance, 6);
        return 3;
      },
    };
    const s = solve({}, collider);
    expect(s.distance).toBeCloseTo(3 - CAMERA_COLLISION_MARGIN, 6);
    expect(s.position.z).toBeCloseTo(-(3 - CAMERA_COLLISION_MARGIN), 6);
  });

  it('recovers at the spring-arm rate after scenery clears', () => {
    const blocked: CameraCollider = { cast: () => 2 };
    const target = createCameraSolve();
    solveCamera(view(), cfg, target, 1 / 60, blocked);
    const blockedLength = target.distance;
    solveCamera(view(), cfg, target, 1 / 60);
    expect(target.distance).toBeGreaterThan(blockedLength);
    expect(target.distance).toBeLessThan(cfg.distance);
  });

  it('wraps a signed downward pitch instead of indexing the table negatively', () => {
    // Pitch accumulates signed so its limits can be asymmetric; the trig table
    // is indexed unsigned. This is the conversion that has to survive it.
    const down = solve({ pitchWire: -45 * PER_DEG, pitchFraction: -45 / 80 });
    expect(down.direction.y).toBeCloseTo(-Math.SQRT1_2, 2);
    // Looking down swings the arm UP, so there is no floor to solve against
    // and the camera sits above the pivot.
    expect(down.position.y).toBeGreaterThan(down.focus.y);
    const up = solve({ pitchWire: 45 * PER_DEG, pitchFraction: 45 / 89 });
    expect(down.direction.y).toBeCloseTo(-up.direction.y, 6);
  });

  it('carries the character position into the solve', () => {
    const s = solve({ x: 10, y: 2, z: -7 });
    expect(s.focus.y).toBeCloseTo(2 + cfg.eyeHeight + cfg.shoulderUp, 6);
    expect(s.focus.x).toBeCloseTo(10 - cfg.shoulderRight, 6);
    expect(s.focus.z).toBeCloseTo(-7, 6);
  });
});
