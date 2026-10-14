import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { blockedAt, boxFrom, rayWorld, supportUnder } from '@sandline/shared';
import { buildDepotLevel, buildDepotShell, depotManifest, depotDoors } from './qalatDepot.ts';
import { buildRoadSupportLevel } from './qalatRoadSupports.ts';

// Independent §7.2 inside bounds and heights. These are acceptance dimensions,
// never inferred from the author's room helper or generated manifest.
const ROOMS = [
  ['B1', -2, 96, 12, 12, 3.6], ['B2', -20, 120, 20, 24, 4.5], ['B3', -36, 160, 24, 32, 5.5],
  ['B4', -18, 200, 20, 24, 4.5], ['B5', 8, 232, 16, 16, 4], ['B6', 30, 270, 28, 36, 5.5],
  ['B7', -14, 310, 20, 20, 4], ['B8', -14, 346, 20, 24, 4], ['B9', -8, 370, 12, 12, 3.6],
] as const;
const shell = buildDepotShell().map((b) => boxFrom(b, 'cover'));
const up = (x: number, z: number, boxes = shell) => rayWorld({ origin: { x, y: 1.6, z },
  direction: { x: 0, y: 1, z: 0 }, maxDistance: 20 }, boxes)?.distance;

describe('U-170 exact enclosed depot shells', () => {
  it('keeps every square metre of each listed room clear, floored and continuously roofed to y8', () => {
    let samples = 0;
    for (const [id, x, z, w, d, ceiling] of ROOMS) {
      for (let px = x - w / 2 + .1; px < x + w / 2; px += .8)
        for (let pz = z - d / 2 + .1; pz < z + d / 2; pz += .8) {
          const local = shell.filter((b) => px >= b.minX && px <= b.maxX && pz >= b.minZ && pz <= b.maxZ);
          expect(blockedAt(px, pz, .001, 0, 0, ceiling - .001, local), `${id} room filled at ${px}/${pz}`).toBe(false);
          expect(supportUnder(px, pz, .001, .01, local, -1), `${id} floor`).toBeCloseTo(0, 8);
          expect(up(px, pz, local), `${id} ceiling`).toBeCloseTo(ceiling - 1.6, 6);
          expect(local.some((b) => b.minY <= ceiling + 1e-6 && b.maxY === 8), `${id} missing solid earth`).toBe(true);
          samples++;
        }
    }
    expect(samples).toBeGreaterThan(6_000);
  }, 120_000);

  it('has exact four-metre wall portals, three-metre lintels and free four-by-four inside landings', () => {
    // §7.2 wall intersections, including the near-corner B2 west door.
    const expected = [
      ['B1', -8, 96, 'x', -1], ['B2', -20, 108, 'z', -1],
      ['B2', -30, 130, 'x', -1], ['B3', -36, 144, 'z', -1],
      ['B3', -36, 176, 'z', 1], ['B4', -28, 193 + 1 / 3, 'x', -1],
      ['B4', -8, 200 + 80 / 13, 'x', 1], ['B5', 8, 224, 'z', -1],
      ['B5', 8, 240, 'z', 1], ['B6', 30, 252, 'z', -1],
      ['B6', 30, 288, 'z', 1], ['B7', -14, 300, 'z', -1],
      ['B7', -14, 320, 'z', 1], ['B8', -14, 334, 'z', -1],
      ['B8', -9.5, 358, 'z', 1], ['B9', -8, 364, 'z', -1],
    ] as const;
    expect(depotDoors()).toHaveLength(expected.length);
    for (const [i, [id, x, z, axis, normal]] of expected.entries()) {
      const door = depotDoors()[i]!;
      expect(door.room).toBe(id); expect(door.axis).toBe(axis); expect(door.normal).toBe(normal);
      expect(door.x).toBeCloseTo(x, 8); expect(door.z).toBeCloseTo(z, 8);
      for (const offset of [-1.99, 0, 1.99]) {
        const px = x + (axis === 'x' ? .3 * normal : offset), pz = z + (axis === 'z' ? .3 * normal : offset);
        expect(blockedAt(px, pz, .001, 0, 0, 2.999, shell), `${id} portal ${offset}`).toBe(false);
        expect(up(px, pz), `${id} lintel`).toBeCloseTo(1.4, 6);
      }
      for (const depth of [.01, 1, 2, 3.99]) for (const side of [-1.99, 0, 1.99]) {
        const px = x + (axis === 'x' ? -normal * depth : side), pz = z + (axis === 'z' ? -normal * depth : side);
        expect(blockedAt(px, pz, .001, 0, 0, 2.99, shell), `${id} inside landing`).toBe(false);
      }
    }
    // Parallel corridors must not turn the B6/B7 room walls into extra doors.
    for (const [x0, x1, z, doorX] of [[16, 44, 251.7, 30], [-24, -4, 299.7, -14]])
      for (let x = x0! + .1; x < x1!; x += .4)
        if (Math.abs(x - doorX!) > 2.05) expect(blockedAt(x, z!, .001, 0, 0, 1.8, shell)).toBe(true);
    for (const [x0, x1, z0] of [[16, 28, 247.4], [-12, -4, 295.4]])
      for (let x = x0! + .1; x < x1!; x += .4) for (let z = z0! + .01; z < z0! + 4; z += .2)
        expect(blockedAt(x, z, .001, 0, 0, 3.199, shell), `four-metre parallel corridor at ${x}/${z}`).toBe(false);
  });

  it('seals future stairs explicitly and retains outward masonry and roof ray obstruction', () => {
    expect(shell.filter((b) => b.id.startsWith('depot-cap-')).map((b) => b.id)).toEqual(['depot-cap-B1-stair', 'depot-cap-B9-stair']);
    for (const [x, z] of [[4.3, 96], [-8, 376.3], [-48.3, 160], [25, 251.7]])
      expect(blockedAt(x!, z!, .001, 0, 0, 1.8, shell), `unsealed ${x}/${z}`).toBe(true);
    // The west B2 door stops at its corner; north masonry remains intact.
    expect(blockedAt(-30.3, 132.3, .001, 0, 0, 1.8, shell)).toBe(true);
    expect(up(30, 270)).toBeCloseTo(3.9, 6);
    expect(up(30, 270, shell.filter((b) => !b.id.startsWith('depot-roof-')))).toBeUndefined();
  }, 120_000);

  it('keeps the listed flat connector turns underground at the 3.2 m corridor ceiling', () => {
    for (const [x, z] of [[-14, 96], [-20, 104], [-36, 136], [-36, 140], [-36, 182],
      [-32, 190 + 2 / 3], [0, 211 + 1 / 13], [8, 216], [8, 220], [8, 246], [8, 250],
      [18, 250], [30, 250], [30, 294], [30, 298], [0, 298], [-14, 298], [-14, 326], [-14, 330], [-8, 362]]) {
      expect(blockedAt(x!, z!, .35, 0, 0, 3.199, shell), `${x}/${z} clear corridor`).toBe(false);
      expect(up(x!, z!), `${x}/${z} corridor roof`).toBeCloseTo(1.6, 6);
    }
  });

  it('adds only underground construction, preserves the exact complete surface and fresh evidence', async () => {
    const level = buildDepotLevel(), surface = buildRoadSupportLevel();
    expect(level.boxes.slice(0, surface.boxes.length)).toEqual(surface.boxes);
    expect(level.boxes.slice(surface.boxes.length).every((b) => b.y + b.h <= 8)).toBe(true);
    const output = new URL('../../../../artifacts/qalat-depot/', import.meta.url);
    expect(JSON.parse(await readFile(new URL('construction.json', output), 'utf8'))).toEqual(depotManifest());
    const captures = JSON.parse(await readFile(new URL('captures.json', output), 'utf8')) as {
      levelHash: string; views: { calls: number; renderedCeilingY: number }[];
    };
    expect(captures.levelHash).toBe(depotManifest().levelHash);
    expect(captures.views).toHaveLength(10);
    expect(captures.views.every((v) => v.calls < 300 && v.renderedCeilingY >= 3.59999)).toBe(true);
  }, 120_000);
});
