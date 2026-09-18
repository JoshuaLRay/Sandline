/**
 * The firing range: static shootable targets.
 *
 * SHARED because the server has to resolve hits against them and the client has
 * to draw them, and those two must describe the same objects. When only the
 * client knew about these, shooting one was a guaranteed miss — the server
 * traced against the six player slots and nothing else, so the red targets took
 * no hits while the grey squad capsules did. That is the whole bug.
 *
 * These stand in for enemies. This is a co-op PvE game (ADR-001): the things
 * worth shooting are AI, and AI is M2. Until then a static dummy is an honest
 * placeholder — it exercises the identical hitscan, lag compensation and damage
 * falloff path a real enemy will, without pretending to have behaviour.
 *
 * Positions are FEET, not centres: the hitbox is a capsule standing on this
 * point, and so is the mesh.
 *
 * netIds start well clear of the player slots, which are handed out from 1.
 */
export interface RangeTarget {
  netId: number;
  x: number;
  y: number;
  z: number;
  /** Distance from spawn, for labelling. Derived, but worth stating once. */
  label: string;
}

const FIRST_TARGET_NET_ID = 1000;

/**
 * Straddles the carbine's 22/55 m falloff band and the breacher's 6/18 m one,
 * so the damage curve is something a tester walks rather than reads out of
 * JSON. Offset in x so they do not share a cell with a distance post.
 */
export const RANGE_TARGETS: readonly RangeTarget[] = [10, 20, 35, 55, 80, 95].map(
  (distance, i) => ({
    netId: FIRST_TARGET_NET_ID + i,
    x: 2.5,
    y: 0,
    z: distance,
    label: `${distance}m`,
  }),
);

/** True for a netId belonging to the range rather than to a player slot. */
export function isRangeTarget(netId: number): boolean {
  return netId >= FIRST_TARGET_NET_ID;
}
