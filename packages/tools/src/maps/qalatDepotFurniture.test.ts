import { describe, expect, it } from 'vitest';
import { DEFAULT_MOVE_CONFIG, blockedAt, boxFrom, loadLevel, rayWorld, supportUnder } from '@sandline/shared';
import { buildDepotLevel } from './qalatDepot.ts';
import { buildDepotFurniture, depotDecorations } from './qalatDepotFurniture.ts';

// Independent §2.2/7.3 dimensions: x/z centre, east-west width,
// north-south depth and height. The builder/manifest are not the oracle.
const FIXTURES = [
  // Owner-approved 0.4 m northward move retains the full-size low crate
  // while leaving the centered west-door landing exactly x[-8,-4], z[94,98].
  ['B1-crate', -6, 98.4, 3, .8, 1.1],
  ['B2-sacks', -24, 116, .8, 4, 1.1], ['B2-crate', -14.3, 124, .6, 4, 2.2],
  ['B3-pier-0', -44, 152, 1.2, 1.2, 5.5], ['B3-pier-1', -28, 152, 1.2, 1.2, 5.5],
  ['B3-pier-2', -44, 168, 1.2, 1.2, 5.5], ['B3-pier-3', -28, 168, 1.2, 1.2, 5.5],
  ['B3-wall', -36, 164, 4, .8, 1.1],
  ['B4-engine-0', -24, 200, 3, 8, 2.2], ['B4-engine-1', -12, 200, 3, 8, 2.2],
  ['B5-bench', 3, 234, .8, 4, 1.1],
  ['B6-pier-0', 22, 258, 1.2, 1.2, 5.5], ['B6-pier-1', 38, 258, 1.2, 1.2, 5.5],
  ['B6-pier-2', 22, 270, 1.2, 1.2, 5.5], ['B6-pier-3', 38, 270, 1.2, 1.2, 5.5],
  ['B6-pier-4', 22, 282, 1.2, 1.2, 5.5], ['B6-pier-5', 38, 282, 1.2, 1.2, 5.5],
  ['B6-crate-west', 19, 265, 1.2, 4, 2.2], ['B6-crate-east', 41, 277, 1.2, 4, 2.2],
  ['B6-low-stack', 30, 276, 4, .8, 1.1], ['B7-bench', -22, 312, 1, 6, 1],
  ['B8-shelf-0', -22, 346, 1, 16, 2.2], ['B8-shelf-1', -6, 346, 1, 16, 2.2],
  ['B9-crate', -12, 367, 1.2, 3, 2.2],
] as const;
const furniture = buildDepotFurniture(), level = buildDepotLevel(), world = loadLevel(level);
const solids = furniture.map((b) => boxFrom(b, 'cover'));
type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
const overlaps = (a: Rect, b: Rect) => Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > 1e-7
  && Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > 1e-7;

function clearRect(label: string, rect: Rect, height = DEFAULT_MOVE_CONFIG.height) {
  const boxes = world.boxes.filter((b) => overlaps(rect, b));
  expect(boxes.filter((b) => b.maxY > .001 && b.minY < height - 1e-7).map((b) => b.id), `${label}: occupied clear rectangle`).toEqual([]);
  // Real actor radius is inset from each advertised clear boundary. This
  // tests both sides of each lane without treating a centreline as its width.
  const r = DEFAULT_MOVE_CONFIG.radius;
  for (const x of [rect.minX + r + .001, (rect.minX + rect.maxX) / 2, rect.maxX - r - .001])
    for (const z of [rect.minZ + r + .001, (rect.minZ + rect.maxZ) / 2, rect.maxZ - r - .001]) {
      expect(blockedAt(x, z, r, 0, .001, height, boxes), `${label}: standing actor ${x}/${z}`).toBe(false);
      expect(supportUnder(x, z, r, .01, boxes, -1), `${label}: missing continuous floor`).toBeCloseTo(0, 6);
    }
}

describe('U-172 fixed depot internals and measured clearances', () => {
  it('uses every independently specified fixed socket, axis and full-height pier', () => {
    expect(furniture).toHaveLength(FIXTURES.length);
    expect(new Set(furniture.map((b) => b.id)).size).toBe(furniture.length);
    for (const [id, x, z, w, d, h] of FIXTURES) {
      const box = furniture.find((b) => b.id === `depot-furniture-${id}`);
      expect(box, id).toEqual({ id: `depot-furniture-${id}`, x, y: 0, z, w, d, h });
    }
    // The crate may touch the landing's north boundary, but neither a size
    // trim nor a shifted landing is an alternative to the approved move.
    const moved = solids.find((b) => b.id === 'depot-furniture-B1-crate')!;
    expect(moved.minX).toBeCloseTo(-7.5, 8); expect(moved.maxX).toBeCloseTo(-4.5, 8);
    expect(moved.minZ).toBeCloseTo(98, 8); expect(moved.maxZ).toBeCloseTo(98.8, 8);
    expect(moved.maxY).toBeCloseTo(1.1, 8);
    expect(overlaps(moved, { minX: -8, maxX: -4, minZ: 94, maxZ: 98 })).toBe(false);
    // B2's one permitted asymmetric depth trim retains its east datum and
    // exactly 4 m of room between the crate and x=-10 inside east wall.
    const trimmed = solids.find((b) => b.id === 'depot-furniture-B2-crate')!;
    expect(trimmed.minX).toBeCloseTo(-14.6, 8); expect(trimmed.maxX).toBeCloseTo(-14, 8);
    expect(-10 - trimmed.maxX).toBeCloseTo(4, 8);
    expect(level.boxes.filter((b) => b.id.startsWith('depot-furniture-'))).toEqual(furniture);
  });

  it('keeps the entire four-by-four inside pad behind every connector and both stair portals free', () => {
    const doors = [
      [-8, 96, 'x', -1], [-20, 108, 'z', -1], [-30, 130, 'x', -1], [-36, 144, 'z', -1],
      [-36, 176, 'z', 1], [-28, 193 + 1 / 3, 'x', -1], [-8, 200 + 80 / 13, 'x', 1],
      [8, 224, 'z', -1], [8, 240, 'z', 1], [30, 252, 'z', -1], [30, 288, 'z', 1],
      [-14, 300, 'z', -1], [-14, 320, 'z', 1], [-14, 334, 'z', -1], [-9.5, 358, 'z', 1],
      [-8, 364, 'z', -1], [4, 96, 'x', 1], [-8, 376, 'z', 1],
    ] as const;
    for (const [x, z, axis, normal] of doors) {
      const cx = x - (axis === 'x' ? normal * 2 : 0), cz = z - (axis === 'z' ? normal * 2 : 0);
      clearRect(`door ${x}/${z}`, { minX: cx - 2, maxX: cx + 2, minZ: cz - 2, maxZ: cz + 2 }, 2.999);
    }
  });

  it('preserves all six-metre main lanes, four-metre bypasses and the B5/B7 regroup floor', () => {
    const lanes = [
      ['B1 door-to-stair band', -8, 4, 94, 98],
      ['B2 central', -23, -17, 108, 132], ['B2 east bypass', -14, -10, 108, 132],
      ['B2 west bypass', -30, -26, 108, 132],
      ['B3 central south', -39, -33, 144, 163.6], ['B3 central north', -39, -33, 164.4, 176],
      ['B3 west bypass', -42, -38, 144, 176], ['B3 east bypass', -34, -30, 144, 176],
      ['B4 central', -21, -15, 188, 212], ['B5 central', 5, 11, 224, 240],
      ['B5 regroup 8x8', 5, 13, 226, 234],
      ['B6 central south', 27, 33, 252, 275.6], ['B6 central north', 27, 33, 276.4, 288],
      ['B6 west aisle', 22.6, 26.6, 252, 288], ['B6 east aisle', 33.4, 37.4, 252, 288],
      ['B6 low-stack west bypass', 24, 28, 274, 278], ['B6 low-stack east bypass', 32, 36, 274, 278],
      ['B7 central', -17, -11, 300, 320], ['B7 empty central floor', -18, -10, 304, 316],
      ['B8 central', -17, -11, 334, 358],
      ['B9 central', -11, -5, 364, 376],
    ] as const;
    for (const [name, minX, maxX, minZ, maxZ] of lanes) clearRect(name, { minX, maxX, minZ, maxZ });
  });

  it('keeps the furnished rooms solidly roofed and every movable-height fixture separated from piers and ceilings', () => {
    const ceilingByRoom: Record<string, number> = { B1: 3.6, B2: 4.5, B3: 5.5, B4: 4.5, B5: 4, B6: 5.5, B7: 4, B8: 4, B9: 3.6 };
    const piers = solids.filter((b) => b.id.includes('-pier-'));
    for (const box of solids.filter((b) => !b.id.includes('-pier-'))) {
      const room = box.id.split('-')[2]!, ceiling = ceilingByRoom[room]!;
      const x = (box.minX + box.maxX) / 2, z = (box.minZ + box.maxZ) / 2;
      const roof = rayWorld({ origin: { x, y: box.maxY + .01, z }, direction: { x: 0, y: 1, z: 0 }, maxDistance: 10 }, world.boxes);
      expect(roof, `${box.id}: missing closed roof`).not.toBeNull();
      expect(roof!.distance, `${box.id}: roof intruded or opened`).toBeCloseTo(ceiling - box.maxY - .01, 6);
      expect(ceiling - box.maxY, `${box.id}: touches ceiling`).toBeGreaterThanOrEqual(1.4 - 1e-7);
      for (const pier of piers) {
        const dx = Math.max(0, pier.minX - box.maxX, box.minX - pier.maxX);
        const dz = Math.max(0, pier.minZ - box.maxZ, box.minZ - pier.maxZ);
        expect(Math.hypot(dx, dz), `${box.id}: bridge to ${pier.id}`).toBeGreaterThanOrEqual(1.8 - 1e-7);
      }
    }
  });

  it('includes the blue pipe, dry cistern, sealed service doors, west racks and upward arrow as visual cues', () => {
    const decor = depotDecorations(), ids = decor.map((b) => b.id);
    for (const name of ['B1-blue-pipe', 'B3-dry-channel-0', 'B3-dry-channel-1', 'B3-water-stain-0',
      'B3-water-stain-1', 'B3-water-stain-2', 'B5-sealed-service-door-0', 'B5-sealed-service-door-1',
      'B7-wall-rack-0', 'B7-wall-rack-1', 'B9-up-arrow-shaft', 'B9-up-arrow-head-0',
      'B9-up-arrow-head-1', 'B9-up-arrow-head-2', 'B9-up-arrow-head-3'])
      expect(ids, name).toContain(`depot-decor-${name}`);
    expect(world.boxes.some((b) => b.id.startsWith('depot-decor-'))).toBe(false);
    for (const door of decor.filter((b) => b.id.includes('sealed-service-door'))) {
      expect(door.x).toBeGreaterThanOrEqual(15.9);
      expect(blockedAt(16.3, door.z, .001, 0, .001, DEFAULT_MOVE_CONFIG.height, world.boxes)).toBe(true);
    }
    for (const rack of decor.filter((b) => b.id.includes('wall-rack'))) expect(rack.x).toBeLessThanOrEqual(-23.8);
    for (const channel of decor.filter((b) => b.id.includes('dry-channel'))) expect(channel.y + channel.h).toBeLessThan(.01);
  });
});
