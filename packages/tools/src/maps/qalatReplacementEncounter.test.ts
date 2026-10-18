import { describe, expect, it } from 'vitest';
import { DEFAULT_MOVE_CONFIG as cfg, blockedAt, parseEncounter, regionContains,
  regionContainsSegment, supportUnder } from '@sandline/shared';
import { Spawner, type SpawnerHost } from '../../../server/src/ai/director/spawner.ts';
import { certifyTankRoute } from './qalatTankSweep.ts';
import { buildReplacementEncounter, replacementEncounterWorld } from './qalatReplacementEncounter.ts';
import { replacementInputs } from './qalatReplacement.ts';
import raw from './qalat-replacement-encounter.json' with { type: 'json' };

const { world } = replacementInputs();
const context = replacementEncounterWorld(world);
const { encounter, emplacements } = buildReplacementEncounter(world);
const positions = encounter.groups.flatMap((group) => group.sockets!.map((s) => ({ group, ...s })));

describe('U-228 isolated candidate combat roster', () => {
  it('transcribes all 32 guards, POW, four prepositioned reserves and tank without changing live Qalat', () => {
    expect(encounter.aliveCap).toBe(42);
    expect(positions).toHaveLength(38);
    expect(positions.filter((p) => p.archetype === 'rifleman')).toHaveLength(35);
    expect(positions.filter((p) => p.archetype === 'mg').map((p) => p.id)).toEqual(['AF1','OG1']);
    expect(positions.filter((p) => p.archetype === 'pow').map((p) => p.id)).toEqual(['mission-pow']);
    expect(positions.filter((p) => p.archetype === 'tank').map((p) => p.id)).toEqual(['X0-tank']);
    expect(positions.map((p) => p.id)).toEqual([
      'AT1','AT2','AT3','AF1','AF2','AF3','AF4','AG1','AG2','AG3',
      'RL1','RL2','RL3','RU1','RU2','RU3','BG1','BG2','BG3','BE1','BE2','BE3',
      'BV1','BV2','BV3','OG1','OG2','OG3','OG4','OG5','OG6','OR1',
      'mission-pow','C1','C2','C3','C4','X0-tank',
    ]);
    expect(world.mission).toBeNull();
    expect(world.emplacements).toHaveLength(0);
    expect(context.emplacements).toEqual(emplacements);
    expect(emplacements).toMatchObject([{ id: 'og1-mg', kind: 'mg-nest', x: 31.2, y: 8, z: 360.4 }]);
  });

  it('keeps all standing points and per-member patrols on their authored floor', () => {
    expect(positions.filter((p) => p.patrol)).toHaveLength(9);
    for (const socket of positions) {
      if (socket.archetype === 'tank') continue;
      const all = [socket.feet, ...(socket.patrol?.route ?? []), ...(socket.advance ?? [])];
      expect(socket.patrol?.pauseSeconds ?? 3).toBe(3);
      for (const at of all) {
        const boxes = world.boxes.filter((b) =>
          b.maxX >= at.x - 1 && b.minX <= at.x + 1 && b.maxZ >= at.z - 1 && b.minZ <= at.z + 1);
        expect(supportUnder(at.x, at.z, cfg.radius, at.y + .05, boxes, cfg.groundY),
          `${socket.id}: no support at ${JSON.stringify(at)}`).toBeCloseTo(at.y, 4);
        expect(blockedAt(at.x, at.z, cfg.radius, at.y, .05, cfg.height, boxes),
          `${socket.id}: obstructed at ${JSON.stringify(at)}`).toBe(false);
        if (socket.combatRegion) {
          expect(regionContains(encounter.regions![socket.combatRegion]!, at),
            `${socket.id}: outside patrol/advance bound`).toBe(true);
        }
      }
      if (socket.patrol) for (let i = 1; i < socket.patrol.route.length; i++)
        expect(regionContainsSegment(encounter.regions![socket.combatRegion!]!,
          socket.patrol.route[i - 1]!, socket.patrol.route[i]!)).toBe(true);
    }
  });

  it('retains a fully swept y8 tank route to A1 and one-shot staged activation', () => {
    const tank = encounter.groups.find((g) => g.id === 'tank')!;
    const path = [tank.sockets![0]!.feet, ...tank.path!].map((p) => ({ ...p, id: undefined }));
    expect(path.at(-1)).toMatchObject({ x: 32, y: 8, z: 98 });
    expect(path).toHaveLength(18);
    expect(() => certifyTankRoute(world.boxes, path)).not.toThrow();
    expect(['counterattack', 'tank'].map((id) =>
      encounter.groups.find((g) => g.id === id)!.trigger.kind)).toEqual(['script', 'script']);
  });

  it('initializes 38 persistent identities at either human budget and never respawns a pre-killed reserve', () => {
    for (const humanCount of [1, 6]) {
      const alive = new Map<number, { x: number; y: number; z: number }>();
      const active = new Map<number, boolean>();
      const names: string[] = [];
      let next = 2000;
      const host: SpawnerHost = {
        humanEyes: () => Array.from({ length: humanCount }, () => ({ x: 0, y: 9.6, z: -6 })),
        squadFeet: () => [],
        enemyFeet: () => [...alive.values()],
        isAlive: (id) => alive.has(id),
        ground: (p) => p,
        spawn: (_archetype, data) => {
          const id = next++;
          alive.set(id, { x: data.x, y: data.y, z: data.z });
          active.set(id, !data.inactive);
          names.push(data.spawnId!);
          return id;
        },
        release: (id) => { active.set(id, true); },
      };
      const spawner = new Spawner(encounter, context, host, 1000, undefined, true);
      spawner.initialize();
      expect(spawner.log).toHaveLength(38);
      expect(new Set(names).size).toBe(38);
      expect(names).toEqual(positions.map((s) => s.id));
      expect(spawner.pending).toBe(0);
      const reserve = spawner.spawnedBy('counterattack');
      const tank = spawner.spawnedBy('tank');
      expect(reserve).toHaveLength(4);
      expect(tank).toHaveLength(1);
      for (const id of [...reserve, ...tank]) expect(active.get(id)).toBe(false);
      alive.delete(reserve[0]!); active.delete(reserve[0]!);
      alive.delete(tank[0]!); active.delete(tank[0]!);
      expect(spawner.activate('counterattack', 300)).toBe(true);
      expect(spawner.activate('tank', 301)).toBe(true);
      expect(spawner.activate('counterattack', 302)).toBe(false);
      expect(spawner.activate('tank', 302)).toBe(false);
      expect(spawner.spawnedBy('counterattack')).toEqual(reserve);
      expect(spawner.spawnedBy('tank')).toEqual(tank);
      for (const id of reserve.slice(1)) expect(active.get(id)).toBe(true);
      expect(spawner.log).toHaveLength(38);
    }
  });

  it('rejects tampered floor sockets, unknown regions and duplicate member identities', () => {
    const altered = structuredClone(raw);
    altered.groups[0]!.sockets![0]!.feet.y = 0;
    expect(() => parseEncounter(altered, (id) => id === world.id ? context : undefined)).toThrow();
    altered.groups[0]!.sockets![0]!.feet.y = 8;
    altered.groups[0]!.sockets![0]!.combatRegion = 'not-a-region';
    expect(() => parseEncounter(altered, (id) => id === world.id ? context : undefined)).toThrow();
    altered.groups[0]!.sockets![0]!.combatRegion = 'road-toll';
    altered.groups[0]!.sockets![0]!.id = 'AT2';
    expect(() => parseEncounter(altered, (id) => id === world.id ? context : undefined)).toThrow();
  });
});
