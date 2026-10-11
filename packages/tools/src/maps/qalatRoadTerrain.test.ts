import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, DEFAULT_MUZZLE_RIG, TICK_SECONDS, createMoveState, rayWorld, stepCharacter, type BoxSpec, type WorldBox,
} from '@sandline/shared';
import { between, rayOccluded } from './insertionScreening.ts';
import { ROAD_SUPPORTS, buildRoadSupportLevel, buildRoadSupportWorld, roadSupportManifest } from './qalatRoadSupports.ts';
import { ROAD_TERRAIN, SKIN_TOP, TERRAIN_SPURS, VIEW_FANS, rayClearances } from './qalatRoadTerrain.ts';

type Point = { x: number; z: number };
// Independent transcriptions: the bent road (U-159), §6.2's bays with U-160's
// moved MG nest, its blind-spot fins and the two temporary caps.
const STOPS = [
  { id: 'A0', x: 32, z: 64 }, { id: 'A1', x: 32, z: 98 }, { id: 'A2', x: 12, z: 128 }, { id: 'A3', x: -37, z: 142 },
  { id: 'A4', x: -28, z: 210 }, { id: 'A5', x: 26, z: 232 }, { id: 'A6', x: 30, z: 270 }, { id: 'A7', x: -18, z: 302 },
  { id: 'A8', x: 16, z: 332 }, { id: 'A9', x: 32, z: 350 }, { id: 'south-gate', x: 32, z: 356 },
];
const APRONS = STOPS.slice(1, 9);
const A9_BEVEL: Point[] = [
  { x: 22, z: 350 }, { x: 39.4740931868366, z: 343.3563616117008 },
  { x: 42, z: 350 }, { x: 24.5259068131634, z: 356.6436383882992 },
];
const BAYS = [
  { id: 'V1', eye: { x: 58, y: 20 + DEFAULT_MUZZLE_RIG.eyeHeight, z: 128 }, targets: [{ x: -4, z: 126 }, { x: 24, z: 138 }] },
  { id: 'V2', eye: { x: 88, y: 30 + DEFAULT_MUZZLE_RIG.eyeHeight, z: 210 }, targets: [{ x: -22, z: 222 }, { x: 26, z: 232 }] },
  { id: 'V3', eye: { x: 66, y: 26 + DEFAULT_MUZZLE_RIG.eyeHeight, z: 286 }, targets: [{ x: -18, z: 302 }, { x: 16, z: 332 }, { x: 38, z: 360 }] },
];
const MG_NEST = { x: -22, z: 222 };
const FINS = [{ id: 'F1', minX: 33, maxX: 39, minZ: 146, maxZ: 154, top: 26 }, { id: 'F2', minX: 49, maxX: 55, minZ: 168, maxZ: 176, top: 32 }];
const EDGE_TOP = 10.2; // 2.2 m: above the 1.8 m head and the 1.37 m a soldier can climb
const yieldWorker = () => new Promise<void>((resolve) => setImmediate(resolve));

const level = buildRoadSupportLevel();
const world = buildRoadSupportWorld();
const isRock = (id: string) => id.startsWith('road-rock') || id.startsWith('road-cap-');
const rock = level.boxes.filter((b) => isRock(b.id));
const rect = (b: BoxSpec) => ({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2, minY: b.y, maxY: b.y + b.h });

/** Plan grid over the world's boxes for fast column queries. */
const CELL = 2, grid = new Map<string, WorldBox[]>();
for (const b of world.boxes) for (let x = Math.floor(b.minX / CELL); x <= Math.floor(b.maxX / CELL); x++)
  for (let z = Math.floor(b.minZ / CELL); z <= Math.floor(b.maxZ / CELL); z++) {
    const k = `${x},${z}`, list = grid.get(k);
    if (list) list.push(b); else grid.set(k, [b]);
  }
const boxesAt = (x: number, z: number) => (grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? [])
  .filter((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ);
const near = (x: number, z: number, r: number) => world.boxes.filter((b) => b.maxX > x - r && b.minX < x + r && b.maxZ > z - r && b.minZ < z + r);

/** Top of the solid column that contains y7.9 (just below the road) at a plan point, or -Infinity. */
function solidTop(x: number, z: number): number {
  const column = boxesAt(x, z).sort((a, b) => a.minY - b.minY);
  let y = 7.9, found = false;
  for (const b of column) {
    if (b.minY > y + 1e-9) { if (found) break; continue; }
    if (b.maxY > y) { y = b.maxY; found = true; }
  }
  return found ? y : -Infinity;
}

/** Exact walking surface: 20 m ribbons, the A9 bevel and 18 m aprons. */
function onRoad(p: Point, margin = 0): boolean {
  if (APRONS.some((a) => Math.hypot(p.x - a.x, p.z - a.z) <= 18 + margin)) return true;
  if (A9_BEVEL.every((a, i) => {
    const b = A9_BEVEL[(i + 1) % A9_BEVEL.length]!, dx = b.x - a.x, dz = b.z - a.z;
    return dx * (p.z - a.z) - dz * (p.x - a.x) >= -margin * Math.hypot(dx, dz);
  })) return true;
  return STOPS.slice(1).some((b, i) => {
    const a = STOPS[i]!, dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    const along = ((p.x - a.x) * dx + (p.z - a.z) * dz) / length;
    const across = Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / length;
    return along >= -margin && along <= length + margin && across <= 10 + margin;
  });
}

/** Separating-axis overlap of an axis-aligned rectangle and a convex polygon (positive area only). */
function overlaps(r: { minX: number; maxX: number; minZ: number; maxZ: number }, poly: Point[]): boolean {
  const corners = [{ x: r.minX, z: r.minZ }, { x: r.maxX, z: r.minZ }, { x: r.maxX, z: r.maxZ }, { x: r.minX, z: r.maxZ }];
  const axes = [{ x: 1, z: 0 }, { x: 0, z: 1 }, ...poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length]!, l = Math.hypot(b.x - a.x, b.z - a.z);
    return { x: -(b.z - a.z) / l, z: (b.x - a.x) / l };
  })];
  return axes.every((n) => {
    const p = poly.map((v) => v.x * n.x + v.z * n.z), q = corners.map((v) => v.x * n.x + v.z * n.z);
    return Math.min(Math.max(...p), Math.max(...q)) - Math.max(Math.min(...p), Math.min(...q)) > 1e-9;
  });
}
const ribbons = STOPS.slice(1).map((b, i) => {
  const a = STOPS[i]!, l = Math.hypot(b.x - a.x, b.z - a.z), nx = -(b.z - a.z) / l * 10, nz = (b.x - a.x) / l * 10;
  return [{ x: a.x + nx, z: a.z + nz }, { x: b.x + nx, z: b.z + nz }, { x: b.x - nx, z: b.z - nz }, { x: a.x - nx, z: a.z - nz }];
});
/** Plan bounds of a polygon, so the exact test only runs where it can overlap. */
const bounds = (poly: Point[]) => ({ poly, minX: Math.min(...poly.map((p) => p.x)), maxX: Math.max(...poly.map((p) => p.x)),
  minZ: Math.min(...poly.map((p) => p.z)), maxZ: Math.max(...poly.map((p) => p.z)) });

/** Independent pointwise §6.2 surface: plane between adjacent rays, nearer ray outside them. */
function rayFloorAt(bay: typeof BAYS[number], p: Point): number {
  const { eye } = bay, angle = (q: Point) => Math.atan2(q.z - eye.z, eye.x - q.x);
  const rays = bay.targets.map((t) => ({ t, a: angle(t), l: Math.hypot(t.x - eye.x, t.z - eye.z) })).sort((u, v) => u.a - v.a);
  const a = angle(p), d = Math.hypot(p.x - eye.x, p.z - eye.z);
  const along = (r: typeof rays[number]) => eye.y + (8 - eye.y) * d / r.l;
  if (a <= rays[0]!.a) return along(rays[0]!);
  if (a >= rays.at(-1)!.a) return along(rays.at(-1)!);
  const i = rays.findIndex((r, k) => k > 0 && a <= r.a), r0 = rays[i - 1]!, r1 = rays[i]!;
  // The eye's barycentric weight in the plan triangle eye–r0–r1; both feet are y8.
  const den = (r0.t.z - r1.t.z) * (eye.x - r1.t.x) + (r1.t.x - r0.t.x) * (eye.z - r1.t.z);
  const we = ((r0.t.z - r1.t.z) * (p.x - r1.t.x) + (r1.t.x - r0.t.x) * (p.z - r1.t.z)) / den;
  return we * eye.y + (1 - we) * 8;
}

describe('U-160 road-facing rock on the bent road', () => {
  it('transcribes the bays (MG nest moved), blind-spot fins, crests and temporary caps', () => {
    expect(ROAD_SUPPORTS.spine.map(({ id, x, z }) => ({ id, x, z }))).toEqual(STOPS);
    expect(ROAD_TERRAIN.viewFans.bays.map((b) => ({ id: b.id, anchor: b.anchor, targets: b.targets.map(({ x, z }) => ({ x, z })) })))
      .toEqual(BAYS.map((b) => ({ id: b.id, anchor: { x: b.eye.x, y: b.eye.y - DEFAULT_MUZZLE_RIG.eyeHeight, z: b.eye.z }, targets: b.targets })));
    expect(ROAD_TERRAIN.viewFans.rayClearanceM).toBe(.3);
    expect(ROAD_TERRAIN.fins).toEqual(FINS);
    expect(SKIN_TOP).toBe(EDGE_TOP);
    expect(ROAD_TERRAIN.bottomY).toBe(5.5);
    expect(ROAD_TERRAIN.sideTops).toEqual({ left: 26, right: 20 });
    expect(TERRAIN_SPURS.map((s) => [s.id, s.top])).toEqual([['T-C-A3', 20], ['T-C-A5', 22], ['T-C-A7', 20]]);
    expect(ROAD_TERRAIN.temporaryCaps.map((c) => [c.id, c.for])).toEqual([['C12-L-mouth', 'U-141'], ['south-gate', 'U-116']]);
    // The moved nest stands on the A4 bend, off the 12 m lane of both legs.
    const a4 = STOPS[4]!, lane = (a: Point, b: Point) => Math.abs((MG_NEST.x - a.x) * (b.z - a.z) - (MG_NEST.z - a.z) * (b.x - a.x)) / Math.hypot(b.x - a.x, b.z - a.z);
    expect(Math.hypot(MG_NEST.x - a4.x, MG_NEST.z - a4.z)).toBeLessThan(14);
    expect(lane(a4, STOPS[5]!)).toBeGreaterThan(8.5);
    expect(MG_NEST.z).toBeGreaterThan(a4.z + 6);
  });

  it('keeps all rock off the walking surface and inside its reserved volume', () => {
    expect(rock.length).toBeGreaterThan(10_000);
    const road = [...ribbons, A9_BEVEL].map(bounds);
    for (const b of rock.map(rect)) {
      // Off the 20 m ribbons, the A9 bevel and the 36 m aprons: the tank lane,
      // aprons and the full return-sweep provision stay untouched.
      for (const a of APRONS) {
        const dx = Math.max(b.minX - a.x, 0, a.x - b.maxX), dz = Math.max(b.minZ - a.z, 0, a.z - b.maxZ);
        expect(Math.hypot(dx, dz), `rock ${JSON.stringify(b)} on apron ${a.id}`).toBeGreaterThanOrEqual(18);
      }
      for (const r of road) {
        if (r.maxX <= b.minX || r.minX >= b.maxX || r.maxZ <= b.minZ || r.minZ >= b.maxZ) continue;
        expect(overlaps(b, r.poly), `rock ${JSON.stringify(b)} on the road`).toBe(false);
      }
      // y5.5 and up keeps every future basement room open; z84 and north
      // leaves the accepted insertion, its screening and court reveal alone.
      expect(b.minY).toBeGreaterThanOrEqual(5.5);
      expect(b.minZ).toBeGreaterThanOrEqual(84);
      expect(b.maxZ).toBeLessThanOrEqual(358);
      expect(b.minX).toBeGreaterThanOrEqual(-72);
      // Bridge x66..74/z330..342 and the B6 vault's y0..5.5 stay clear.
      expect(b.maxX <= 66 || b.minZ >= 342 || b.maxZ <= 330).toBe(true);
    }
  }, 60_000);

  it('closes every road edge with solid rock from below the road to at least 2.2 m above it', async () => {
    let probes = 0, lowest = Infinity;
    const probe = (p: Point) => {
      if (p.z < 84 || onRoad(p, .25)) return;
      const top = solidTop(p.x, p.z);
      expect(top, `open edge at ${JSON.stringify(p)}`).toBeGreaterThanOrEqual(EDGE_TOP - 1e-9);
      lowest = Math.min(lowest, top); probes++;
    };
    for (let i = 1; i < STOPS.length; i++) {
      const a = STOPS[i - 1]!, b = STOPS[i]!, dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
      for (let s = 0; s <= l; s += .25) for (const side of [-1, 1]) for (const off of [10.3, 11]) {
        probe({ x: a.x + dx * s / l - dz / l * off * side, z: a.z + dz * s / l + dx / l * off * side });
      }
      await yieldWorker();
    }
    for (const a of APRONS) for (let deg = 0; deg < 360; deg += .5) for (const r of [18.3, 19]) {
      probe({ x: a.x + r * Math.cos(deg * Math.PI / 180), z: a.z + r * Math.sin(deg * Math.PI / 180) });
    }
    // The road's north end, except the standing pad at the exact gate node.
    const pad = ROAD_TERRAIN.standingPads[0]!;
    expect(pad).toMatchObject({ minX: 31.6, maxX: 32.4, minZ: 356, maxZ: 356.4 });
    for (let x = 20; x <= 44; x += .25) if (x < pad.minX || x > pad.maxX) probe({ x, z: 356.3 });
    expect(solidTop(32, 356.3)).toBe(-Infinity);
    expect(solidTop(32, 356.5)).toBeGreaterThanOrEqual(EDGE_TOP);
    expect(probes).toBeGreaterThan(8000);
    console.log('U-160 road edges', JSON.stringify({ probes, lowestTopY: lowest, requiredY: EDGE_TOP }));
  }, 60_000);

  it('fills the A3 and A7 inside corners with rock above head height, never a drop', () => {
    for (const id of ['T-C-A3', 'T-C-A7']) {
      const spur = TERRAIN_SPURS.find((s) => s.id === id)!;
      const xs = spur.polygon.map((v) => v.x), zs = spur.polygon.map((v) => v.z);
      let points = 0, lowest = Infinity;
      for (let x = Math.min(...xs); x <= Math.max(...xs); x += .5) for (let z = Math.min(...zs); z <= Math.max(...zs); z += .5) {
        const p = { x, z };
        const inside = spur.polygon.every((a, i) => {
          const b = spur.polygon[(i + 1) % spur.polygon.length]!;
          return (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x) <= 0;
        }) || spur.polygon.every((a, i) => {
          const b = spur.polygon[(i + 1) % spur.polygon.length]!;
          return (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x) >= 0;
        });
        if (!inside || onRoad(p, .25)) continue;
        const top = solidTop(x, z);
        expect(top, `${id} at ${JSON.stringify(p)}`).toBeGreaterThanOrEqual(EDGE_TOP - 1e-9);
        lowest = Math.min(lowest, top); points++;
      }
      expect(points).toBeGreaterThan(1000);
      console.log(`U-160 ${id} inside corner`, JSON.stringify({ points, lowestTopY: lowest }));
    }
  }, 60_000);

  it('keeps every listed ridge-bay ray 0.3 m above the permanent rock', () => {
    const permanent = world.boxes.filter((b) => b.id.startsWith('road-rock'));
    const caps = world.boxes.filter((b) => b.id.startsWith('road-cap-'));
    const crossings: string[] = [];
    for (const bay of BAYS) for (const t of bay.targets) {
      // The ray to the target's feet, lowered 0.3 m, misses all permanent rock.
      const lowered = between({ ...bay.eye, y: bay.eye.y - .3 }, { ...t, y: 8 - .3 });
      expect(rayWorld(lowered, permanent), `${bay.id} → ${JSON.stringify(t)}`).toBeNull();
      // Over the whole built scene, the bay sees a target standing there unless a temporary cap stands in the way.
      const view = between(bay.eye, { ...t, y: 8.05 });
      if (rayWorld(view, caps) !== null) crossings.push(`${bay.id}→${t.x},${t.z}`);
      else expect(rayWorld(view, world.boxes), `${bay.id} → ${JSON.stringify(t)}`).toBeNull();
    }
    // Only the two recorded temporary caps block a listed view.
    expect(crossings).toEqual(['V1→24,138', 'V3→38,360']);
    const clearances = rayClearances(level.boxes);
    expect(clearances.map((r) => r.blockedOnlyByTemporaryCaps)).toEqual([[], ['C12-L-mouth'], [], [], [], [], ['south-gate']]);
    for (const r of clearances) expect(r.clearanceM).toBeGreaterThanOrEqual(.3);
    expect(roadSupportManifest().terrain.rays).toEqual(clearances);
  }, 60_000);

  it('caps the rock under each whole §6.2 fan, not only along the rays', async () => {
    let samples = 0;
    for (const fan of VIEW_FANS) {
      const bay = BAYS.find((b) => b.id === fan.id)!;
      const inHull = (p: Point) => fan.hull.every((a, i) => {
        const b = fan.hull[(i + 1) % fan.hull.length]!;
        return (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x) >= -1e-9;
      }) || fan.hull.every((a, i) => {
        const b = fan.hull[(i + 1) % fan.hull.length]!;
        return (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x) <= 1e-9;
      });
      for (const box of rock.filter((b) => b.id.startsWith('road-rock')).map(rect)) {
        const nx = Math.max(1, Math.ceil((box.maxX - box.minX) / .25)), nz = Math.max(1, Math.ceil((box.maxZ - box.minZ) / .25));
        for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
          const p = { x: box.minX + (box.maxX - box.minX) * i / nx, z: box.minZ + (box.maxZ - box.minZ) * j / nz };
          if (!inHull(p)) continue;
          expect(box.maxY, `${fan.id} at ${JSON.stringify(p)}`).toBeLessThanOrEqual(rayFloorAt(bay, p) - .3 + 1e-6);
          samples++;
        }
      }
      await yieldWorker();
    }
    expect(samples).toBeGreaterThan(10_000);
  }, 60_000);

  it('keeps the deliberate blind spots: F1 hides the MG nest from V1, F2 hides the toll bend from V2', () => {
    const [v1, v2] = BAYS;
    for (const h of [.05, 1.55, 1.8]) {
      expect(rayWorld(between(v1!.eye, { ...MG_NEST, y: 8 + h }), world.boxes)).not.toBeNull();
      expect(rayWorld(between(v2!.eye, { x: 12, y: 8 + h, z: 128 }), world.boxes)).not.toBeNull();
    }
    for (const fin of FINS) {
      for (const x of [fin.minX + .1, (fin.minX + fin.maxX) / 2, fin.maxX - .1]) for (const z of [fin.minZ + .1, fin.maxZ - .1]) {
        expect(solidTop(x, z), `${fin.id}`).toBe(fin.top);
      }
      for (const fan of VIEW_FANS) expect(fan.hull.some((p) => p.x > fin.minX && p.x < fin.maxX && p.z > fin.minZ && p.z < fin.maxZ)).toBe(false);
    }
  }, 60_000);

  it('separates the three fights in 3D: no standing eye on one apron sees a head on another', async () => {
    const blocked = rayOccluded(world.boxes.filter((b) => b.maxY > 8 && b.maxZ > 100));
    const grid = (a: Point) => {
      const out: Point[] = [];
      for (let x = -18; x <= 18; x += 2.5) for (let z = -18; z <= 18; z += 2.5) if (Math.hypot(x, z) <= 17.6) out.push({ x: a.x + x, z: a.z + z });
      return out;
    };
    const fights = [['A2'], ['A4', 'A5'], ['A8']].map((ids) => ids.flatMap((id) => grid(STOPS.find((s) => s.id === id)!)));
    let rays = 0;
    for (let i = 0; i < fights.length; i++) for (let j = 0; j < fights.length; j++) {
      if (i === j) continue;
      for (const eye of fights[i]!) {
        for (const head of fights[j]!) {
          rays++;
          expect(blocked(between({ ...eye, y: 8 + DEFAULT_MUZZLE_RIG.eyeHeight }, { ...head, y: 8 + DEFAULT_MOVE_CONFIG.height })),
            `${JSON.stringify(eye)} sees ${JSON.stringify(head)}`).toBe(true);
        }
        await yieldWorker();
      }
    }
    expect(rays).toBeGreaterThan(100_000);
    console.log('U-160 fight separation', JSON.stringify({ rays, gridM: 2.5, eyeY: 8 + DEFAULT_MUZZLE_RIG.eyeHeight, headY: 8 + DEFAULT_MOVE_CONFIG.height }));
  }, 120_000);

  it('rejects walking, sprint-jumping, vaulting, crouching and crawling off every edge', async () => {
    let attempts = 0;
    const tryEscape = (p: Point, out: Point) => {
      const start = { x: p.x - out.x * .6, z: p.z - out.z * .6 };
      if (!onRoad(start, -.45) || start.z < 84) return;
      const yaw = Math.round(Math.atan2(out.x, out.z) / (2 * Math.PI) * 1024 + 1024) % 1024;
      // Two seconds of sprinting covers under 14 m.
      const boxes = near(start.x, start.z, 16);
      for (const stance of ['walk', 'jump', 'crouch', 'prone']) {
        let state = createMoveState(start.x, 8, start.z);
        for (let tick = 0; tick < 60; tick++) state = stepCharacter(state, {
          moveX: 0, moveY: 1, yaw, sprint: stance !== 'walk', jump: stance === 'jump', crouch: stance === 'crouch', prone: stance === 'prone',
        }, TICK_SECONDS, DEFAULT_MOVE_CONFIG, boxes);
        for (let settle = 0; settle < 30; settle++) state = stepCharacter(state, { moveX: 0, moveY: 0, yaw, sprint: false, jump: false, crouch: false, prone: false }, TICK_SECONDS, DEFAULT_MOVE_CONFIG, boxes);
        expect(state.vault).toBeNull();
        expect(state.y, `${stance} at ${JSON.stringify(start)}`).toBeCloseTo(8);
        expect(onRoad(state, .05), `${stance} left the road at ${JSON.stringify(start)}`).toBe(true);
        attempts++;
      }
    };
    for (let i = 1; i < STOPS.length; i++) {
      const a = STOPS[i - 1]!, b = STOPS[i]!, dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
      for (let s = 2; s < l; s += 4) for (const side of [-1, 1]) {
        const out = { x: -dz / l * side, z: dx / l * side };
        tryEscape({ x: a.x + dx * s / l + out.x * 10, z: a.z + dz * s / l + out.z * 10 }, out);
      }
      await yieldWorker();
    }
    for (const a of APRONS) {
      for (let deg = 0; deg < 360; deg += 10) {
        const out = { x: Math.cos(deg * Math.PI / 180), z: Math.sin(deg * Math.PI / 180) };
        tryEscape({ x: a.x + out.x * 18, z: a.z + out.z * 18 }, out);
      }
      await yieldWorker();
    }
    expect(attempts).toBeGreaterThan(600);
    console.log('U-160 escape attempts', JSON.stringify({ attempts, stances: ['walk', 'sprint-jump', 'crouch', 'prone'], ticks: 60 }));
  }, 120_000);
});
