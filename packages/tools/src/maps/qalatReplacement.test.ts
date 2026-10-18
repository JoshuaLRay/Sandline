import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MOVE_CONFIG as move, TICK_SECONDS, WORLD_IDS, blockedAt, createMoveState,
  missionFor, requireWorld, stepCharacter, supportUnder } from '@sandline/shared';
import { completePathLength, type NavPoint } from '../../../server/src/ai/nav/NavMesh.ts';
import { PathFollower } from '../../../server/src/ai/locomotion/followPath.ts';
import { bakedBytes } from '../../../server/src/ai/nav/baked/types.ts';
import { bakedNavFor } from '../../../server/src/ai/nav/bakedNav.ts';
import { navBakeHash } from '../nav/bake.ts';
import { digest, exportInputHash, bakeTiledStanding } from '../nav/export.ts';
import { bodyBlocked } from '../nav/cover.ts';
import { QALAT_TILED_PLAN } from './qalatRoadNav.ts';
import { buildOutpostLevel } from './qalatOutpost.ts';
import { buildReplacementBundle, reloadReplacement, type ReplacementBundle } from './qalatReplacement.ts';

// Independent construction witnesses: insertion, three full lanes, and the actual accepted east pad.
const p = (x: number, y: number, z: number): NavPoint => ({ x, y, z });
const insertion = [p(0,8,-6), p(-12,8,18), p(-12,8,36), p(12,8,44), p(48,8,46.75), p(32,8,64)];
const road = [[32,98],[12,128],[-37,142],[-28,210],[26,232],[30,270],[-18,302],[16,332],[32,350],[32,374]].map(([x,z])=>p(x!,8,z!));
const ridge = [[62,8,68],[78,14,96],[64,20,128],[80,26,168],[94,30,210],[86,30,248],[72,26,286],
  [70,20,322],[70,16,336],[70,12,350],[59,8,374],[32,8,374]].map(([x,y,z])=>p(x!,y!,z!));
// Room centres can contain accepted furniture; these are clear circulation witnesses.
const depot = [[-2,0,96],[-20,0,120],[-40,0,160],[-18,0,200],[8,0,232],[30,0,270],[-14,0,310],[-14,0,346],[-8,0,370]]
  .map(([x,y,z])=>p(x!,y!,z!));
let bundle: ReplacementBundle, loaded: ReturnType<typeof reloadReplacement>;
const windows = new Map<string, ReturnType<typeof reloadReplacement>['world']['boxes']>();
function local(at: NavPoint) {
  const x = Math.floor(at.x / 8) * 8, z = Math.floor(at.z / 8) * 8, key = `${x}/${z}`;
  if (!windows.has(key)) windows.set(key, loaded.world.boxes.filter((b) => b.maxX >= x - 2 && b.minX <= x + 10 && b.maxZ >= z - 2 && b.minZ <= z + 10));
  return { ...loaded.world, boxes: windows.get(key)! };
}

describe('U-227 staged complete replacement', () => {
  beforeAll(async () => {
    bundle = await buildReplacementBundle();
    loaded = reloadReplacement(JSON.parse(JSON.stringify(bundle)) as ReplacementBundle);
  }, 240_000);
  afterAll(() => loaded?.nav.destroy());

  it('binds serialized complete geometry, render surface, starts, holdings, standing tiled nav and cover to the committed manifest', async () => {
    const manifest = JSON.parse(await readFile(new URL('../../../../artifacts/qalat-replacement/manifest.json', import.meta.url), 'utf8'));
    expect(bundle.manifest).toEqual(manifest);
    const { mapRevision: _revision, ...level } = bundle.level;
    expect(level).toEqual(buildOutpostLevel());
    expect(bundle.level.squadStarts).toEqual([-10,-6].flatMap((z) => [-6,-2,2].map((x)=>p(x,8,z))));
    expect(loaded.mission.prisonerHoldings).toHaveLength(5);
    expect(loaded.pow.feet).toEqual(p(16,8,402));
    expect(loaded.nav.links()).toEqual([]);
    expect(bundle.surface.triangles).toBeGreaterThan(0);
    expect(bundle.manifest.bytes.level + bundle.manifest.bytes.surface + JSON.stringify(bundle.nav).length).toBeLessThan(80_000_000);
  }, 60_000);

  it('U-228 binds fixed enemy sockets and patrols to the exported standing nav without registering them', () => {
    const sockets = bundle.encounter.groups.flatMap((g) => g.sockets ?? []);
    expect(sockets).toHaveLength(38);
    expect(loaded.encounter.groups).toEqual(bundle.encounter.groups);
    expect(loaded.emplacements).toHaveLength(1);
    const all = sockets.flatMap((s) => [s.feet, ...(s.patrol?.route ?? []), ...(s.advance ?? [])]);
    for (const at of all) {
      const nearest = loaded.nav.nearestPoint(at)?.point;
      expect(nearest, `missing actual standing nav at ${JSON.stringify(at)}`).toBeDefined();
      expect(Math.abs(nearest!.y - at.y), JSON.stringify(at)).toBeLessThan(.35);
      expect(Math.hypot(nearest!.x - at.x, nearest!.z - at.z), JSON.stringify(at)).toBeLessThan(.65);
    }
    const damaged = structuredClone(bundle);
    damaged.encounter.groups[0]!.sockets![0]!.feet.x += 1;
    expect(() => reloadReplacement(damaged)).toThrow(/encounter/);
    expect(loaded.world.mission).toBeNull();
  }, 60_000);

  it('rebakes the exported nav deterministically and keeps legacy registered inputs and hashes', async () => {
    expect(Buffer.from(await bakeTiledStanding(loaded.world, QALAT_TILED_PLAN)).equals(Buffer.from(bakedBytes(bundle.nav)))).toBe(true);
    for (const id of WORLD_IDS) expect(exportInputHash(requireWorld(id))).toBe(navBakeHash(requireWorld(id)));
    expect(WORLD_IDS).not.toContain(loaded.world.id);
    expect(missionFor(loaded.world.id)).toBeUndefined();
    expect(bakedNavFor(loaded.world.id)).toBeUndefined();
    expect(requireWorld('qalat-road').mapRevision ?? 1).toBe(1);
  }, 240_000);

  it('rejects stale or mixed-world serialized level, render, nav, cover, mission, holdings, starts and plan inputs', async () => {
    const changes: ((b: ReplacementBundle) => void)[] = [
      (b)=>{b.level.boxes[0]!.h += 1;}, (b)=>{b.surface.data = 'bad';},
      (b)=>{b.nav.base64 = 'bad';}, (b)=>{b.nav.cover = [];}, (b)=>{b.mission.world = 'qalat-road';},
      (b)=>{b.manifest.pow.feet.y = 0;}, (b)=>{b.level.squadStarts[0]!.x += 1;},
      (b)=>{b.manifest.navPlan.tileSize = 512;}, (b)=>{b.manifest.hashes.level = 'stale';},
    ];
    for (const change of changes) {
      const altered = structuredClone(bundle); change(altered);
      expect(()=>reloadReplacement(altered)).toThrow();
      await new Promise<void>((resolve)=>setImmediate(resolve));
    }
    expect(exportInputHash(loaded.world, { ...QALAT_TILED_PLAN, tileSize: 512 })).not.toBe(bundle.nav.hash);
    expect(digest(bundle.manifest.hashes)).toBe(bundle.manifest.bundleHash);
  }, 60_000);

  it('keeps all authored starts, lane/room/gate witnesses and six holdings on the proper connected floors', () => {
    const witnesses = [...bundle.level.squadStarts, ...insertion, ...road, ...ridge, ...depot,
      loaded.pow.feet, ...loaded.mission.prisonerHoldings!.map((h)=>h.feet)];
    for (const at of witnesses) {
      const near = loaded.nav.nearestPoint(at)?.point;
      expect(near, JSON.stringify(at)).toBeDefined();
      expect(Math.hypot(near!.x-at.x, near!.z-at.z)).toBeLessThan(.3);
      expect(Math.abs(near!.y-at.y)).toBeLessThan(.3);
      expect(loaded.nav.connected(insertion[0]!, at), JSON.stringify(at)).toBe(true);
    }
    for (const at of [p(-70,0,-35),p(140,0,460),p(32,0,374),p(16,12.8,402)])
      expect(loaded.nav.connected(insertion[0]!, at), `backing plane/roof ${JSON.stringify(at)}`).toBe(false);
  }, 60_000);

  it('retains supported, unobstructed cover on basement, road, ridge and outpost floors', () => {
    const floors = new Set<number>();
    expect(bundle.nav.cover.length).toBeGreaterThan(100);
    for (const at of bundle.nav.cover) {
      const nearby = local(at);
      expect(bodyBlocked(at.x, at.y, at.z, nearby, bundle.nav.agent)).toBe(false);
      expect(supportUnder(at.x,at.z,move.radius,at.y+move.stepHeight,nearby.boxes,0)).toBe(at.y);
      expect(Math.abs(loaded.nav.nearestPoint(at)!.point.y-at.y)).toBeLessThanOrEqual(move.stepHeight);
      floors.add(Math.round(at.y));
    }
    for (const y of [0,8,26,30]) expect(floors.has(y)).toBe(true);
    for (const [prefix, y] of [['outpost-',8], ['depot-',0], ['road-combat-',8], ['ridge-',26]] as const)
      expect(bundle.nav.cover.some((c)=>c.box.startsWith(prefix) && c.y===y), `${prefix} floor ${y}`).toBe(true);
  }, 120_000);

  it('follows exported standing routes across tiled seams, elevated bridge and basement with the actual controller', async () => {
    const routes = [insertion, [insertion.at(-1)!, ...road], [insertion.at(-1)!, ...ridge], depot];
    let ticks = 0;
    for (const route of routes) for (const reverse of [false,true]) {
      const stops = reverse ? [...route].reverse() : route, first = stops[0]!;
      let state = { ...createMoveState(first.x,first.y,first.z), grounded: true };
      const follower = new PathFollower(loaded.nav, loaded.world.boxes);
      for (const goal of stops.slice(1)) {
        expect(completePathLength(loaded.nav.path(state,goal),state,goal),JSON.stringify(goal)).not.toBeNull();
        let arrived = false;
        for (let tick=0; tick<3000; tick++) {
          const {input,status} = follower.step(state,{goal,pace:'walk'},0);
          if (status==='arrived') { arrived=true; break; }
          expect(input.jump).toBe(false);
          state = stepCharacter(state,input,TICK_SECONDS,move,local(state).boxes);
          expect(state.vault).toBeNull(); expect(state.crouched || state.prone).toBe(false);
          expect(blockedAt(state.x,state.z,move.radius,state.y,move.stepHeight,move.height,local(state).boxes)).toBe(false);
          expect(state.y).toBeGreaterThanOrEqual(-.00001); expect(state.y).toBeLessThanOrEqual(30.00001);
          if (++ticks%256===0) await new Promise<void>((resolve)=>setImmediate(resolve));
        }
        expect(arrived,`stalled ${JSON.stringify(state)} toward ${JSON.stringify(goal)}`).toBe(true);
        expect(Math.abs(state.y-goal.y)).toBeLessThanOrEqual(move.stepHeight);
      }
    }
  }, 180_000);
});
