/**
 * U-123: "there" on stacked floors. Feet and goals on one floor differ in
 * height by a stair step or the voxel a baked surface sits above its box top;
 * storeys differ by a body's height and a slab. A distance measured across the
 * ground alone calls a bot on the ground "at" a goal on the deck above it,
 * where it stops for good. Every arrival, reach and band a squad or escort
 * leaf checks goes through `within`, so a goal on another floor is never
 * reached from beneath or above it.
 */

/** The most two heights may differ and still be the same floor, metres: well under a storey, well over a step. */
export const SAME_FLOOR_M = 1;

interface At {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Distance across the ground, metres. */
export function across(a: { readonly x: number; readonly z: number }, b: { readonly x: number; readonly z: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
}

/** Within `radiusM` across the ground of `b`, and on its floor. */
export function within(a: At, b: At, radiusM: number): boolean {
  return Math.abs(a.y - b.y) <= SAME_FLOOR_M && across(a, b) <= radiusM;
}
