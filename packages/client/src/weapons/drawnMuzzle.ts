/**
 * Where the picture of a shot leaves the gun (U-003): the barrel's tip as it
 * is DRAWN this frame, in world space, for the flash and the tracer.
 *
 * In first person the gun is the viewmodel (`viewModel.ts`), drawn in its own
 * scene through its own fixed-FOV camera over the world. Its barrel has no
 * world position of its own, so this finds the world point the world camera
 * draws at the same spot on screen, at the same distance from the eye: where
 * the flash sits and the streak starts, the barrel is. The two cameras share
 * the eye and the aspect but not the field of view (ADS narrows the world's,
 * never the gun's), so the scale between them is the ratio of their tangents.
 *
 * Kept in front of scenery: a barrel pushed into a wall still draws (the
 * viewmodel is drawn over everything), but a flash placed behind the wall's
 * face would not, so the point is pulled back along the eye's ray to just
 * short of the wall — the same spot on screen, nearer.
 *
 * Presentation only, like everything drawn from here: the round is traced
 * from the stance eye, and its end is the eye's.
 */
import * as THREE from 'three';

/** Never nearer the eye than this: the world camera's near plane is 0.1 m. */
export const NEAREST_DRAWN_M = 0.15;
/** How far short of a wall's face a pulled-back point stops. */
export const WALL_MARGIN_M = 0.04;

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * The world point `camera` draws where a camera at the same eye with
 * `viewFovDeg` draws the view-space point `view`, at the same depth.
 * `camera`'s world matrix must be current.
 */
export function viewToWorld(view: Vec3Like, viewFovDeg: number, camera: THREE.PerspectiveCamera, out: THREE.Vector3): THREE.Vector3 {
  const scale = Math.tan((camera.fov * Math.PI) / 360) / camera.zoom / Math.tan((viewFovDeg * Math.PI) / 360);
  return out.set(view.x * scale, view.y * scale, view.z).applyMatrix4(camera.matrixWorld);
}

/**
 * Pull `point` back along the ray from `eye` to just short of a wall `wallM`
 * metres along it (null: nothing in the way), and never nearer than
 * `NEAREST_DRAWN_M`. In place.
 */
export function keepInFront(eye: THREE.Vector3, point: THREE.Vector3, wallM: number | null): THREE.Vector3 {
  const distance = eye.distanceTo(point);
  if (distance < 1e-6) return point;
  const allowed = Math.max(NEAREST_DRAWN_M, wallM === null ? distance : Math.min(distance, wallM - WALL_MARGIN_M));
  if (allowed === distance) return point;
  return point.sub(eye).multiplyScalar(allowed / distance).add(eye);
}
