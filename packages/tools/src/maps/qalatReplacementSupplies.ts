/** U-229: exact §12 caches for the unregistered Qalat revision-2 replacement only. */
import { DEFAULT_MOVE_CONFIG as move, blockedAt, parseSupplyCaches, supportUnder,
  type SupplyCacheDef, type World } from '@sandline/shared';
import authored from './qalat-replacement-supplies.json' with { type: 'json' };

const IDS = ['P-SOUTH', 'P-ROAD', 'P-RIDGE', 'P-BASEMENT', 'P-OUTPOST'];

/** Do not add these coordinates to the revision-1 registry or live script. */
export function buildReplacementSupplies(world: World): readonly SupplyCacheDef[] {
  if (world.id !== 'qalat-outpost-construction' || world.mapRevision !== 2)
    throw new Error('U-229 cache placements require unregistered replacement revision 2');
  const caches = parseSupplyCaches(authored, 'U-229 replacement supplies');
  if (caches.length !== IDS.length || caches.some((c, i) => c.id !== IDS[i]) ||
      caches.reduce((sum, c) => sum + (c.stock.projectiles.rocket ?? 0), 0) !== 24)
    throw new Error('U-229 requires five fixed cache IDs and all 24 rocket rounds');
  for (const cache of caches) {
    const at = cache.feet;
    const nearby = world.boxes.filter((b) => b.maxX >= at.x - 2 && b.minX <= at.x + 2 &&
      b.maxZ >= at.z - 2 && b.minZ <= at.z + 2);
    const support = supportUnder(at.x, at.z, move.radius, at.y + .05, nearby, move.groundY);
    if (Math.abs(support - at.y) > .05 ||
        blockedAt(at.x, at.z, move.radius, at.y, .05, move.height, nearby))
      throw new Error(`U-229 cache '${cache.id}' has no supported/clear authored floor at ${JSON.stringify(at)}`);
  }
  return caches;
}
