/**
 * U-123: where an order picked on screen goes — the desktop crosshair's ray or
 * a mobile tap's — as the point the ray met (what a mark shows) and the feet a
 * move or hold there means (`orderFeet`): the floor the player pointed at, so
 * identical x/z on a basement, a deck and a bridge stay three different goals
 * all the way to the host.
 */
import * as THREE from 'three';
import { WIRE_ANGLE_UNITS, type WorldBox, orderFeet, supportUnder } from '@sandline/shared';

type Vec3 = { x: number; y: number; z: number };

/** What a pick stands on: the collision boxes and the ground under them. */
export interface PickWorld {
  boxes: readonly WorldBox[];
  groundY: number;
}

/** How far along a ray that met nothing its fallback is taken, metres: somewhere near, never the far plane. */
export const PICK_FALLBACK_M = 30;

/**
 * The feet a pick means: under the hit's face toward the eye, or — the ray met
 * nothing (an upward or horizon tap) — the floor under a point `PICK_FALLBACK_M`
 * along it, no higher than the eye, so a tap at the sky from a deck stays on
 * the deck rather than dropping to the ground below it.
 */
export function pickFeet(hit: Vec3 | null, origin: Vec3, direction: Vec3, world: PickWorld): Vec3 {
  if (hit) return orderFeet(hit, direction, world.boxes, world.groundY);
  const length = Math.sqrt(direction.x * direction.x + direction.y * direction.y + direction.z * direction.z) || 1;
  const along = PICK_FALLBACK_M / length;
  const x = origin.x + direction.x * along;
  const z = origin.z + direction.z * along;
  const below = Math.min(origin.y + direction.y * along, origin.y);
  return { x, y: supportUnder(x, z, 0, below, world.boxes, world.groundY), z };
}

/**
 * U-154: the facing a move or hold carries — the way the view looks, as a wire
 * yaw (1/1024 turn, forward `(sin, cos)` in x/z like a soldier's) — or null
 * for a view straight up or down, which has no bearing.
 */
export function viewFacing(direction: { x: number; z: number }): number | null {
  if (Math.hypot(direction.x, direction.z) < 1e-3) return null;
  const turns = Math.atan2(direction.x, direction.z) / (Math.PI * 2);
  return ((Math.round(turns * WIRE_ANGLE_UNITS) % WIRE_ANGLE_UNITS) + WIRE_ANGLE_UNITS) % WIRE_ANGLE_UNITS;
}

/** The pick ray from `camera` through a screen point (client pixels) of the canvas at `rect`, reaching `far` metres. */
export function screenRay(camera: THREE.Camera, rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number, far: number): THREE.Raycaster {
  const pointer = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
  const ray = new THREE.Raycaster();
  camera.updateMatrixWorld();
  ray.setFromCamera(pointer, camera);
  ray.far = far;
  return ray;
}

/** A pick: the point to mark, the feet to send a move or hold to, and the object hit first (null for none). */
export interface OrderPick {
  point: Vec3;
  feet: Vec3;
  object: THREE.Object3D | null;
}

/** Pick along `ray` (its far plane set by the caller) among `objects`, ignoring `exclude` (the viewer's own body). */
export function pickOrder(ray: THREE.Raycaster, objects: THREE.Object3D[], exclude: THREE.Object3D | undefined, world: PickWorld): OrderPick {
  const hit = ray.intersectObjects(objects, false).find((candidate) => candidate.object !== exclude);
  const { origin, direction } = ray.ray;
  const point = hit ? { x: hit.point.x, y: hit.point.y, z: hit.point.z } : null;
  const feet = pickFeet(point, origin, direction, world);
  return { point: point ?? { ...feet }, feet, object: hit?.object ?? null };
}
