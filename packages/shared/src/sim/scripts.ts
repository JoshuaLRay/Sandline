/**
 * Committed mission event scripts (T-5.01), by mission id. Each is parsed at
 * import against its world, encounter and mission (T-4.15), so a script that
 * names a group, area or objective that is not there fails the build rather
 * than the room. A mission with no file plays none, as before.
 */
import MISSION_01 from '../data/scripts/mission-01.json' with { type: 'json' };
import { encounterFor } from './encounters.ts';
import { type EventScript, parseEventScript } from './events.ts';
import { missions } from './mission.ts';
import { requireWorld } from './world.ts';

const RAW: Readonly<Record<string, unknown>> = { 'mission-01': MISSION_01 };

const SCRIPTS: ReadonlyMap<string, EventScript> = new Map(
  missions()
    .filter((m) => m.id in RAW)
    .map((m) => {
      const world = requireWorld(m.world);
      const encounter = encounterFor(m.world);
      if (!encounter) throw new Error(`script '${m.id}': world '${m.world}' has no encounter`);
      return [m.id, parseEventScript(RAW[m.id], encounter, world, m)] as const;
    }),
);

/** The committed event script for a mission, or undefined when it has none. */
export function scriptFor(missionId: string): EventScript | undefined {
  return SCRIPTS.get(missionId);
}
