import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG as config, TICK_SECONDS, blockedAt, boxFrom, createMoveState, loadLevel,
  rayWorld, stepCharacter, supportUnder, type WorldBox,
} from '@sandline/shared';
import { OUTPOST, buildOutpostLevel } from './qalatOutpost.ts';
import { buildOutpostFurniture, outpostDecorations } from './qalatOutpostFurniture.ts';

// Independent §2.2/8.2 dimensions: neither authoring data nor the generated
// manifest can redefine these centres, axes, heights or tower bounds.
// U-180 moved O-C01 west into the south throat for V3's gun line.
const FIXTURES = [
  ['outpost-furniture-O-C01', 29, 8, 359, 6, .8, 1.1],
  ['outpost-furniture-O-C02', 30, 8, 376, 1.2, 4, 2.2],
  ['outpost-furniture-O-C03', 40, 8, 385, 5, 1.8, 1.1],
  ['outpost-furniture-O-C04', 32, 8, 400, 1.2, 4, 2.2],
  ['outpost-furniture-radio-table', 52, 8, 404, 2, 1, 1],
  ['outpost-tower-leg-0-0', 46.3, 8, 414.3, .6, .6, 14],
  ['outpost-tower-leg-0-1', 46.3, 8, 419.7, .6, .6, 14],
  ['outpost-tower-leg-1-0', 51.7, 8, 414.3, .6, .6, 14],
  ['outpost-tower-leg-1-1', 51.7, 8, 419.7, .6, .6, 14],
  ['outpost-tower-tank', 49, 22, 417, 6, 6, 4],
] as const;
const HOLDING = [['mission-pow', 16, 402], ['carry-1', 12, 400], ['carry-2', 20, 400],
  ['carry-3', 12, 404], ['carry-4', 20, 404], ['carry-5', 12, 408]] as const;
const furniture = buildOutpostFurniture(), level = buildOutpostLevel(), world = loadLevel(level);
type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
const overlaps = (a: Rect, b: Rect) => Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > 1e-7
  && Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > 1e-7;
function clearRect(label: string, minX: number, maxX: number, minZ: number, maxZ: number) {
  const rect = { minX, maxX, minZ, maxZ }, boxes = world.boxes.filter((b) => overlaps(rect, b));
  expect(boxes.filter((b) => b.maxY > 8.000001 && b.minY < 10.999999).map((b) => b.id), `${label}: full clear volume`).toEqual([]);
  for (const x of [minX + config.radius + .001, (minX + maxX) / 2, maxX - config.radius - .001])
    for (const z of [minZ + config.radius + .001, (minZ + maxZ) / 2, maxZ - config.radius - .001]) {
      expect(blockedAt(x, z, config.radius, 8, .001, config.height, boxes), `${label}: body ${x}/${z}`).toBe(false);
      expect(supportUnder(x, z, config.radius, 8.01, boxes, -100), `${label}: real floor`).toBeCloseTo(8, 6);
    }
}

describe('U-179 independent fixed outpost furnishings and physical clearances', () => {
  it('constructs every specified cover/table and the exact four-leg y26 tower without an added platform', () => {
    expect(furniture).toHaveLength(FIXTURES.length);
    expect(new Set(furniture.map((b) => b.id)).size).toBe(furniture.length);
    for (const [id, x, y, z, w, d, h] of FIXTURES)
      expect(furniture.find((b) => b.id === id), id).toEqual({ id, x, y, z, w, d, h });
    expect(level.boxes.filter((b) => furniture.some((f) => f.id === b.id))).toEqual(furniture);
    const tower = furniture.filter((b) => b.id.startsWith('outpost-tower-')).map((b) => boxFrom(b, 'cover'));
    expect(tower).toHaveLength(5);
    expect(Math.min(...tower.map((b) => b.minX))).toBeCloseTo(46, 8);
    expect(Math.max(...tower.map((b) => b.maxX))).toBeCloseTo(52, 8);
    expect(Math.min(...tower.map((b) => b.minZ))).toBeCloseTo(414, 8);
    expect(Math.max(...tower.map((b) => b.maxZ))).toBeCloseTo(420, 8);
    expect(Math.max(...tower.map((b) => b.maxY))).toBe(26);
    // Clearing the inherited mountain is essential: a correct-looking tower
    // buried in its former y26 terrain would still create a firing platform.
    const pocket = { minX: 46, maxX: 52, minZ: 413, maxZ: 420 };
    expect(world.boxes.filter((b) => overlaps(pocket, b) && b.maxY > 8.000001).map((b) => b.id).sort())
      .toEqual(tower.map((b) => b.id).sort());
    for (let x = 46.1; x < 52; x += .4) for (let z = 413.1; z < 420; z += .4)
      expect(supportUnder(x, z, .001, 8.01, world.boxes, -100), `tower pit floor ${x}/${z}`).toBeCloseTo(8, 6);
    // The water-tower capture uses this real supported court eye. Its
    // landmark ray must meet the visible tank rather than hidden terrain.
    expect(blockedAt(36, 385, config.radius, 8, .05, config.height, world.boxes), 'court capture feet').toBe(false);
    expect(supportUnder(36, 385, config.radius, 8.01, world.boxes, -100), 'court capture floor').toBeCloseTo(8, 6);
    const origin = { x: 36, y: 9.55, z: 385 }, delta = { x: 13, y: 14.45, z: 32 };
    const length = Math.hypot(delta.x, delta.y, delta.z);
    expect(rayWorld({ origin, direction: { x: delta.x / length, y: delta.y / length, z: delta.z / length },
      maxDistance: length }, world.boxes)?.box.id).toBe('outpost-tower-tank');
  });

  it('preserves independent four-metre circulation rectangles and all room-door inside landings', () => {
    const lanes = [
      ['south gate east of the gun line', 32, 36, 356, 372], ['court corridor below refuge', 8, 28, 371.4, 375.4],
      ['east gate to court', 32, 56, 372, 376], ['east turning pad', 57, 61, 370, 376],
      ['trough west bypass', 24, 28, 372, 390], ['trough east bypass', 32, 36, 372, 390],
      ['cart west bypass', 33.5, 37.5, 382, 389.4], ['cart east bypass', 42.5, 46.5, 380, 389.4],
      ['north crate west bypass', 26, 30, 390, 406], ['north crate east bypass', 34, 38, 390, 406],
      ['north gate approach', 28, 36, 406, 412], ['radio door approach', 38, 42, 394, 398],
      ['barracks inside', 18, 22, 366, 370], ['barracks outside', 18, 22, 370.6, 374.6],
      ['refuge inside', 18, 22, 378, 382], ['refuge outside', 22.6, 26.6, 378, 382],
      ['antechamber inside', 18, 22, 390, 394], ['antechamber outside', 22.6, 26.6, 390, 394],
      ['cell inside', 14, 18, 396, 400], ['cell antechamber side', 14, 18, 391.4, 395.4],
      ['radio inside', 42, 46, 394, 398], ['reserve inside', 30, 34, 434, 438],
      ['reserve outside', 30, 34, 429.4, 433.4],
    ] as const;
    for (const [label, x0, x1, z0, z1] of lanes) {
      expect(x1 - x0, `${label}: advertised width`).toBeGreaterThanOrEqual(4 - 1e-7);
      expect(z1 - z0, `${label}: advertised depth`).toBeGreaterThanOrEqual(4 - 1e-7);
      clearRect(label, x0, x1, z0, z1);
    }
  });

  it('retains all six independently fixed holding positions and their full four-by-four rescue landing', () => {
    expect(OUTPOST.holding.capacity).toBe(6);
    expect(OUTPOST.holding.positions.map(({ id, x, y, z }) => [id, x, y, z]))
      .toEqual(HOLDING.map(([id, x, z]) => [id, x, 8, z]));
    clearRect('cell rescue landing', 14, 18, 396, 400);
    for (const [index, [id, x, z]] of HOLDING.entries()) {
      expect(blockedAt(x, z, config.radius, 8, .05, config.height, world.boxes), `${id}: standing`).toBe(false);
      expect(supportUnder(x, z, config.radius, 8.01, world.boxes, -100), `${id}: floor`).toBeCloseTo(8, 6);
      expect(x + config.radius <= 14 || x - config.radius >= 18 || z - config.radius >= 400,
        `${id}: occupies the entry landing`).toBe(true);
      for (const [, otherX, otherZ] of HOLDING.slice(index + 1))
        expect(Math.hypot(x - otherX, z - otherZ), `${id}: separate captive footprint`).toBeGreaterThanOrEqual(config.radius * 2);
    }
  });

  it('keeps folded gate leaves, radio cues and blue cell trim/paperwork visual and outside collision', () => {
    const decor = outpostDecorations(), byId = new Map(decor.map((b) => [b.id, b]));
    const cue = (id: string) => { expect(byId.has(`outpost-decor-${id}`), id).toBe(true); return byId.get(`outpost-decor-${id}`)!; };
    expect(decor).toHaveLength(16);
    expect(byId.size).toBe(decor.length);
    expect(world.boxes.some((b) => byId.has(b.id))).toBe(false);
    for (const [side, z] of [['south', 356.03], ['north', 411.97]] as const)
      for (const [i, x] of [26, 38].entries()) {
        const leaf = cue(`${side}-leaf-${i}`);
        expect(leaf).toMatchObject({ x, y: 8, z, w: 4, h: 3, d: .06 });
        expect(leaf.x + leaf.w / 2 <= 28 || leaf.x - leaf.w / 2 >= 36, 'eight-metre arch').toBe(true);
      }
    for (const [i, z] of [371, 377].entries()) for (const [j, x] of [8.03, 55.97].entries()) {
      const leaf = cue(`side-leaf-${i}-${j}`);
      expect(leaf).toMatchObject({ x, y: 8, z, w: .06, h: 3, d: 2 });
      expect(leaf.z + leaf.d / 2 <= 372 || leaf.z - leaf.d / 2 >= 376, 'side infantry door').toBe(true);
    }
    for (const id of ['radio-lamp-stem', 'radio-lamp-shade', 'radio-set']) {
      const b = cue(id);
      expect(b.x - b.w / 2).toBeGreaterThanOrEqual(51); expect(b.x + b.w / 2).toBeLessThanOrEqual(53);
      expect(b.z - b.d / 2).toBeGreaterThanOrEqual(403.5); expect(b.z + b.d / 2).toBeLessThanOrEqual(404.5);
      expect(b.y).toBeGreaterThanOrEqual(9); expect(b.y + b.h).toBeLessThan(10);
    }
    expect(cue('radio-aerial-lead')).toMatchObject({ x: 53.98, y: 9.05, z: 404, w: .04, h: 2.9, d: .04 });
    for (const [i, x] of [13.96, 18.04].entries())
      expect(cue(`cell-blue-trim-${i}`)).toMatchObject({ x, y: 8, z: 396.03, w: .08, h: 3, d: .06 });
    expect(cue('cell-blue-trim-head')).toMatchObject({ x: 16, y: 10.98, z: 396.03, w: 4.16, h: .08, d: .06 });
    expect(cue('cell-paperwork')).toMatchObject({ x: 10.02, y: 10.2, z: 406, w: .04, h: .6, d: .5 });
  });

  it('rejects repeated controller jump/vault chains toward the tower and from every supported prop top', () => {
    const starts = [
      // Starts inside the otherwise inaccessible tower pocket deliberately
      // give an attacker access to every leg, beyond ordinary court access.
      [49, 8, 417, 46.3, 414.3], [49, 8, 417, 46.3, 419.7],
      [49, 8, 417, 51.7, 414.3], [49, 8, 417, 51.7, 419.7],
      [47.1, 8, 414.3, 46.3, 414.3], [47.1, 8, 419.5, 46.3, 419.7],
      [50.9, 8, 414.3, 51.7, 414.3], [50.9, 8, 419.5, 51.7, 419.7],
      [49, 8, 413.5, 49, 417], [44, 8, 411.2, 49, 417], [55.1, 8, 411.2, 49, 417],
      [29, 9.1, 359, 29, 356], [30, 10.2, 376, 22, 380],
      [40, 9.1, 385, 42, 390], [32, 10.2, 400, 32, 412], [52, 9, 404, 54, 404],
    ] as const;
    // Retain all nearby overhead/collision geometry; the 32m padding exceeds
    // the complete push distance, including sprint and automatic vault probes.
    const distance = config.sprintSpeed * 120 * TICK_SECONDS + config.vaultDistance + config.radius;
    expect(distance).toBeLessThan(32);
    let attempts = 0, peakFeet = 8;
    for (const [x, y, z, targetX, targetZ] of starts) {
      const boxes: WorldBox[] = world.boxes.filter((b) => b.maxX >= x - 32 && b.minX <= x + 32 && b.maxZ >= z - 32 && b.minZ <= z + 32);
      expect(blockedAt(x, z, config.radius, y, .05, config.height, boxes), `valid start ${x}/${y}/${z}`).toBe(false);
      expect(supportUnder(x, z, config.radius, y + .01, boxes, -100), `supported start ${x}/${y}/${z}`).toBeCloseTo(y, 6);
      const toward = Math.round(Math.atan2(targetX - x, targetZ - z) / (2 * Math.PI) * 1024);
      for (const offset of [-256, 0, 256, 512]) for (const stance of ['jump', 'crouch', 'prone']) {
        let state = { ...createMoveState(x, y, z), grounded: true };
        for (let tick = 0; tick < 180; tick++) {
          state = stepCharacter(state, { moveX: 0, moveY: tick < 120 ? 1 : 0,
            yaw: (toward + offset + (tick >= 60 ? 128 : 0) + 2048) % 1024,
            sprint: tick < 120, jump: tick < 120 && stance === 'jump',
            crouch: tick < 120 && stance === 'crouch', prone: tick < 120 && stance === 'prone' }, TICK_SECONDS, config, boxes);
          const label = `${x}/${y}/${z}/${offset}/${stance}/${tick}`;
          peakFeet = Math.max(peakFeet, state.y);
          expect(state.y, `${label}: reached tank/leg top`).toBeLessThan(22);
          if (state.grounded) expect(state.y, `${label}: landed on structural roof, perimeter or terrain shortcut`).toBeLessThanOrEqual(10.200001);
        }
        expect(state.grounded, 'attempt settled on support').toBe(true);
        expect(state.vault, 'attempt finished its vault').toBeNull();
        attempts++;
      }
    }
    expect(attempts).toBe(192);
    console.log('U-179 furniture/tower controller probes', JSON.stringify({ attempts, pushTicks: 120, settleTicks: 60, peakFeet }));
  }, 120_000);
});
