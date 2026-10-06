import * as THREE from 'three';
import type { CameraCollider } from './cameraColliders.ts';

/** The live static-scene query used by desktop and mobile camera arms. */
export function createSceneCollider(scenery: THREE.Object3D[]): CameraCollider {
  // Reuse the ray and vectors across frames, as the original inline query did.
  const ray = new THREE.Raycaster();
  const originVector = new THREE.Vector3();
  const directionVector = new THREE.Vector3();
  return {
    cast(origin, direction, maxDistance) {
      ray.set(originVector.set(origin.x, origin.y, origin.z), directionVector.set(direction.x, direction.y, direction.z));
      ray.near = 0;
      ray.far = maxDistance;
      return ray.intersectObjects(scenery, false)[0]?.distance ?? null;
    },
  };
}
