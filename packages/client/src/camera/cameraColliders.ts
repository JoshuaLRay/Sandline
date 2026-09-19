/**
 * Camera-only arm collision (T-2.03).
 *
 * This deliberately describes a ray query rather than importing Three.js.
 * `cameraSolve` stays runnable headlessly while `main.ts` adapts its static
 * scenery meshes to this small interface.
 */
export interface CameraRay {
  x: number;
  y: number;
  z: number;
}

/** A scene query returns the distance to its first hit, or null when clear. */
export interface CameraCollider {
  cast(origin: CameraRay, direction: CameraRay, maxDistance: number): number | null;
}

/** Keep the near plane visibly clear of the surface that stopped the arm. */
export const CAMERA_COLLISION_MARGIN = 0.2;

/**
 * Limit an arm to the first static-scene hit, less a small clearance margin.
 * The caller supplies the backwards camera ray: from the focus towards the
 * desired camera position. Invalid query results are ignored rather than
 * turning a transient renderer problem into a camera snap.
 */
export function solveCollisionArmLength(
  desired: number,
  focus: CameraRay,
  backward: CameraRay,
  collider: CameraCollider | undefined,
  margin = CAMERA_COLLISION_MARGIN,
): number {
  if (!collider || !(desired > 0)) return desired;

  const hit = collider.cast(focus, backward, desired);
  if (hit === null || !Number.isFinite(hit) || hit >= desired) return desired;
  if (hit <= 0) return 0;
  return Math.max(0, hit - Math.max(0, margin));
}
