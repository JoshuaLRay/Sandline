/**
 * U-123: "there" on stacked floors. Feet and goals on one floor differ in
 * height by a stair step or the voxel a baked surface sits above its box top;
 * storeys differ by a body's height and a slab. A distance measured across the
 * ground alone calls a bot on the ground "at" a goal on the deck above it,
 * where it stops for good. Every arrival, reach and band a squad or escort
 * leaf checks goes through `within`, so a goal on another floor is never
 * reached from beneath or above it; radii that only choose cover use `near`.
 */

/** The most two heights may differ and still be the same floor, metres: well under a storey, well over a step. */
export const SAME_FLOOR_M = 1;

interface At {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** A body mid-vault (a `MoveState`'s): it stands on the floor it took off from, not in the air over the obstacle. */
  readonly vault?: { readonly fromY: number } | null;
}

/** The height a body or point stands at: mid-vault, its takeoff floor (as U-122's cover planning reads it). */
export function standingY(a: At): number {
  return a.vault ? a.vault.fromY : a.y;
}

/** Distance across the ground, metres. */
export function across(a: { readonly x: number; readonly z: number }, b: { readonly x: number; readonly z: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
}

/** Within `radiusM` across the ground of `b`, and on its floor: an arrival or a reach. */
export function within(a: At, b: At, radiusM: number): boolean {
  return Math.abs(standingY(a) - standingY(b)) <= SAME_FLOOR_M && across(a, b) <= radiusM;
}

/**
 * Within `radiusM` across the ground of `b` and no further above or below it:
 * a selection radius (which cover is near a point), not an arrival. A platform
 * a bot can vault onto stays near, as it always was; a storey further above or
 * below than the radius does not. Whether a point so chosen can actually be
 * reached is the cover search's own complete-path check.
 */
export function near(a: At, b: At, radiusM: number): boolean {
  return Math.abs(standingY(a) - standingY(b)) <= radiusM && across(a, b) <= radiusM;
}
