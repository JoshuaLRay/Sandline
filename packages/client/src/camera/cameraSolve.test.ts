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
import { DEFAULT_MUZZLE_RIG, muzzlePosition } from '@sandline/shared';
import { convergeAimDirection, type CameraView, createCameraSolve, solveCamera } from './cameraSolve.ts';

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
    shoulderSide: 1,
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
    const target = createCameraSolve();
    solveCamera(view(), cfg, target, 0);
    const hip = target.distance;
    expect(target.adsBlend).toBe(0);

    solveCamera(view({ ads: true }), cfg, target, 1 / 60);
    expect(target.adsBlend).toBeGreaterThan(0);
    expect(target.adsBlend).toBeLessThan(1);
    expect(target.distance).toBeLessThan(hip);
    expect(target.focus.x).toBeLessThan(-cfg.shoulderRightAds);

    for (let i = 0; i < 120; i += 1) solveCamera(view({ ads: true }), cfg, target, 1 / 60);
    expect(target.adsBlend).toBeCloseTo(1, 4);
    expect(target.distance).toBeCloseTo(cfg.distance * cfg.adsDistanceScale, 4);
    expect(target.focus.x).toBeCloseTo(-cfg.shoulderRightAds, 4);
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
        // Negating a zero component produces -0, which is the same ray
        // direction but is deliberately distinct under deep equality.
        expect(direction.x).toBeCloseTo(0, 6);
        expect(direction.y).toBeCloseTo(0, 6);
        expect(direction.z).toBeCloseTo(-1, 6);
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
  it('eases a shoulder swap and settles at the requested side', () => {
    const target = createCameraSolve();
    const right = solveCamera(view(), cfg, target, 1 / 60);
    expect(right.shoulderBlend).toBeCloseTo(1, 6);

    solveCamera(view({ shoulderSide: -1 }), cfg, target, 1 / 60);
    expect(target.shoulderBlend).toBeLessThan(1);
    expect(target.shoulderBlend).toBeGreaterThan(-1);

    for (let i = 0; i < 120; i += 1) {
      solveCamera(view({ shoulderSide: -1 }), cfg, target, 1 / 60);
    }
    expect(target.shoulderBlend).toBeCloseTo(-1, 4);
    expect(target.focus.x).toBeCloseTo(cfg.shoulderRight, 4);
  });

  it('uses the same continuous shoulder curve at different frame rates', () => {
    const at30 = createCameraSolve();
    const at60 = createCameraSolve();
    for (let i = 0; i < 30; i += 1) solveCamera(view({ shoulderSide: -1 }), cfg, at30, 1 / 30);
    for (let i = 0; i < 60; i += 1) solveCamera(view({ shoulderSide: -1 }), cfg, at60, 1 / 60);
    expect(at30.shoulderBlend).toBeCloseTo(at60.shoulderBlend, 6);
  });

  it('mirrors the visual muzzle with the camera shoulder', () => {
    const rightRig = { ...DEFAULT_MUZZLE_RIG, shoulderRight: DEFAULT_MUZZLE_RIG.shoulderRight };
    const leftRig = { ...DEFAULT_MUZZLE_RIG, shoulderRight: -DEFAULT_MUZZLE_RIG.shoulderRight };
    const right = muzzlePosition(0, 0, 0, 0, 1, 'third', rightRig);
    const left = muzzlePosition(0, 0, 0, 0, 1, 'third', leftRig);
    expect(left.x).toBeCloseTo(-right.x, 8);
    expect(left.y).toBeCloseTo(right.y, 8);
    expect(left.z).toBeCloseTo(right.z, 8);
  });

  it('keeps aim convergence on the reticle at 10 m and 95 m on either shoulder', () => {
    for (const shoulderSide of [1, -1] as const) {
      const s = createCameraSolve();
      solveCamera(view({ shoulderSide }), cfg, s, 0);
      for (const range of [10, 95]) {
        const target = {
          x: s.position.x + s.direction.x * range,
          y: s.position.y + s.direction.y * range,
          z: s.position.z + s.direction.z * range,
        };
        const eye = { x: 0, y: cfg.eyeHeight, z: 0 };
        const aim = convergeAimDirection(s.position, s.direction, eye, range);
        const expected = {
          x: target.x - eye.x,
          y: target.y - eye.y,
          z: target.z - eye.z,
        };
        const length = Math.sqrt(expected.x ** 2 + expected.y ** 2 + expected.z ** 2);
        expect(aim.x).toBeCloseTo(expected.x / length, 8);
        expect(aim.y).toBeCloseTo(expected.y / length, 8);
        expect(aim.z).toBeCloseTo(expected.z / length, 8);
      }
    }
  });

  it('drives distance, shoulder offset and FOV from one continuous ADS blend', () => {
    const target = createCameraSolve();
    solveCamera(view(), cfg, target, 1 / 60);
    expect(target.adsBlend).toBeCloseTo(0, 6);
    expect(target.fov).toBeCloseTo(cfg.baseFov, 6);
    expect(target.distance).toBeCloseTo(cfg.distance, 6);
    expect(target.focus.x).toBeCloseTo(-cfg.shoulderRight, 6);

    solveCamera(view({ ads: true }), cfg, target, 1 / 60);
    expect(target.adsBlend).toBeGreaterThan(0);
    expect(target.adsBlend).toBeLessThan(1);
    expect(target.fov).toBeCloseTo(cfg.baseFov + (cfg.adsFov - cfg.baseFov) * target.adsBlend, 6);
    expect(target.distance).toBeCloseTo(
      cfg.distance * (1 + (cfg.adsDistanceScale - 1) * target.adsBlend),
      6,
    );
    expect(target.focus.x).toBeCloseTo(
      -(cfg.shoulderRight + (cfg.shoulderRightAds - cfg.shoulderRight) * target.adsBlend),
      6,
    );

    for (let i = 0; i < 120; i += 1) solveCamera(view({ ads: true }), cfg, target, 1 / 60);
    expect(target.adsBlend).toBeCloseTo(1, 4);
    expect(target.fov).toBeCloseTo(cfg.adsFov, 4);
    expect(target.distance).toBeCloseTo(cfg.distance * cfg.adsDistanceScale, 4);
    expect(target.focus.x).toBeCloseTo(-cfg.shoulderRightAds, 4);
  });

  it('keeps the ADS transition frame-rate independent', () => {
    const at30 = createCameraSolve();
    const at60 = createCameraSolve();
    for (let i = 0; i < 30; i += 1) solveCamera(view({ ads: true }), cfg, at30, 1 / 30);
    for (let i = 0; i < 60; i += 1) solveCamera(view({ ads: true }), cfg, at60, 1 / 60);
    expect(at30.adsBlend).toBeCloseTo(at60.adsBlend, 6);
    expect(at30.distance).toBeCloseTo(at60.distance, 6);
    expect(at30.focus.x).toBeCloseTo(at60.focus.x, 6);
    expect(at30.fov).toBeCloseTo(at60.fov, 6);
  });

  it('keeps aim convergence consistent mid-ADS transition', () => {
    const target = createCameraSolve();
    solveCamera(view({ ads: true }), cfg, target, 1 / 60);
    const range = 95;
    const aimPoint = {
      x: target.position.x + target.direction.x * range,
      y: target.position.y + target.direction.y * range,
      z: target.position.z + target.direction.z * range,
    };
    const eye = { x: 0, y: cfg.eyeHeight, z: 0 };
    const aim = convergeAimDirection(target.position, target.direction, eye, range);
    const dx = aimPoint.x - eye.x;
    const dy = aimPoint.y - eye.y;
    const dz = aimPoint.z - eye.z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    expect(aim.x).toBeCloseTo(dx / length, 8);
    expect(aim.y).toBeCloseTo(dy / length, 8);
    expect(aim.z).toBeCloseTo(dz / length, 8);
  });

});
