/**
 * U-073: every world and mission this build knows, in ONE place.
 *
 * A world, its mission, its encounter and its event script used to be imported and listed separately in four
 * modules (`world.ts`, `mission.ts`, `encounters.ts`, `scripts.ts`) and again in the lobby. Now each is one entry
 * here, and those modules derive their tables from `COMMITTED` with `worldsFrom`, `missionsFrom`, `encountersFrom`
 * and `scriptsFrom`, which take any list of entries (a test builds a throwaway mission the same way).
 *
 * TO ADD A MISSION (see `docs/COMMANDS.md`):
 * 1. Author its data under `data/`: `levels/<id>.json`, `missions/<id>.json`, `encounters/<id>.json` and, if it has
 *    one, `scripts/<id>.json`. The level's `id`, the mission's `world` and the encounter's `world` are all `<id>`.
 * 2. Add the imports and ONE entry below. Nothing else in the shared package changes.
 * 3. `pnpm gen:nav` (the baked navmesh and cover, generated for every registered world), then `pnpm verify`.
 * `level-check`, `check:assets` and `sim-run --scenario mission --all-missions` find the new mission from its files.
 *
 * This module imports only JSON, so every consumer (the page included) can read it without a cycle.
 */
import RANGE_WORLD from '../data/worlds/range.json' with { type: 'json' };
import GREYBOX_01_LEVEL from '../data/levels/greybox-01.json' with { type: 'json' };
import KIT_GALLERY_LEVEL from '../data/levels/kit-gallery.json' with { type: 'json' };
import MISSION_01_LEVEL from '../data/levels/mission-01.json' with { type: 'json' };
import GREYBOX_01_MISSION from '../data/missions/greybox-01.json' with { type: 'json' };
import MISSION_01_MISSION from '../data/missions/mission-01.json' with { type: 'json' };
import GREYBOX_01_ENCOUNTER from '../data/encounters/greybox-01.json' with { type: 'json' };
import MISSION_01_ENCOUNTER from '../data/encounters/mission-01.json' with { type: 'json' };
import MISSION_01_SCRIPT from '../data/scripts/mission-01.json' with { type: 'json' };

import QALAT_LEVEL from '../data/levels/qalat-road.json' with { type: 'json' };
import QALAT_MISSION from '../data/missions/qalat-road.json' with { type: 'json' };
import QALAT_SCRIPT from '../data/scripts/qalat-road.json' with { type: 'json' };
import QALAT_ENCOUNTER from '../data/encounters/qalat-road.json' with { type: 'json' };

/** One world and what plays on it. Everything but `id` and `world` is optional: the range has no mission. */
export interface CampaignEntry {
  /** The world's id; also the key a mission, encounter and script are found by. */
  id: string;
  /** A hand-written world file (`worlds/`, the range) or a level file (`levels/`, the kit-built maps). */
  world: { kind: 'world' | 'level'; raw: unknown };
  mission?: unknown;
  encounter?: unknown;
  /** The mission's event script (`scripts/`). */
  script?: unknown;
  /** Listed in the lobby's map picker, in `order`, under `label`. */
  lobby?: { label: string; order: number };
}

/** Everything committed. The order is the order of `WORLD_IDS`. */
export const COMMITTED: readonly CampaignEntry[] = [
  { id: 'range', world: { kind: 'world', raw: RANGE_WORLD }, lobby: { label: 'Range — the QA range, no mission', order: 2 } },
  {
    id: 'greybox-01',
    world: { kind: 'level', raw: GREYBOX_01_LEVEL },
    mission: GREYBOX_01_MISSION,
    encounter: GREYBOX_01_ENCOUNTER,
    lobby: { label: 'Grey box — mission layout fixture', order: 1 },
  },
  { id: 'kit-gallery', world: { kind: 'level', raw: KIT_GALLERY_LEVEL }, lobby: { label: 'Kit gallery — every kit piece, walkable', order: 3 } },
  {
    id: 'mission-01',
    world: { kind: 'level', raw: MISSION_01_LEVEL },
    mission: MISSION_01_MISSION,
    encounter: MISSION_01_ENCOUNTER,
    script: MISSION_01_SCRIPT,
    lobby: { label: 'QA slice — clear and hold the qalat', order: 0 },
  },
  {
    id: 'qalat-road',
    world: { kind: 'level', raw: QALAT_LEVEL },
    mission: QALAT_MISSION,
    encounter: QALAT_ENCOUNTER,
    script: QALAT_SCRIPT,
    lobby: { label: 'Mission 01 — The Qalat Road', order: 4 },
  },
];

/** The lobby's map list: the entries that name a label, in order. */
export function lobbyMaps(entries: readonly CampaignEntry[] = COMMITTED): { world: string; label: string }[] {
  return entries
    .filter((e): e is CampaignEntry & { lobby: NonNullable<CampaignEntry['lobby']> } => e.lobby !== undefined)
    .sort((a, b) => a.lobby.order - b.lobby.order)
    .map((e) => ({ world: e.id, label: e.lobby.label }));
}
