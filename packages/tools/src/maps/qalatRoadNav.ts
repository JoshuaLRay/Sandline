import { type World } from '@sandline/shared';
import { DEFAULT_NAV_AGENT, navConfigFor, worldSolids, worldSoup } from '../nav/bake.ts';
import { bakeSolidTiledNavMesh } from '../nav/solidBake.ts';
import { buildRoadSupportWorld } from './qalatRoadSupports.ts';

/**
 * The full isolated construction, including its X spur, exceeds Recast's
 * 24-bit compact-span ceiling as a solo mesh. Crop only the unused backing
 * plane and tile the entire built content with the unchanged standing agent.
 * No production mission, route link or committed campaign bake is activated.
 */
export async function bakeRoadSupportNav(world: World = buildRoadSupportWorld()): Promise<Uint8Array> {
  return bakeSolidTiledNavMesh(worldSoup(world), worldSolids(world), {
    ...navConfigFor(DEFAULT_NAV_AGENT), tileSize: 1024,
    bounds: [[-80, 0, -45], [150, 38, 470]],
  });
}
