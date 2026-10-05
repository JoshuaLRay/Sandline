import { describe, expect, it } from 'vitest';
import { SAME_FLOOR_M, across, within } from './floor.ts';

describe('floor-aware proximity (U-123)', () => {
  it('distinguishes identical x/z on y0, y8 and y16', () => {
    const at = (y: number) => ({ x: 30, y, z: 270 });
    for (const y of [0, 8, 16]) expect(within(at(y), at(y), 0.4)).toBe(true);
    expect(within(at(0), at(8), 0.4)).toBe(false);
    expect(within(at(8), at(16), 100)).toBe(false);
    expect(across(at(0), at(16))).toBe(0);
  });

  it('accepts a baked surface or stair step above the feet and the horizontal radius exactly', () => {
    expect(within({ x: 0, y: 8, z: 0 }, { x: 0.4, y: 8.05, z: 0 }, 0.4)).toBe(true);
    expect(within({ x: 0, y: 4, z: 0 }, { x: 0, y: 4 + SAME_FLOOR_M, z: 0 }, 0.1)).toBe(true);
    expect(within({ x: 0, y: 4, z: 0 }, { x: 0, y: 4.01 + SAME_FLOOR_M, z: 0 }, 0.1)).toBe(false);
    expect(within({ x: 0, y: 0, z: 0 }, { x: 0.41, y: 0, z: 0 }, 0.4)).toBe(false);
  });
});
