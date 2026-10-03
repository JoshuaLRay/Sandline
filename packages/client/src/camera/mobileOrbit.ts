import type { CameraCollider, CameraRay } from './cameraColliders.ts';
import { solveCollisionArmLength } from './cameraColliders.ts';

export const MOBILE_ORBIT_PITCH = -0.35;
export const MOBILE_ORBIT_MIN_PITCH = -1.15;
export const MOBILE_ORBIT_MAX_PITCH = 0.15;

/** Orbit about the soldier's chest, keeping that pivot framed at every zoom. */
export function mobileOrbit(
  target: CameraRay, yaw: number, pitch: number, distance: number,
  groundY: number, collider?: CameraCollider,
): { position: CameraRay; focus: CameraRay } {
  const elevation = Math.max(MOBILE_ORBIT_MIN_PITCH, Math.min(MOBILE_ORBIT_MAX_PITCH, pitch));
  const focus = { x: target.x, y: target.y + 1.2, z: target.z };
  const backward = {
    x: -Math.sin(yaw) * Math.cos(elevation),
    y: -Math.sin(elevation),
    z: -Math.cos(yaw) * Math.cos(elevation),
  };
  // Shorten the arm before it crosses the floor or static scenery.
  const floorLimit = backward.y < 0 ? Math.max(0, (focus.y - groundY - 0.25) / -backward.y) : distance;
  const arm = solveCollisionArmLength(Math.min(distance, floorLimit), focus, backward, collider);
  return {
    focus,
    position: { x: focus.x + backward.x * arm, y: focus.y + backward.y * arm, z: focus.z + backward.z * arm },
  };
}
