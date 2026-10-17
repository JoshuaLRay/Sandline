import { type World } from '@sandline/shared';
import { bakeTiledStanding, type TiledStandingPlan } from '../nav/export.ts';
import { buildRoadSupportWorld } from './qalatRoadSupports.ts';

/**
 * The full isolated construction, including its X spur, exceeds Recast's
 * 24-bit compact-span ceiling as a solo mesh. Crop only the unused backing
 * plane and tile the entire built content with the unchanged standing agent.
 * No production mission, route link or committed campaign bake is activated.
 */
export const QALAT_TILED_PLAN: TiledStandingPlan = { kind: 'tiled-standing', tileSize: 1024,
  bounds: [[-80, 0, -45], [150, 38, 470]] };

export async function bakeRoadSupportNav(world: World = buildRoadSupportWorld()): Promise<Uint8Array> {
  return bakeTiledStanding(world, QALAT_TILED_PLAN);
}
