/**
 * Committed mission event scripts (T-5.01), by mission id. Each is parsed at
 * import against its world, encounter and mission (T-4.15), so a script that
 * names a group, area or objective that is not there fails the build rather
 * than the room. A mission with no file plays none, as before. The scripts are
 * the registry's (`campaignRegistry.ts`, U-073).
 */
import { COMMITTED, type CampaignEntry } from './campaignRegistry.ts';
import { type Encounter, encounterFor } from './encounters.ts';
import { type EventScript, parseEventScript } from './events.ts';
import { type MissionDef, missionFor } from './mission.ts';
import { type World, getWorld } from './world.ts';

/** The scripts of a list of registry entries, by mission id (U-073); the lookups find each entry's world, mission and encounter. */
export function scriptsFrom(
  entries: readonly CampaignEntry[],
  find: {
    world: (id: string) => World | undefined;
    mission: (worldId: string) => MissionDef | undefined;
    encounter: (worldId: string) => Encounter | undefined;
  } = { world: getWorld, mission: missionFor, encounter: encounterFor },
): ReadonlyMap<string, EventScript> {
  return new Map(
    entries
      .filter((e) => e.script !== undefined)
      .map((e) => {
        const mission = find.mission(e.id);
        if (!mission) throw new Error(`script '${e.id}': world '${e.id}' has no mission`);
        const world = find.world(e.id);
        if (!world) throw new Error(`script '${e.id}': no world '${e.id}'`);
        const encounter = find.encounter(e.id);
        if (!encounter) throw new Error(`script '${e.id}': world '${e.id}' has no encounter`);
        return [mission.id, parseEventScript(e.script, encounter, world, mission)] as const;
      }),
  );
}

const SCRIPTS: ReadonlyMap<string, EventScript> = scriptsFrom(COMMITTED);

/** The committed event script for a mission, or undefined when it has none. */
export function scriptFor(missionId: string): EventScript | undefined {
  return SCRIPTS.get(missionId);
}
