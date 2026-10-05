import { describe, expect, it } from 'vitest';
import { SAME_FLOOR_M, across, near, within } from './floor.ts';

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

  it('keeps a vaultable platform near for choosing cover, but not a storey above or below the radius', () => {
    const goal = { x: 0, y: 8, z: 0 };
    expect(near({ x: 5, y: 9.25, z: 0 }, goal, 6)).toBe(true);
    expect(within({ x: 0.2, y: 9.25, z: 0 }, goal, 0.4)).toBe(false);
    expect(near({ x: 0, y: 0, z: 0 }, goal, 6)).toBe(false);
    expect(near({ x: 0, y: 16, z: 0 }, goal, 6)).toBe(false);
    expect(near({ x: 6.01, y: 8, z: 0 }, goal, 6)).toBe(false);
  });

  it('judges a body mid-vault by the floor it took off from', () => {
    const vaulting = { x: 0, y: 1.02, z: 0, vault: { fromY: 0 } };
    expect(within(vaulting, { x: 0.3, y: 0, z: 0 }, 0.4)).toBe(true);
    expect(within({ ...vaulting, vault: null }, { x: 0.3, y: 0, z: 0 }, 0.4)).toBe(false);
    expect(near(vaulting, { x: 0, y: 7.5, z: 0 }, 6)).toBe(false);
  });
});
