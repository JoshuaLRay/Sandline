/**
 * A named world's committed navmesh (T-3.03).
 *
 * Its own module, not part of `NavMesh.ts`, because importing it pulls every
 * world's bake (a few hundred kB of base64) into whatever imports it — the
 * in-page session only needs `initNav` until something actually paths.
 */
import { NavMesh } from './NavMesh.ts';
import { BAKED_NAV } from './baked/index.ts';
import { type BakedNav, type CoverPoint, bakedBytes } from './baked/types.ts';

/** The committed bake for a world id, or undefined when that world has none. */
export function bakedNavFor(worldId: string): BakedNav | undefined {
  return BAKED_NAV[worldId];
}

/** A world's committed cover points (T-3.18); empty when the world was never baked. */
export function bakedCoverFor(worldId: string): readonly CoverPoint[] {
  return BAKED_NAV[worldId]?.cover ?? [];
}

/** Load a world's committed navmesh. Throws when the world was never baked. */
export function loadWorldNavMesh(worldId: string): NavMesh {
  const baked = bakedNavFor(worldId);
  if (!baked) throw new Error(`no navmesh baked for world '${worldId}' — run pnpm gen:nav`);
  return NavMesh.load(bakedBytes(baked));
}
