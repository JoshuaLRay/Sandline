import { describe, expect, it } from 'vitest';
import { DEFAULT_MOVE_CONFIG, blockedAt, supportUnder } from '@sandline/shared';
import { INSERTION } from './qalatInsertion.ts';
import { insertionObservers, verifyInsertionScreening } from './insertionScreening.ts';
import { ROAD_SUPPORTS, buildRoadSupportWorld } from './qalatRoadSupports.ts';
import { RIDGE } from './qalatRidge.ts';
import { ROAD_TERRAIN } from './qalatRoadTerrain.ts';

const world = buildRoadSupportWorld();

describe('U-169 completed surface screening and continuation contracts', () => {
  it('runs complete GEO-07 guard, patrol, reserve and high-observer body rays on the integrated scene', async () => {
    // Reject a partial fixture: all three bays and both stairs must contribute
    // their actual collision, with no temporary bay/crossing caps left behind.
    for (const id of ['V1', 'V2', 'V3']) {
      expect(world.boxes.some((b) => b.id.startsWith(`ridge-bay-${id}-`)), id).toBe(true);
    }
    for (const [id, x, z, y] of [['C12-L', 40, 140, 12], ['C12-U', 62, 216, 14]] as const) {
      const floors = world.boxes.filter((b) => b.id.startsWith('crossing-floor-'));
      expect(supportUnder(x, z, DEFAULT_MOVE_CONFIG.radius, y + .05, floors, 0), id).toBe(y);
    }
    expect(ROAD_TERRAIN.temporaryCaps.map((cap) => cap.id)).toEqual(['south-gate']);
    expect(RIDGE.temporaryCaps.map((cap) => cap.id)).toEqual(['east-gate']);
    const evidence = await verifyInsertionScreening(world);
    expect(evidence.map((e) => e.observers)).toEqual(insertionObservers().map((group) => group.points.length));
    expect(evidence.every((e) => e.targets > 10_000 && e.sampleStepM === 1)).toBe(true);
    expect(evidence.reduce((rays, e) => rays + e.rays, 0)).toBeGreaterThan(10_000_000);
    console.log('U-169 integrated GEO-07', JSON.stringify(evidence));
  }, 240_000);

  it('fails screening when the actual southern protection is removed', async () => {
    await expect(verifyInsertionScreening({ ...world, boxes: world.boxes.filter((b) => b.minZ >= 60) }))
      .rejects.toThrow(/guards and reserves: unscreened/);
  });

  it('preserves the exact U-115 depot mouth and continuous below-surface construction volume', () => {
    expect(INSERTION.continuations.find((p) => p.id === 'depot'))
      .toEqual({ id: 'depot', x: 12, y: 8, z: 68, width: 6 });
    expect(ROAD_SUPPORTS.reservedVault).toEqual({ minX: 16, maxX: 44, minZ: 252, maxZ: 288, floorY: 0, ceilingY: 5.5 });
    // Every northern solid respects the reserved room/corridor ceiling, not
    // just a convenient point in B6. No surface leaf builds a basement route.
    const north = world.boxes.filter((b) => b.maxZ > 84);
    expect(north.length).toBeGreaterThan(10_000);
    expect(north.every((b) => b.minY >= 5.5)).toBe(true);
    const mouth = world.boxes.filter((b) => b.maxX > 8 && b.minX < 16 && b.maxZ > 66 && b.minZ < 71);
    expect(supportUnder(12, 68, DEFAULT_MOVE_CONFIG.radius, 8.05, mouth, 0)).toBe(8);
    expect(blockedAt(12, 68, DEFAULT_MOVE_CONFIG.radius, 8, 0, DEFAULT_MOVE_CONFIG.height, mouth)).toBe(false);
    expect(blockedAt(12, 70, DEFAULT_MOVE_CONFIG.radius, 8, 0, DEFAULT_MOVE_CONFIG.height, mouth)).toBe(true);
  });

  it('keeps U-116 south/east endpoints and their temporary closures exact', () => {
    expect(ROAD_SUPPORTS.spine.at(-1)).toEqual({ id: 'south-gate', x: 32, y: 8, z: 356 });
    expect(RIDGE.spine.at(-1)).toEqual({ id: 'R9', x: 56, y: 8, z: 370 });
    expect(ROAD_TERRAIN.temporaryCaps[0]).toMatchObject({
      id: 'south-gate', for: 'U-116', minX: 20, maxX: 48, minZ: 346, maxZ: 362, top: 20,
    });
    expect(RIDGE.temporaryCaps[0]).toMatchObject({
      id: 'east-gate', for: 'U-116', minX: 52, maxX: 60, minZ: 374, maxZ: 374.6, bottomY: 5.5, top: 10.2,
    });
    expect(world.boxes.find((b) => b.id === 'ridge-cap-east-gate')).toMatchObject({
      minX: 52, maxX: 60, minZ: 374, maxZ: 374.6, minY: 5.5, maxY: 10.2,
    });
    // The road socket has standing air; the east path ends at the closed gate
    // face. Neither fixture pretends the unbuilt courtyard is traversable.
    expect(supportUnder(32, 356, DEFAULT_MOVE_CONFIG.radius, 8.05, world.boxes, 0)).toBe(8);
    expect(blockedAt(32, 356, DEFAULT_MOVE_CONFIG.radius, 8, 0, DEFAULT_MOVE_CONFIG.height, world.boxes)).toBe(false);
    expect(blockedAt(32, 356.8, DEFAULT_MOVE_CONFIG.radius, 8, 0, DEFAULT_MOVE_CONFIG.height, world.boxes)).toBe(true);
    expect(supportUnder(56, 370, DEFAULT_MOVE_CONFIG.radius, 8.05, world.boxes, 0)).toBe(8);
    expect(blockedAt(56, 374, DEFAULT_MOVE_CONFIG.radius, 8, 0, DEFAULT_MOVE_CONFIG.height, world.boxes)).toBe(true);
  });
});
