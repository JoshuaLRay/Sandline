import { describe, expect, it } from 'vitest';
import { pointOnAimRay, solveZeroSpreadAim } from './aimSolve.ts';

describe('zero-spread aim ray', () => {
  it('uses the gameplay eye as the ray origin and the solved view direction as the centerline', () => {
    const ray = solveZeroSpreadAim(
      { x: 0, y: 1.55, z: 0 },
      { x: 0.6, y: 0, z: 0.8 },
    );

    expect(ray.origin).toEqual({ x: 0, y: 1.55, z: 0 });
    expect(ray.direction).toEqual({ x: 0.6, y: 0, z: 0.8 });
  });

  it('does not depend on target range', () => {
    const ray = solveZeroSpreadAim(
      { x: 0, y: 1.55, z: 0 },
      { x: 0.2, y: 0.1, z: 0.97 },
    );

    const at10 = pointOnAimRay(ray, 10);
    const at25 = pointOnAimRay(ray, 25);
    const at50 = pointOnAimRay(ray, 50);
    const at100 = pointOnAimRay(ray, 100);

    for (const point of [at10, at25, at50, at100]) {
      const dx = point.x - ray.origin.x;
      const dy = point.y - ray.origin.y;
      const dz = point.z - ray.origin.z;
      const length = Math.hypot(dx, dy, dz);
      expect(dx / length).toBeCloseTo(ray.direction.x, 12);
      expect(dy / length).toBeCloseTo(ray.direction.y, 12);
      expect(dz / length).toBeCloseTo(ray.direction.z, 12);
    }
  });

  it('provides a safe forward centerline for a zero-length input', () => {
    expect(solveZeroSpreadAim({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0 }).direction).toEqual({
      x: 0,
      y: 0,
      z: 1,
    });
  });
});
