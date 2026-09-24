import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from 'pngjs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ASSET_MANIFEST,
  type AssetManifest,
  type World,
  requireWorld,
} from '@sandline/shared';
import {
  checkAllLevels,
  checkLevel,
  collisionOverlaps,
  navmeshIslands,
  pieceBudgetTotals,
  routeConnectivity,
  visibleSpawnZones,
  type LevelNavProbe,
} from './level-check.ts';
import { initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { loadWorldNavMesh } from '../../../server/src/ai/nav/bakedNav.ts';

const fixtureMission = {
  start: { x: 0, z: 0, radius: 3 },
  objective: { x: 10, z: 0, radius: 3 },
  routes: [{ id: 'route-a', role: 'overwatch' as const, via: [] }],
  spawnZones: [{ id: 'spawn', on: 'route-a', x: 4, z: 0, radius: 1 }],
  checks: {
    sampleM: 1,
    minDistinctShare: 0.5,
    coverWithinM: 5,
    maxUncoveredM: { overwatch: 10, assault: 10 },
    sightM: 10,
  },
};

const fixtureWorld = (): World => ({
  id: 'fixture',
  boxes: [],
  floorHalfExtent: 20,
  mission: fixtureMission,
  pieces: [],
  encounter: null,
});

describe('T-4.11 level validation', () => {
  beforeAll(async () => {
    await initNav();
  });

  it('detects overlapping collision in a failing fixture', () => {
    const issues = collisionOverlaps([
      { id: 'a', x: 0, y: 0, z: 0, w: 2, h: 2, d: 2 },
      { id: 'b', x: 0.75, y: 0, z: 0, w: 2, h: 2, d: 2 },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('a and b');
  });

  it('detects an unreachable navmesh island in a failing fixture', () => {
    const polygons = [
      { ref: 1, centre: { x: 0, y: 0, z: 0 }, corners: [] },
      { ref: 2, centre: { x: 10, y: 0, z: 0 }, corners: [] },
    ];
    const nav: LevelNavProbe = {
      polygons: () => polygons,
      path: (_from, to) => to.x < 5 ? { corridor: [1], points: [_from, to], vaults: [] } : null,
    };
    const issues = navmeshIslands(nav, { x: 0, y: 0, z: 0 });
    expect(issues.some((i) => i.message.includes('polygon 2'))).toBe(true);
  });

  it('detects a spawn zone visible from the start in a failing fixture', () => {
    const issues = visibleSpawnZones(fixtureWorld());
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('spawn zone spawn');
  });

  it('detects a disconnected route leg in a failing fixture', () => {
    const nav: LevelNavProbe = {
      polygons: () => [{ ref: 1, centre: { x: 0, y: 0, z: 0 }, corners: [] }],
      path: () => null,
    };
    const result = routeConnectivity(nav, fixtureMission);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.message).toContain('route-a');
  });

  it('detects summed level piece bytes over the initial-download budget in a failing fixture', () => {
    const world = {
      ...fixtureWorld(),
      mission: null,
      pieces: [
        { id: 'a', piece: 'oversize', x: 0, y: 0, z: 0, rot: 0 },
        { id: 'b', piece: 'oversize', x: 10, y: 0, z: 0, rot: 0 },
      ],
    } as World;
    const manifest = {
      assets: [{
        id: 'oversize',
        bytes: 41_000_001,
        triangles: 1,
        bones: 0,
        materials: 1,
        textures: [{ width: 1, height: 1, format: 'ktx2' }],
        class: 'kit',
      }],
    } as unknown as AssetManifest;
    const result = pieceBudgetTotals(world, manifest);
    expect(result.issues).toHaveLength(1);
    expect(result.totals.bytes).toBe(82_000_002);
  });

  it('passes every committed level, including greybox-01, and emits deterministic review renders', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'sandline-level-check-'));
    try {
      const reports = await checkAllLevels({
        renderDir: outDir,
      });
      expect(reports.map((r) => r.id)).toEqual(['greybox-01', 'kit-gallery']);
      for (const report of reports) {
        expect(report.issues, report.id + ': ' + JSON.stringify(report.issues)).toEqual([]);
        expect(report.renders).toBeDefined();
        const renders = report.renders!;
        const topDown = PNG.sync.read(readFileSync(renders.topDown));
        expect(topDown.width).toBe(1024);
        expect(topDown.height).toBe(768);
        expect(renders.cameras).toHaveLength(3);
        for (const path of renders.cameras) {
          const image = PNG.sync.read(readFileSync(path));
          expect(image.width).toBe(960);
          expect(image.height).toBe(640);
        }
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('keeps greybox-01 free of T-4.11 issues when checked directly', () => {
    const world = requireWorld('greybox-01');
    const nav = loadWorldNavMesh('greybox-01');
    try {
      const report = checkLevel(world, nav, ASSET_MANIFEST);
      expect(report.issues).toEqual([]);
      expect(report.budgets.instances).toBe(0);
    } finally {
      nav.destroy();
    }
  });
});
