import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, TICK_SECONDS, blockedAt, createMoveState, stepCharacter, supportUnder, type BoxSpec, type WorldBox,
} from '@sandline/shared';
import {
  ROAD_COMBAT, buildRoadCombat, combatAxis, combatFootprint, combatOpenFloors, combatRegroupFloors,
} from './qalatRoadCombat.ts';
import { ROAD_SUPPORTS, buildRoadSupportWorld, roadSightPieces } from './qalatRoadSupports.ts';
import { scan, union, type Polygon } from './planStrata.ts';

const world = buildRoadSupportWorld(), combat = buildRoadCombat();
const screenIds = ROAD_COMBAT.screens.map((s: { id: string }) => s.id);
const boxOrder = new Map(world.boxes.map((b, i) => [b, i]));
const CELL = 2, grid = new Map<string, WorldBox[]>();
for (const b of world.boxes) for (let x = Math.floor(b.minX / CELL); x <= Math.floor(b.maxX / CELL); x++)
  for (let z = Math.floor(b.minZ / CELL); z <= Math.floor(b.maxZ / CELL); z++) {
    const key = `${x},${z}`, list = grid.get(key);
    if (list) list.push(b); else grid.set(key, [b]);
  }
const nearby = (x: number, z: number, radius: number) => {
  const out = new Set<WorldBox>();
  for (let a = Math.floor((x - radius) / CELL); a <= Math.floor((x + radius) / CELL); a++)
    for (let b = Math.floor((z - radius) / CELL); b <= Math.floor((z + radius) / CELL); b++)
      for (const box of grid.get(`${a},${b}`) ?? []) out.add(box);
  // Production collision resolves boxes sequentially. Spatial rejection must
  // retain that order, especially while sliding past adjoining corner boxes.
  return [...out].sort((a, b) => boxOrder.get(a)! - boxOrder.get(b)!);
};
const rectangle = (b: BoxSpec): Polygon => [
  { x: b.x - b.w / 2, z: b.z - b.d / 2 }, { x: b.x + b.w / 2, z: b.z - b.d / 2 },
  { x: b.x + b.w / 2, z: b.z + b.d / 2 }, { x: b.x - b.w / 2, z: b.z + b.d / 2 },
];
const areaOverlap = (a: Polygon, b: Polygon) => [...a, ...b].length > 0 && [a, b].flatMap((p) => p.map((v, i) => {
  const w = p[(i + 1) % p.length]!;
  return { x: -(w.z - v.z), z: w.x - v.x };
})).every((n) => {
  const x = a.map((p) => p.x * n.x + p.z * n.z), y = b.map((p) => p.x * n.x + p.z * n.z);
  return Math.min(Math.max(...x), Math.max(...y)) - Math.max(Math.min(...x), Math.min(...y)) > 1e-9;
});

/** Exact slab-band coverage of a complete rectangular regroup floor. */
function expectSupportedRectangle(poly: Polygon) {
  const minX = Math.min(...poly.map((p) => p.x)), maxX = Math.max(...poly.map((p) => p.x));
  const minZ = Math.min(...poly.map((p) => p.z)), maxZ = Math.max(...poly.map((p) => p.z));
  const slabs = nearby((minX + maxX) / 2, (minZ + maxZ) / 2, Math.max(maxX - minX, maxZ - minZ))
    .filter((b) => Math.abs(b.maxY - 8) < 1e-8 && b.maxX > minX && b.minX < maxX && b.maxZ > minZ && b.minZ < maxZ);
  const cuts = [...new Set([minZ, maxZ, ...slabs.flatMap((b) => [b.minZ, b.maxZ])])]
    .filter((z) => z >= minZ && z <= maxZ).sort((a, b) => a - b);
  for (let row = 1; row < cuts.length; row++) {
    const lo = cuts[row - 1]!, hi = cuts[row]!;
    if (hi - lo < 1e-9) continue;
    const spans = union(slabs.filter((b) => b.minZ <= lo + 1e-9 && b.maxZ >= hi - 1e-9).map((b) => [b.minX, b.maxX]));
    expect(spans.some(([a, b]) => a <= minX + 1e-8 && b >= maxX - 1e-8), `unsupported band z${lo}..${hi}`).toBe(true);
  }
}

describe('U-161 built road combat geometry', () => {
  it('keeps every actual stepped combat box outside the entire 12 m swept corridor', () => {
    const { lane } = roadSightPieces();
    let checked = 0;
    for (const b of combat) for (const p of lane) {
      expect(areaOverlap(rectangle(b), p), `${b.id} steals the 12 m corridor`).toBe(false); checked++;
    }
    expect(checked).toBeGreaterThan(40_000);
    const truck = ROAD_COMBAT.cover.find((c) => c.id === 'A-C02')!;
    expect({ x: truck.x, z: truck.z }).toEqual({ x: -4.1, z: 124.9 });
    const a = ROAD_SUPPORTS.spine.find((p) => p.id === 'A2')!, b = ROAD_SUPPORTS.spine.find((p) => p.id === 'A3')!;
    const clearance = Math.min(...combat.filter((p) => p.id.startsWith('road-combat-A-C02-')).flatMap((p) => rectangle(p))
      .map((p) => Math.abs((p.x - a.x) * (b.z - a.z) - (p.z - a.z) * (b.x - a.x)) / Math.hypot(b.x - a.x, b.z - a.z) - 6));
    expect(clearance).toBeGreaterThan(.07);
  }, 60_000);

  it('supports every fixed cover, tree and facade at floor 8 without an added carriageway obstruction', () => {
    const regular = combat.filter((b) => b.id.startsWith('road-combat-A-C') || b.id.startsWith('road-combat-orchard') || b.id.startsWith('road-combat-depot'));
    for (const b of regular) for (const p of [...rectangle(b), { x: b.x, z: b.z }])
      expect(supportUnder(p.x, p.z, .001, 8.45, nearby(p.x, p.z, .01), 0), `${b.id} at ${JSON.stringify(p)}`).toBe(8);
    expect(ROAD_COMBAT.cover.map((c) => c.id)).toEqual(Array.from({ length: 12 }, (_, i) => `A-C${String(i + 1).padStart(2, '0')}`));
  }, 60_000);

  it('keeps every named cover, orchard trunk and closed frontage facade visible outside the added rock screens', () => {
    const screens = combat.filter((b) => screenIds.some((id) => b.id.startsWith(`road-combat-${id}-`)));
    expect(screens.length).toBeGreaterThan(0);
    for (const prop of [...ROAD_COMBAT.cover, ...ROAD_COMBAT.facades]) for (const screen of screens)
      expect(areaOverlap(combatFootprint(prop), rectangle(screen)), `${screen.id} hides ${prop.id}`).toBe(false);
    const hidden: string[] = [];
    for (const prop of combat.filter((b) => b.id.startsWith('road-combat-A-C') || b.id.startsWith('road-combat-orchard') || b.id.startsWith('road-combat-depot')))
      for (const screen of screens) if (Math.min(prop.y + prop.h, screen.y + screen.h) > Math.max(prop.y, screen.y) + 1e-9 &&
        Math.min(prop.x + prop.w / 2, screen.x + screen.w / 2) > Math.max(prop.x - prop.w / 2, screen.x - screen.w / 2) + 1e-9 &&
        Math.min(prop.z + prop.d / 2, screen.z + screen.d / 2) > Math.max(prop.z - prop.d / 2, screen.z - screen.d / 2) + 1e-9)
        hidden.push(`${screen.id} hides actual ${prop.id}`);
    expect(hidden).toEqual([]);
  }, 60_000);

  it('leaves twelve complete 4–8 m regroup rectangles supported and free at standing height', () => {
    const pads = combatRegroupFloors();
    expect(pads).toHaveLength(12);
    for (const [i, p] of pads.entries()) {
      const pad = ROAD_COMBAT.regroupPads[i]!;
      expect(pad.w).toBeGreaterThanOrEqual(4); expect(pad.w).toBeLessThanOrEqual(8);
      expect(pad.d).toBeGreaterThanOrEqual(4); expect(pad.d).toBeLessThanOrEqual(8);
      expectSupportedRectangle(p);
      const solids = nearby(pad.x, pad.z, Math.max(pad.w, pad.d))
        .filter((b) => b.maxY > 8 + 1e-8 && b.minY < 8 + DEFAULT_MOVE_CONFIG.height);
      for (const b of solids) {
        const poly = [{ x: b.minX, z: b.minZ }, { x: b.maxX, z: b.minZ }, { x: b.maxX, z: b.maxZ }, { x: b.minX, z: b.maxZ }];
        expect(areaOverlap(p, poly), `${pad.cover} regroup intersects ${b.id}`).toBe(false);
      }
    }
  }, 60_000);

  it('carves and closes the toll interior, preserves a full 4 m east door, and crosses its edges with the production controller', () => {
    expect(combatOpenFloors()).toEqual([[{ x: -8.6, z: 113.4 }, { x: .6, z: 113.4 }, { x: .6, z: 122.6 }, { x: -8.6, z: 122.6 }]]);
    const office = ROAD_COMBAT.tollOffice;
    expect(office.doorMaxZ - office.doorMinZ).toBe(4);
    expect(office.ceilingY).toBe(11.5); expect(office.roofTopY).toBe(12.3); expect(office.roofWalkable).toBe(false);
    for (let x = -7.5; x <= -.5; x += .5) for (let z = 114.5; z <= 121.5; z += .5) {
      const boxes = nearby(x, z, .4);
      expect(blockedAt(x, z, .01, 8, 0, DEFAULT_MOVE_CONFIG.height, boxes)).toBe(false);
      expect(supportUnder(x, z, .01, 8.45, boxes, 0)).toBe(8);
    }
    for (const z of [116.35, 119.65]) {
      let state = createMoveState(3, 8, z);
      for (let tick = 0; tick < 60; tick++) state = stepCharacter(state,
        { moveX: 0, moveY: 1, yaw: 768, sprint: false, jump: false, crouch: false, prone: false }, TICK_SECONDS, DEFAULT_MOVE_CONFIG, nearby(state.x, state.z, 3));
      expect(state.x).toBeLessThan(-1); expect(state.y).toBeCloseTo(8); expect(state.vault).toBeNull();
    }
    expect(combat.filter((b) => b.id.includes('toll-office-north')).every((b) => b.y === 8 && b.h === 3.5)).toBe(true);
  }, 60_000);

  it('builds four nominal 0.35 m trunks with no branch collision and closes both 1 m facade recesses', () => {
    expect(ROAD_COMBAT.orchard.trunkRadiusM).toBe(.35); expect(ROAD_COMBAT.orchard.trees).toHaveLength(4);
    for (const tree of ROAD_COMBAT.orchard.trees) {
      const boxes = combat.filter((b) => b.id.startsWith(`road-combat-${tree.id}-`));
      expect(boxes.length).toBeGreaterThan(10);
      for (const p of boxes.flatMap(rectangle)) expect(Math.hypot(p.x - tree.x, p.z - tree.z)).toBeLessThan(.377);
      for (let angle = 0; angle < 360; angle += 2) {
        const p = { x: tree.x + .35 * Math.cos(angle * Math.PI / 180), z: tree.z + .35 * Math.sin(angle * Math.PI / 180) };
        expect(boxes.some((b) => { const span = scan(rectangle(b), p.z); return span && p.x >= span[0] - 1e-9 && p.x <= span[1] + 1e-9; })).toBe(true);
      }
      expect(boxes.every((b) => b.y === 8 && b.h === 3.8)).toBe(true);
    }
    for (const f of ROAD_COMBAT.facades) {
      expect(f.closed).toBe(true); expect(f.depth).toBe(1.2); expect(f.recessDepthM).toBe(1);
      const a = combatAxis(f), n = { x: -a.z, z: a.x };
      const p = { x: f.x + n.x * .6, z: f.z + n.z * .6 };
      expect(blockedAt(p.x, p.z, .01, 8, 0, DEFAULT_MOVE_CONFIG.height, nearby(p.x, p.z, .02))).toBe(true);
      const corners = combat.filter((b) => b.id.startsWith(`road-combat-${f.id}-`)).flatMap(rectangle);
      const offsets = corners.map((v) => (v.x - f.x) * n.x + (v.z - f.z) * n.z);
      expect(Math.min(...offsets)).toBeGreaterThan(-f.depth / 2 - .03);
      expect(Math.max(...offsets)).toBeLessThan(f.depth / 2 + .03);
    }
    expect(combat.some((b) => b.id.includes('branch'))).toBe(false);
  });

  it('places the frontage gunner and AF2/AF3 on clear walking floor with soldier-sized support', () => {
    expect(ROAD_COMBAT.frontageMG).toMatchObject({ id: 'AF1', x: -23, y: 8, z: 222.8, cover: 'A-C06' });
    expect(ROAD_COMBAT.frontageRiflemen.map(({ id, x, y, z }) => ({ id, x, y, z }))).toEqual([
      { id: 'AF2', x: -34, y: 8, z: 198 }, { id: 'AF3', x: -12, y: 8, z: 222 },
    ]);
    for (const p of [ROAD_COMBAT.frontageMG, ...ROAD_COMBAT.frontageRiflemen]) {
      const boxes = nearby(p.x, p.z, 1);
      expect(blockedAt(p.x, p.z, DEFAULT_MOVE_CONFIG.radius, 8, 0, DEFAULT_MOVE_CONFIG.height, boxes)).toBe(false);
      expect(supportUnder(p.x, p.z, DEFAULT_MOVE_CONFIG.radius, 8.45, boxes, 0)).toBe(8);
    }
  });

  it('prevents low cover from becoming a sprint-jump or vault route onto surrounding rock', () => {
    const floors = [...combatOpenFloors(), ...roadSightPieces().surface.polygons];
    const escapes: { cover: string; side: number; x: number; y: number; z: number }[] = [];
    for (const c of ROAD_COMBAT.cover.filter((b) => b.height < 2.2)) {
      const axis = combatAxis(c);
      const normal = { x: -axis.z, z: axis.x };
      const boxes = nearby(c.x, c.z, 22);
      const starts = [[0, 0], ...[-1, 1].flatMap((along) => [-1, 1].map((across) =>
        [along * (c.length / 2 - .4), across * (c.depth / 2 - .35)]))];
      for (const [along, across] of starts) for (let side = 0; side < 32; side++) {
        const angle = side * Math.PI / 16, out = { x: Math.sin(angle), z: Math.cos(angle) };
        const yaw = Math.round(Math.atan2(out.x, out.z) / (2 * Math.PI) * 1024 + 1024) % 1024;
        let state = createMoveState(c.x + axis.x * along! + normal.x * across!, c.y + c.height,
          c.z + axis.z * along! + normal.z * across!);
        for (let tick = 0; tick < 90; tick++) state = stepCharacter(state,
          { moveX: 0, moveY: 1, yaw, sprint: true, jump: true, crouch: false, prone: false }, TICK_SECONDS, DEFAULT_MOVE_CONFIG, boxes);
        for (let tick = 0; tick < 30; tick++) state = stepCharacter(state,
          { moveX: 0, moveY: 0, yaw, sprint: false, jump: false, crouch: false, prone: false }, TICK_SECONDS, DEFAULT_MOVE_CONFIG, boxes);
        expect(state.vault).toBeNull();
        const onFloor = floors.some((p) => { const span = scan(p, state.z); return span && state.x >= span[0] && state.x <= span[1]; }) ||
          ROAD_SUPPORTS.spine.filter((p) => ROAD_SUPPORTS.apronNodes.includes(p.id)).some((p) => Math.hypot(state.x - p.x, state.z - p.z) <= 18.05);
        const onRock = nearby(state.x, state.z, DEFAULT_MOVE_CONFIG.radius).some((b) =>
          (b.id.startsWith('road-rock') || b.id.startsWith('road-cap-')) && Math.abs(b.maxY - state.y) < .01 &&
          b.maxX > state.x - DEFAULT_MOVE_CONFIG.radius && b.minX < state.x + DEFAULT_MOVE_CONFIG.radius &&
          b.maxZ > state.z - DEFAULT_MOVE_CONFIG.radius && b.minZ < state.z + DEFAULT_MOVE_CONFIG.radius);
        const onScreen = nearby(state.x, state.z, DEFAULT_MOVE_CONFIG.radius).some((b) =>
          screenIds.some((id) => b.id.startsWith(`road-combat-${id}-`)) && Math.abs(b.maxY - state.y) < .01 &&
          b.maxX > state.x - DEFAULT_MOVE_CONFIG.radius && b.minX < state.x + DEFAULT_MOVE_CONFIG.radius &&
          b.maxZ > state.z - DEFAULT_MOVE_CONFIG.radius && b.minZ < state.z + DEFAULT_MOVE_CONFIG.radius);
        if (onRock || onScreen || !onFloor) escapes.push({ cover: c.id, side, x: state.x, y: state.y, z: state.z });
      }
    }
    expect(escapes, 'low-cover sprint-jump or vault escape endpoints').toEqual([]);
  }, 60_000);

  it('uses exact prescribed lengths and explicitly recorded along/across-road axes', () => {
    // Independent transcription of §5.2 after its recorded U-161 placement
    // changes, including the unchanged required MG breastwork.
    expect(ROAD_COMBAT.cover.map(({ id, x, y, z, length, depth, height }) => [id, x, y, z, length, depth, height])).toEqual([
      ['A-C01', 45, 8, 106, 4, 1.2, 2.2], ['A-C02', -4.1, 8, 124.9, 6, 2.6, 2.4],
      ['A-C03', 24, 8, 138, 5, .8, 1.1], ['A-C04', -42, 8, 170, 6, .8, 1.1],
      ['A-C05', -23, 8, 184, 4, 1.2, 2.2], ['A-C06', -22, 8, 222, 6, .8, 1.1],
      ['A-C07', 2, 8, 214, 4, 1.2, 2.2], ['A-C08', 16, 8, 219, 6, .8, 1.1],
      ['A-C09', 43, 8, 270, 6, .8, 1.1], ['A-C10', -4, 8, 325, 6, 1.2, 2.2],
      ['A-C11', 2, 8, 336, 4, .8, 1.1], ['A-C12', 36.36, 8, 342.1, 4, 1.2, 2.2],
    ]);
    for (const c of ROAD_COMBAT.cover) {
      const p = combatFootprint(c), along = Math.hypot(p[0]!.x - p[1]!.x, p[0]!.z - p[1]!.z);
      const across = Math.hypot(p[1]!.x - p[2]!.x, p[1]!.z - p[2]!.z);
      expect(along).toBeCloseTo(c.length, 8); expect(across).toBeCloseTo(c.depth, 8);
    }
  });
});
