import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, DEFAULT_MUZZLE_RIG, blockedAt, supportUnder, type WorldBox,
} from '@sandline/shared';
import { between, rayOccluded } from './insertionScreening.ts';
import { ROAD_COMBAT, combatAxis, combatOpenFloors } from './qalatRoadCombat.ts';
import {
  ROAD_SUPPORTS, buildRoadSupportWorld, onRoadSupportFloor, roadSupportFloors,
} from './qalatRoadSupports.ts';

const EYE_STEP_M = 1, TARGET_STEP_M = .5, CELL_M = 2;
const { radius, height } = DEFAULT_MOVE_CONFIG;
const world = buildRoadSupportWorld();
const grid = new Map<string, WorldBox[]>();
for (const box of world.boxes) {
  for (let x = Math.floor(box.minX / CELL_M); x <= Math.floor(box.maxX / CELL_M); x++) {
    for (let z = Math.floor(box.minZ / CELL_M); z <= Math.floor(box.maxZ / CELL_M); z++) {
      const key = `${x},${z}`, list = grid.get(key);
      if (list) list.push(box); else grid.set(key, [box]);
    }
  }
}

function standingBoxes(x: number, z: number): WorldBox[] {
  const boxes = new Set<WorldBox>();
  for (let a = Math.floor((x - radius) / CELL_M); a <= Math.floor((x + radius) / CELL_M); a++) {
    for (let b = Math.floor((z - radius) / CELL_M); b <= Math.floor((z + radius) / CELL_M); b++) {
      for (const box of grid.get(`${a},${b}`) ?? []) boxes.add(box);
    }
  }
  return [...boxes];
}

/** Inclusive local-axis grid: the boundary rows contain every rectangle
 * vertex, and adjacent samples are never farther apart than the stated step.
 */
function samples(halfExtent: number): number[] {
  const count = Math.ceil(2 * halfExtent / TARGET_STEP_M);
  return Array.from({ length: count + 1 }, (_, i) => -halfExtent + 2 * halfExtent * i / count);
}

describe('U-161 elevated low-cover target regression', () => {
  it('blocks every sampled lane over 90 m from a clear road standing eye to a low-cover head', async () => {
    const lowCover = ROAD_COMBAT.cover.filter((cover) => cover.height < 2.2);
    expect(lowCover).toHaveLength(6);
    // A character may partially overhang a cover top. Project the shared
    // axis-aligned square footprint onto the cover's local axes to bound all
    // such centres, including rotated corners.
    // Every target uses the highest low-cover head, a conservative height for
    // these six platforms. This is dense 3D regression evidence, not a claim
    // that finite samples prove every continuous elevated ray.
    const targetY = Math.max(...lowCover.map((cover) => cover.y + cover.height)) + height;
    const targets = lowCover.flatMap((cover) => {
      const axis = combatAxis(cover);
      const localExpansion = radius * (Math.abs(axis.x) + Math.abs(axis.z));
      return samples(cover.length / 2 + localExpansion).flatMap((along) =>
        samples(cover.depth / 2 + localExpansion).map((across) => ({
          cover: cover.id,
          x: cover.x + axis.x * along - axis.z * across,
          y: targetY,
          z: cover.z + axis.z * along + axis.x * across,
        })));
    });
    expect(targetY).toBeGreaterThan(ROAD_SUPPORTS.floorY + height);
    expect(targets.length).toBeGreaterThan(300);

    const blocked = rayOccluded(world.boxes.filter((box) => box.maxY > ROAD_SUPPORTS.floorY));
    const floorVertices = [...roadSupportFloors(), ...combatOpenFloors()].flat();
    const minX = Math.floor(Math.min(...floorVertices.map((point) => point.x)));
    const maxX = Math.ceil(Math.max(...floorVertices.map((point) => point.x)));
    const minZ = Math.floor(Math.min(...floorVertices.map((point) => point.z)));
    const maxZ = Math.ceil(Math.max(...floorVertices.map((point) => point.z)));
    let eyes = 0, rays = 0, clearRays = 0;
    let longestClear: { lengthM: number; eye: { x: number; y: number; z: number }; target: typeof targets[number] } | undefined;
    for (let x = minX; x <= maxX; x += EYE_STEP_M) {
      for (let z = minZ; z <= maxZ; z += EYE_STEP_M) {
        if (!onRoadSupportFloor({ x, z })) continue;
        const boxes = standingBoxes(x, z), floorY = ROAD_SUPPORTS.floorY;
        if (blockedAt(x, z, radius, floorY, 0, height, boxes) ||
          supportUnder(x, z, radius, floorY + .05, boxes, 0) !== floorY) continue;
        const eye = { x, y: floorY + DEFAULT_MUZZLE_RIG.eyeHeight, z };
        eyes++;
        for (const target of targets) {
          const ray = between(eye, target);
          if (ray.maxDistance <= ROAD_SUPPORTS.sightLines.maxLaneViewM) continue;
          rays++;
          if (!blocked(ray)) {
            clearRays++;
            if (!longestClear || ray.maxDistance > longestClear.lengthM) {
              longestClear = { lengthM: ray.maxDistance, eye, target };
            }
          }
        }
      }
      // Let Vitest flush worker progress during the dense geometric check.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(eyes).toBeGreaterThan(5_000);
    expect(rays).toBeGreaterThan(1_000_000);
    console.log('U-161 elevated target samples', JSON.stringify({
      eyes, targets: targets.length, rays, clearRays, eyeGridM: EYE_STEP_M, targetAxisGridMaxM: TARGET_STEP_M,
      targetFootprintSquareHalfSizeM: radius, eyeY: ROAD_SUPPORTS.floorY + DEFAULT_MUZZLE_RIG.eyeHeight,
      targetHeadY: targetY, method: 'sampled actual-scene 3D rays; continuous ground-eye proof is separate',
    }));
    expect(clearRays, `elevated lanes over 90 m; longest ${JSON.stringify(longestClear)}`).toBe(0);
  }, 180_000);
});
