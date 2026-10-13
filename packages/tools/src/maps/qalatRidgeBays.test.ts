import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, DEFAULT_MUZZLE_RIG, TICK_SECONDS, blockedAt, createMoveState, rayWorld, stepCharacter, supportUnder,
  type WorldBox,
} from '@sandline/shared';
import { between, rayOccluded } from './insertionScreening.ts';
import { buildRoadSupportWorld } from './qalatRoadSupports.ts';
import { VIEW_FANS } from './qalatRoadTerrain.ts';

type Point = { x: number; z: number };
// Independent §6.2 transcription. Feet anchors, targets (feet y8; §11.1's X5
// turret top y11.2) and U-167's V3 lip strata [minZ, maxZ, lip, canopy].
const BAYS = [
  { id: 'V1', x: 58, y: 20, z: 128, targets: [{ x: -4, y: 8, z: 126 }, { x: 24, y: 8, z: 138 }], strata: [[124, 132, 1, 1.7]] },
  { id: 'V2', x: 88, y: 30, z: 210, targets: [{ x: -22, y: 8, z: 222 }, { x: 26, y: 8, z: 232 }], strata: [[206, 214, 1, 1.7]] },
  { id: 'V3', x: 66, y: 26, z: 286, targets: [{ x: -18, y: 8, z: 302 }, { x: 16, y: 8, z: 332 }, { x: 38, y: 8, z: 360 }, { x: 54, y: 11.2, z: 334 }],
    strata: [[282, 287, 1, 1.7], [287, 288.15, .75, 1.45], [288.15, 290, .25, .95]] },
] as const;
const LIP_DEPTH = .25, CANOPY_HIGH = 3, OPENING = .7;
const A4_NEST = { x: -22, z: 222 }, A2 = { x: 12, z: 128 };
const F3 = { minX: 66, maxX: 72, minZ: 260, maxZ: 274, top: 36 };
// §8.1 courtyard, plus the future outpost envelope whose interior rock U-116 replaces.
const COURTYARD = { minX: 8, maxX: 56, minZ: 356, maxZ: 412 };
const OUTPOST = { minX: 7, maxX: 57, minZ: 355, maxZ: 413 };

const world = buildRoadSupportWorld();
const temporary = (b: WorldBox) => b.id.startsWith('road-cap-') || b.id.startsWith('ridge-cap-');
const permanent = world.boxes.filter((b) => !temporary(b));
const near = (p: Point, r: number) => world.boxes.filter((b) => b.maxX > p.x - r && b.minX < p.x + r && b.maxZ > p.z - r && b.minZ < p.z + r);
const column = (p: Point) => world.boxes.filter((b) => p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ);
const floors = world.boxes.filter((b) => /^ridge-(floor|slab)/.test(b.id));
const yaw = (x: number, z: number) => Math.round(Math.atan2(x, z) / (2 * Math.PI) * 1024 + 1024) % 1024;
const eyeOf = (b: typeof BAYS[number]) => ({ x: b.x, y: b.y + DEFAULT_MUZZLE_RIG.eyeHeight, z: b.z });

/** Rock outside the §8.1 envelope only: the outpost replaces its interior. */
function outsideOutpost(boxes: readonly WorldBox[]): WorldBox[] {
  return boxes.flatMap((box) => {
    const minX = Math.max(box.minX, OUTPOST.minX), maxX = Math.min(box.maxX, OUTPOST.maxX);
    const minZ = Math.max(box.minZ, OUTPOST.minZ), maxZ = Math.min(box.maxZ, OUTPOST.maxZ);
    if (minX >= maxX || minZ >= maxZ) return [box];
    return [
      { ...box, maxX: minX }, { ...box, minX: maxX },
      { ...box, minX, maxX, maxZ: minZ }, { ...box, minX, maxX, minZ: maxZ },
    ].filter((b) => b.maxX > b.minX && b.maxZ > b.minZ);
  });
}

describe('U-167 V1–V3 support bays', () => {
  it('opens all three bay caps into exact supported floors, lips, canopies and side returns', () => {
    expect(world.boxes.some((b) => /^ridge-cap-V\d-bay/.test(b.id))).toBe(false);
    expect(DEFAULT_MOVE_CONFIG.proneHeight).toBeGreaterThan(OPENING);
    let probes = 0;
    for (const bay of BAYS) {
      const west = bay.x - .8;
      // The full 8×8 m floor is supported at the node's y, lip strip included.
      for (let x = west + .01; x <= bay.x + 7.2 - .01; x += .2) for (let z = bay.z - 4 + .01; z <= bay.z + 4 - .01; z += .5) {
        expect(supportUnder(x, z, .001, bay.y + .01, floors, 0), `${bay.id} floor ${x}/${z}`).toBeCloseTo(bay.y, 9);
        probes++;
      }
      for (const [minZ, maxZ, lip, canopy] of bay.strata) {
        expect(canopy - lip).toBeCloseTo(OPENING, 9);
        for (let x = west + .02; x < west + LIP_DEPTH; x += .05) for (let z = minZ + .02; z < maxZ; z += .25) {
          const boxes = column({ x, z });
          // Solid lip from the floor, a wholly open band, then the canopy.
          expect(Math.max(...boxes.filter((b) => b.minY <= bay.y + 1e-6).map((b) => b.maxY)), `${bay.id} lip ${x}/${z}`).toBeCloseTo(bay.y + lip, 9);
          expect(boxes.filter((b) => b.minY < bay.y + canopy - 1e-6 && b.maxY > bay.y + lip + 1e-6), `${bay.id} opening ${x}/${z}`).toEqual([]);
          expect(Math.min(...boxes.filter((b) => b.minY > bay.y + lip).map((b) => b.minY)), `${bay.id} canopy ${x}/${z}`).toBeCloseTo(bay.y + canopy, 9);
          probes++;
        }
      }
      // Behind the strip the canopy rises to 3 m; standing clearance remains.
      for (let x = west + LIP_DEPTH + .02; x < bay.x; x += .1) for (let z = bay.z - 4 + .02; z < bay.z + 4; z += .5) {
        const above = column({ x, z }).filter((b) => b.maxY > bay.y + 1e-6);
        expect(Math.min(...above.map((b) => b.minY)), `${bay.id} high canopy ${x}/${z}`).toBeCloseTo(bay.y + CANOPY_HIGH, 9);
        probes++;
      }
      // A standing soldier fits everywhere behind the lip, anchor included.
      for (let z = bay.z - 4 + .35; z <= bay.z + 4 - .35; z += .25) for (const x of [west + LIP_DEPTH + .35, bay.x, bay.x + 3.6]) {
        const boxes = near({ x, z }, 2);
        expect(supportUnder(x, z, .35, bay.y + .01, boxes, 0), `${bay.id} support ${x}/${z}`).toBeCloseTo(bay.y, 9);
        expect(blockedAt(x, z, .35, bay.y, 0, DEFAULT_MOVE_CONFIG.height, boxes), `${bay.id} standing ${x}/${z}`).toBe(false);
        probes++;
      }
      // Full-height side returns close both ends of the strip west of the landing.
      for (const z of [bay.z - 4.5, bay.z + 4.5]) for (let x = west + .05; x < bay.x; x += .1) {
        expect(blockedAt(x, z, .001, bay.y, 0, CANOPY_HIGH + .5, near({ x, z }, 1)), `${bay.id} return ${x}/${z}`).toBe(true);
        probes++;
      }
      // No stance fits on any lip top.
      for (const [minZ, maxZ, lip] of bay.strata) for (const h of [DEFAULT_MOVE_CONFIG.height, DEFAULT_MOVE_CONFIG.crouchHeight, DEFAULT_MOVE_CONFIG.proneHeight])
        expect(blockedAt(west + LIP_DEPTH / 2, (minZ + maxZ) / 2, .1, bay.y + lip, 0, h, near({ x: west, z: minZ }, 2)), `${bay.id} lip top body ${h}`).toBe(true);
    }
    console.log('U-167 bay construction', JSON.stringify({ probes, openingM: OPENING, proneHeightM: DEFAULT_MOVE_CONFIG.proneHeight }));
  });

  it('reaches every listed target from each anchor’s actual standing eye over the whole permanent scene', () => {
    const report: Record<string, unknown>[] = [];
    // The independent list matches the generator's fans (V3 and its X5 fan share an anchor).
    expect(VIEW_FANS.flatMap((f) => f.rays.map((r) => [f.eye.x, f.eye.z, r.to.x, r.to.y, r.to.z])).sort())
      .toEqual(BAYS.flatMap((b) => b.targets.map((t) => [b.x, b.z, t.x, t.y, t.z])).sort());
    for (const bay of BAYS) for (const t of bay.targets) {
      const eye = eyeOf(bay), length = Math.hypot(t.x - eye.x, t.y - eye.y, t.z - eye.z);
      // Stop 1 m short: the target's own cover piece and floor end the ray.
      const ray = { ...between(eye, t), maxDistance: length - 1 };
      expect(rayWorld(ray, permanent), `${bay.id} → ${JSON.stringify(t)}`).toBeNull();
      report.push({ bay: bay.id, target: t, lengthM: +length.toFixed(2) });
    }
    console.log('U-167 bay target rays', JSON.stringify(report));
  });

  it('keeps the blind spots: F1 hides A4 from V1, F2 hides A2 from V2, F3 the compound from V2', () => {
    const [v1, v2, v3] = BAYS;
    const blocked = rayOccluded(outsideOutpost(permanent));
    for (const h of [.05, DEFAULT_MUZZLE_RIG.eyeHeight, DEFAULT_MOVE_CONFIG.height]) {
      expect(blocked(between(eyeOf(v1), { ...A4_NEST, y: 8 + h })), `V1 sees A4 at ${h}`).toBe(true);
      expect(blocked(between(eyeOf(v2), { ...A2, y: 8 + h })), `V2 sees A2 at ${h}`).toBe(true);
    }
    // F3 is solid to y36 over its whole footprint and outside every fan.
    for (let x = F3.minX + .1; x < F3.maxX; x += .5) for (let z = F3.minZ + .1; z < F3.maxZ; z += .5)
      expect(Math.max(...column({ x, z }).map((b) => b.maxY)), `F3 at ${x}/${z}`).toBe(F3.top);
    for (const fan of VIEW_FANS) expect(fan.hull.some((p) => p.x > F3.minX && p.x < F3.maxX && p.z > F3.minZ && p.z < F3.maxZ)).toBe(false);
    // Every compound sample is hidden from V2; F3 alone stops each ray that crosses it.
    let rays = 0, throughF3 = 0;
    for (let x = COURTYARD.minX; x <= COURTYARD.maxX; x += 2) for (let z = COURTYARD.minZ; z <= COURTYARD.maxZ; z += 2)
      for (const h of [.05, DEFAULT_MUZZLE_RIG.eyeHeight, DEFAULT_MOVE_CONFIG.height]) {
        const eye = eyeOf(v2), to = { x, y: 8 + h, z };
        expect(blocked(between(eye, to)), `V2 sees the compound at ${JSON.stringify(to)}`).toBe(true);
        rays++;
        const t = (zz: number) => (zz - eye.z) / (to.z - eye.z), xAt = (zz: number) => eye.x + (to.x - eye.x) * t(zz);
        const [lo, hi] = [xAt(F3.minZ), xAt(F3.maxZ)].sort((a, b) => a - b);
        if (hi < F3.minX || lo > F3.maxX) continue;
        expect(eye.y + (to.y - eye.y) * t(F3.minZ)).toBeLessThan(F3.top);
        throughF3++;
      }
    expect(throughF3).toBeGreaterThan(100);
    console.log('U-167 blind spots', JSON.stringify({ compoundRays: rays, crossingF3: throughF3,
      v3: 'prisoner/radio rooms, west service gate and basement are screened by U-116 outpost walls and U-115 roofs; V3 anchor', anchor: v3!.id }));
  }, 60_000);

  it('rejects walking, sprint-jumping, crouching and crawling over every lip and side return', () => {
    let attempts = 0;
    for (const bay of BAYS) {
      const west = bay.x - .8, boxes = near({ x: bay.x, z: bay.z }, 14);
      const starts: { from: Point; out: Point }[] = [];
      for (let z = bay.z - 3.5; z <= bay.z + 3.5; z += 1) for (const out of [{ x: -1, z: 0 }, { x: -1, z: -1 }, { x: -1, z: 1 }])
        starts.push({ from: { x: west + LIP_DEPTH + .4, z }, out });
      for (let x = west + .4; x <= bay.x + .4; x += .4) for (const dz of [-1, 1])
        starts.push({ from: { x, z: bay.z + dz * 3.6 }, out: { x: -.3, z: dz } });
      for (const { from, out } of starts) for (const stance of ['walk', 'jump', 'crouch', 'prone']) {
        let state = { ...createMoveState(from.x, bay.y, from.z), grounded: true };
        const input = { moveX: 0, moveY: 1, yaw: yaw(out.x, out.z), sprint: stance !== 'walk', jump: stance === 'jump', crouch: stance === 'crouch', prone: stance === 'prone' };
        for (let tick = 0; tick < 60; tick++) state = stepCharacter(state, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG, boxes);
        for (let tick = 0; tick < 30; tick++) state = stepCharacter(state, { ...input, moveY: 0, jump: false }, TICK_SECONDS, DEFAULT_MOVE_CONFIG, boxes);
        const where = `${bay.id} ${stance} from ${JSON.stringify(from)} toward ${JSON.stringify(out)}: ${JSON.stringify(state)}`;
        expect(state.vault, where).toBeNull();
        expect(state.grounded, where).toBe(true);
        expect(state.y, where).toBeCloseTo(bay.y, 6);
        // Still on the bay or its landing: east of the lip, inside the bay's ends.
        expect(state.x - DEFAULT_MOVE_CONFIG.radius, where).toBeGreaterThanOrEqual(west + LIP_DEPTH - 1e-6);
        if (state.x < bay.x) expect(Math.abs(state.z - bay.z), where).toBeLessThanOrEqual(4 - DEFAULT_MOVE_CONFIG.radius + 1e-6);
        attempts++;
      }
    }
    expect(attempts).toBeGreaterThan(500);
    console.log('U-167 bay escape attempts', JSON.stringify({ attempts, stances: ['walk', 'sprint-jump', 'crouch', 'prone'], ticks: 90 }));
  }, 120_000);
});
