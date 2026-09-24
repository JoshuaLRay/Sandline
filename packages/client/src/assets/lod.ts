/**
 * Runtime LOD selection (T-4.07).
 *
 * The asset pipeline records how many LOD levels an asset declares. A source
 * node named `name_LOD<n>` is level n; the unsuffixed nodes are level 0.
 * Runtime selection is by projected screen height, not an arbitrary world
 * distance, so changing FOV does not silently change the amount of detail.
 */
import * as THREE from 'three';

const LOD_SUFFIX = /_LOD(\d+)$/;

/** Level 0 is kept while the asset occupies at least this share of screen height. */
export const LOD0_MIN_SCREEN_FRACTION = 0.12;

/** The LOD level inherited by an object from itself or a named ancestor. */
export function lodLevelOf(object: THREE.Object3D, root: THREE.Object3D): number {
  let current: THREE.Object3D | null = object;
  while (current) {
    const match = LOD_SUFFIX.exec(current.name);
    if (match) return Number(match[1]);
    if (current === root) break;
    current = current.parent;
  }
  return 0;
}

/**
 * Projected diameter of a bounding sphere as a fraction of viewport height.
 * The perspective projection's half-height is distance*tan(fov/2), so this
 * ratio is independent of the actual pixel resolution.
 */
export function screenFractionForSphere(radius: number, distance: number, verticalFovDeg: number): number {
  if (!(radius > 0) || !(distance > 0) || !(verticalFovDeg > 0)) return 0;
  const halfHeight = distance * Math.tan(THREE.MathUtils.degToRad(verticalFovDeg) / 2);
  return Math.min(1, radius / halfHeight);
}

/**
 * Every farther level gets half the screen-size range of the previous one.
 * A one-level asset always stays at level 0.
 */
export function lodLevelForScreenFraction(screenFraction: number, levels: number): number {
  const count = Math.max(1, Math.floor(levels));
  let level = 0;
  let threshold = LOD0_MIN_SCREEN_FRACTION;
  while (level + 1 < count && screenFraction < threshold) {
    level += 1;
    threshold *= 0.5;
  }
  return level;
}

/** Pick an existing level when a malformed source skips a declared number. */
export function availableLodLevel(wanted: number, available: readonly number[]): number {
  if (available.length === 0) return 0;
  if (available.includes(wanted)) return wanted;
  for (let level = wanted - 1; level >= 0; level -= 1) {
    if (available.includes(level)) return level;
  }
  return available[0]!;
}
