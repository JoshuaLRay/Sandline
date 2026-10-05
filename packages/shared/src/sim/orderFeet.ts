/**
 * U-123: the feet a picked order point means. An order's pick ray (the desktop
 * crosshair's, a mobile tap's) meets a face: the top of a floor, a wall, the
 * underside of a slab overhead, a soldier. Sent as it is, a wall's face is a
 * point in mid-air, and a ceiling's underside is nearer the storey above than
 * the floor the player was looking along — the host can only guess a floor
 * from it. So the client sends the floor the player pointed at: the support
 * under a point just in front of the face, toward the eye. A top face is its
 * own height; a wall's, the floor at its foot; a ceiling's, the floor beneath
 * it — never the roof over the pick, nor a storey below the top it hit.
 *
 * Shared and pure arithmetic over the world's boxes (`supportUnder`), so it is
 * the same answer on every client.
 */
import { type WorldBox, supportUnder } from './world.ts';

type Vec3 = { readonly x: number; readonly y: number; readonly z: number };

/** How far back along the ray, toward the eye, the pick is taken off the face it hit, metres. */
export const ORDER_PICK_BACKOFF_M = 0.05;

/** The feet an order picked where a ray along `direction` met the world at `hit` stands on. */
export function orderFeet(hit: Vec3, direction: Vec3, world: readonly WorldBox[], groundY: number): { x: number; y: number; z: number } {
  const length = Math.sqrt(direction.x * direction.x + direction.y * direction.y + direction.z * direction.z);
  const back = length > 1e-9 ? ORDER_PICK_BACKOFF_M / length : 0;
  const x = hit.x - direction.x * back;
  const y = hit.y - direction.y * back;
  const z = hit.z - direction.z * back;
  return { x, y: supportUnder(x, z, 0, y, world, groundY), z };
}
