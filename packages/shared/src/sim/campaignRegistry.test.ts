/**
 * U-073: a mission is one registry entry. The committed entries feed the world, mission, encounter and script tables
 * and the lobby; and a throwaway mission, built from copies of mission-01's files under another id, goes through the
 * same four builders with no other edit, which is what "add a mission by adding data and one entry" means.
 */
import { describe, expect, it } from 'vitest';
import { COMMITTED, type CampaignEntry, lobbyMaps } from './campaignRegistry.ts';
import { encounterFor, encountersFrom } from './encounters.ts';
import { missionFor, missions, missionsFrom } from './mission.ts';
import { scriptFor, scriptsFrom } from './scripts.ts';
import { WORLD_IDS, getWorld, worldsFrom } from './world.ts';

/** mission-01's four files, copied and renamed: the smallest honest stand-in for a new mission's data. */
function fixture(id: string): CampaignEntry {
  const base = COMMITTED.find((e) => e.id === 'mission-01')!;
  const level = structuredClone(base.world.raw) as Record<string, unknown>;
  level['id'] = id;
  level['encounter'] = id;
  const mission = structuredClone(base.mission) as Record<string, unknown>;
  mission['id'] = id;
  mission['world'] = id;
  const encounter = structuredClone(base.encounter) as Record<string, unknown>;
  encounter['world'] = id;
  const script = structuredClone(base.script) as Record<string, unknown>;
  script['world'] = id;
  return { id, world: { kind: 'level', raw: level }, mission, encounter, script, lobby: { label: 'Fixture mission', order: 5 } };
}

describe('the committed registry (U-073)', () => {
  it('is what every table is built from', () => {
    expect([...WORLD_IDS]).toEqual(COMMITTED.map((e) => e.id));
    for (const e of COMMITTED) {
      expect(getWorld(e.id)?.id).toBe(e.id);
      expect(missionFor(e.id) !== undefined).toBe(e.mission !== undefined);
      expect(encounterFor(e.id) !== undefined).toBe(e.encounter !== undefined);
      expect(scriptFor(e.id) !== undefined).toBe(e.script !== undefined);
    }
    expect(missions().map((m) => m.world).sort()).toEqual(COMMITTED.filter((e) => e.mission).map((e) => e.id).sort());
  });

  it('lists the lobby\'s maps in the order the entries ask, mission-01 first', () => {
    expect(lobbyMaps().map((m) => m.world)).toEqual(['mission-01', 'greybox-01', 'range', 'kit-gallery']);
    expect(lobbyMaps().every((m) => m.label.length > 0)).toBe(true);
  });
});

describe('a throwaway mission needs only its data and one entry (U-073)', () => {
  const entries = [...COMMITTED, fixture('fixture-01')];

  it('is found by every builder and listed in the lobby', () => {
    const worlds = worldsFrom(entries);
    expect(worlds.get('fixture-01')?.mission).toBeDefined();
    const ms = missionsFrom(entries);
    expect(ms.get('fixture-01')?.objectives.length).toBe(missionFor('mission-01')!.objectives.length);
    const es = encountersFrom(entries, (id) => worlds.get(id));
    expect(es.get('fixture-01')?.groups.length).toBe(encounterFor('mission-01')!.groups.length);
    const ss = scriptsFrom(entries, { world: (id) => worlds.get(id), mission: (id) => ms.get(id), encounter: (id) => es.get(id) });
    expect(ss.get('fixture-01')?.events.length).toBe(scriptFor('mission-01')!.events.length);
    expect(lobbyMaps(entries).at(-1)).toEqual({ world: 'fixture-01', label: 'Fixture mission' });
    // The committed tables are untouched by it.
    expect(getWorld('fixture-01')).toBeUndefined();
  });

  it('refuses an entry whose files name another id, naming the entry', () => {
    const wrong: CampaignEntry = { ...fixture('fixture-02'), id: 'fixture-03' };
    expect(() => worldsFrom([wrong])).toThrow(/registry entry 'fixture-03': its world file is 'fixture-02'/);
    const mismatched = { ...fixture('fixture-04'), mission: { ...(fixture('fixture-05').mission as object) } };
    expect(() => missionsFrom([mismatched])).toThrow(/registry entry 'fixture-04': its mission file is for world 'fixture-05'/);
  });

  it('refuses a script for a world with no mission or encounter', () => {
    const bare: CampaignEntry = { ...fixture('fixture-06'), mission: undefined, encounter: undefined };
    const worlds = worldsFrom([bare]);
    expect(() => scriptsFrom([bare], { world: (id) => worlds.get(id), mission: () => undefined, encounter: () => undefined })).toThrow(/has no mission/);
  });
});
