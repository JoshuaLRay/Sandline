/**
 * Authoritative zero-spread aim ray for the local weapon.
 *
 * The ray starts at the gameplay eye and uses the camera's solved view
 * direction. It does NOT converge toward a target or toward an arbitrary
 * distance on the camera ray. That distinction is the TPS fix: camera and eye
 * are allowed to be separated, so the weapon ray can legitimately project away
 * from screen centre.
 *
 * The returned ray is the single centerline consumed by both firing and the TPS
 * reticle. Spread is applied later by the weapon system and never participates
 * in reticle placement.
 */

export interface AimVec3 {
  x: number;
  y: number;
  z: number;
}

export interface AimRay {
  origin: AimVec3;
  direction: AimVec3;
}

export function solveZeroSpreadAim(origin: AimVec3, viewDirection: AimVec3): AimRay {
  const length = Math.hypot(viewDirection.x, viewDirection.y, viewDirection.z);
  if (!(length > 0)) {
    return {
      origin: { ...origin },
      direction: { x: 0, y: 0, z: 1 },
    };
  }
  return {
    origin: { ...origin },
    direction: {
      x: viewDirection.x / length,
      y: viewDirection.y / length,
      z: viewDirection.z / length,
    },
  };
}

export function pointOnAimRay(ray: AimRay, distance: number): AimVec3 {
  return {
    x: ray.origin.x + ray.direction.x * distance,
    y: ray.origin.y + ray.direction.y * distance,
    z: ray.origin.z + ray.direction.z * distance,
  };
}
