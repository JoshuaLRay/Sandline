/** U-225: unregistered replacement fixture. U-226 supplies Session lifecycle
 * scenarios; production objectives, registry and saves remain U-117. */
import { DEFAULT_MOVE_CONFIG, checkPrisonerHoldings, parseMission, type World } from '@sandline/shared';
import source from './qalat-outpost-mission.json' with { type: 'json' };
import { OUTPOST, buildOutpostWorld } from './qalatOutpost.ts';

export function buildOutpostCaptiveFixture(world: World = buildOutpostWorld(), raw: unknown = source) {
  const mission = parseMission(raw), holdings = mission.prisonerHoldings;
  if (mission.world !== OUTPOST.id || world.id !== OUTPOST.id) throw new Error('outpost captive fixture: wrong composed world');
  if (!holdings || holdings.length !== 5) throw new Error('outpost captive fixture: requires all five carried holdings');
  // The original POW keeps its separately authored encounter/construction socket.
  const original = OUTPOST.holding.positions.find((p) => p.role === 'original-mission-pow')!;
  const pow = { id: original.id, feet: { x: original.x, y: original.y, z: original.z } };
  if (holdings.some((h) => h.id === pow.id)) throw new Error('outpost captive fixture: POW is separate from carried holdings');
  const cell = OUTPOST.rooms.find((r) => r.id === 'cell')!, radius = DEFAULT_MOVE_CONFIG.radius;
  for (const { id, feet: p } of [pow, ...holdings]) {
    if (p.y !== OUTPOST.floorY || p.x - radius < cell.minX || p.x + radius > cell.maxX ||
      p.z - radius < cell.minZ || p.z + radius > cell.maxZ) {
      throw new Error(`prisoner holding '${id}': outside the intended cell floor`);
    }
  }
  // Validate the complete capacity, including POW separation, even for an empty pool.
  checkPrisonerHoldings([pow, ...holdings], world);
  return { world, mission: { ...mission, prisonerHoldings: holdings }, pow };
}
