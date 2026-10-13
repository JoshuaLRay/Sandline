import { describe, expect, it } from 'vitest';
import { DEFAULT_MUZZLE_RIG, blockedAt, rayWorld, supportUnder, type WorldBox } from '@sandline/shared';
import { between } from './insertionScreening.ts';
import { onInsertionFloor } from './qalatInsertion.ts';
import { buildRoadSupportLevel, buildRoadSupportWorld } from './qalatRoadSupports.ts';
import { VIEW_FANS } from './qalatRoadTerrain.ts';
import { FLIGHTS, RIDGE, isTemporaryRidgeCap, ridgeManifest, ridgeRayClearances } from './qalatRidge.ts';

import { inConvex } from './planStrata.ts';
import { convexHull, ribbonPieces } from './roadSightLines.ts';
import { onCrossingFloor } from './qalatC12.ts';

type Point = { x: number; z: number };
// Independent §6.1 transcription: nodes, riser counts and flat landings.
const NODES = ([['R0', 62, 8, 68], ['R1', 78, 14, 96], ['R2', 64, 20, 128], ['R3', 80, 26, 168],
  ['R4', 94, 30, 210], ['R5', 86, 30, 248], ['R6', 72, 26, 286], ['R7', 70, 20, 322]] as const)
  .map(([id, x, y, z]) => ({ id, x, y, z }));
const RISERS = [30, 30, 30, 20, 0, 20, 30];
const LANDINGS = Object.entries({
  R1: [72, 84, 90, 102, 14], R2: [58, 70, 122, 134, 20], R3: [74, 86, 158, 182, 26], R4: [88, 100, 204, 216, 30],
  R5: [80, 92, 242, 254, 30], R6: [66, 78, 280, 292, 26], R7: [66, 74, 320, 322, 20],
}).map(([id, [minX, maxX, minZ, maxZ, y]]) => ({ id, minX: minX!, maxX: maxX!, minZ: minZ!, maxZ: maxZ!, y: y! }));
const BAYS = [
  { id: 'V1', y: 20, x: 58, z: 128, targets: [{ x: -4, y: 8, z: 126 }, { x: 24, y: 8, z: 138 }] },
  { id: 'V2', y: 30, x: 88, z: 210, targets: [{ x: -22, y: 8, z: 222 }, { x: 26, y: 8, z: 232 }] },
  { id: 'V3', y: 26, x: 66, z: 286, targets: [{ x: -18, y: 8, z: 302 }, { x: 16, y: 8, z: 332 }, { x: 38, y: 8, z: 360 }] },
  { id: 'V3-X5', y: 26, x: 66, z: 286, targets: [{ x: 54, y: 11.2, z: 334 }] },
];
// Independent local R6 clearance bevel; exact stairs/nodes remain unchanged.
const APRON = ribbonPieces([{ x: 75.86842105263158, z: 275.5 }, { x: 71.5, z: 281.9 },
  { x: 71.5, z: 290 }, { x: 71.5, z: 295 }], 8).filter((poly) => poly.length >= 3);
const inApron = (p: Point, margin: number) => APRON.some((poly) => margin < 0
  ? [-margin, margin].flatMap((dx) => [-margin, margin].map((dz) => ({ x: p.x + dx, z: p.z + dz }))).every((v) => inConvex(poly, v))
  : inConvex(convexHull(poly.flatMap((v) => [-margin, margin].flatMap((dx) =>
    [-margin, margin].map((dz) => ({ x: v.x + dx, z: v.z + dz }))))), p));
const FURNITURE_FLOORS = [
  [81.6, 90.6, 97.4, 106.6], [80, 82, 98, 102], [77.6, 86.6, 277.4, 288.6],
  [90, 98, 235, 251], [78, 85, 317.4, 323], [74, 78, 318, 322],
] as const;
const inFurnitureFloor = (p: Point, margin: number) => FURNITURE_FLOORS.some(([x0, x1, z0, z1]) =>
  p.x >= x0 - margin && p.x <= x1 + margin && p.z >= z0 - margin && p.z <= z1 + margin);
// Fixed cover/shell occupancy replaces the old empty-pad assertion only here;
// qalatRidgeClearance independently proves the continuous 8 m route beside it.
const OCCUPIED = [[83.6, 84.4, 168, 172], [75.6, 76.4, 283.5, 288.5],
  [82, 90.6, 97.4, 98], [82, 90.6, 106, 106.6], [90, 90.6, 98, 106],
  [79.4, 86.6, 277.4, 278], [78, 86.6, 288, 288.6], [86, 86.6, 278, 288]] as const;
const furnishingAt = (p: Point, radius: number) => OCCUPIED.some(([x0, x1, z0, z1]) =>
  p.x + radius > x0 && p.x - radius < x1 && p.z + radius > z0 && p.z - radius < z1);
// U-167 §6.2: each 8×8 m bay floor, x=anchor.x-0.8..+7.2, z=anchor.z±4.
const inBay = (p: Point, margin: number) => BAYS.slice(0, 3).some((b) =>
  p.x >= b.x - .8 - margin && p.x <= b.x + 7.2 + margin && p.z >= b.z - 4 - margin && p.z <= b.z + 4 + margin);
const underlying = (b: WorldBox) => !/^(ridge-cover-|ridge-hut-|ridge-survey-)/.test(b.id);
// U-168 (§6.3): C12-L's and C12-U's last flights end inside the R2 and R5
// landings. Their bounded open mouths replace only the 4 m stair footprint;
// there the floor is the stair's own (risers proved in qalatC12.test.ts).
const MOUTHS = [[{ x: 54, z: 140 }, { x: 64, z: 128 }, 16, 20], [{ x: 66, z: 244 }, { x: 86, z: 248 }, 24, 30]] as const;
const inMouth = (p: Point, margin: number) => MOUTHS.some(([a, b]) => {
  const l = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / l, uz = (b.z - a.z) / l;
  const t = (p.x - a.x) * ux + (p.z - a.z) * uz, off = (p.z - a.z) * ux - (p.x - a.x) * uz;
  return t >= -margin && t <= l + margin && Math.abs(off) <= 2 + margin;
});
const HALF = 4, BARRIER = 2.2, X4 = { x: 84, z: 338 };

/** Independent pointwise §6.2 surface: plane between adjacent rays, nearer ray outside them. */
function rayFloorAt(bay: typeof BAYS[number], p: Point): number {
  const eye = { x: bay.x, y: bay.y + DEFAULT_MUZZLE_RIG.eyeHeight, z: bay.z }, angle = (q: Point) => Math.atan2(q.z - eye.z, eye.x - q.x);
  const rays = bay.targets.map((t) => ({ t, a: angle(t), l: Math.hypot(t.x - eye.x, t.z - eye.z) })).sort((u, v) => u.a - v.a);
  const a = angle(p), d = Math.hypot(p.x - eye.x, p.z - eye.z);
  const along = (r: typeof rays[number]) => eye.y + (r.t.y - eye.y) * d / r.l;
  if (a <= rays[0]!.a) return along(rays[0]!);
  if (a >= rays.at(-1)!.a) return along(rays.at(-1)!);
  const i = rays.findIndex((r, k) => k > 0 && a <= r.a), r0 = rays[i - 1]!, r1 = rays[i]!;
  const den = (r0.t.z - r1.t.z) * (eye.x - r1.t.x) + (r1.t.x - r0.t.x) * (eye.z - r1.t.z);
  const we = ((r0.t.z - r1.t.z) * (p.x - r1.t.x) + (r1.t.x - r0.t.x) * (p.z - r1.t.z)) / den;
  const w0 = ((r1.t.z - eye.z) * (p.x - r1.t.x) + (eye.x - r1.t.x) * (p.z - r1.t.z)) / den;
  return we * eye.y + w0 * r0.t.y + (1 - we - w0) * r1.t.y;
}

const level = buildRoadSupportLevel(), world = buildRoadSupportWorld();
const CELL = 2, grid = new Map<string, WorldBox[]>();
for (const b of world.boxes) for (let x = Math.floor(b.minX / CELL); x <= Math.floor(b.maxX / CELL); x++)
  for (let z = Math.floor(b.minZ / CELL); z <= Math.floor(b.maxZ / CELL); z++) {
    const k = `${x},${z}`, list = grid.get(k);
    if (list) list.push(b); else grid.set(k, [b]);
  }
// Centre/size box specs leave sub-micron seams between rows; a point query spans them.
const column = (p: Point, e = 1e-6) => (grid.get(`${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`) ?? [])
  .filter((b) => p.x >= b.minX - e && p.x <= b.maxX + e && p.z >= b.minZ - e && p.z <= b.maxZ + e);
const near = (p: Point, r = 1) => world.boxes.filter((b) => b.maxX > p.x - r && b.minX < p.x + r && b.maxZ > p.z - r && b.minZ < p.z + r);
const floorAt = (p: Point, below: number) => supportUnder(p.x, p.z, .001, below, column(p).filter(underlying), 0);

const segments = NODES.slice(1).map((b, i) => {
  const a = NODES[i]!, length = Math.hypot(b.x - a.x, b.z - a.z);
  return { a, b, length, u: { x: (b.x - a.x) / length, z: (b.z - a.z) / length }, risers: RISERS[i]! };
});
const at = (s: typeof segments[number], t: number, off = 0) =>
  ({ x: s.a.x + s.u.x * t - s.u.z * off, z: s.a.z + s.u.z * t + s.u.x * off });
const inLanding = (p: Point, margin = 0) => LANDINGS.find((l) =>
  p.x >= l.minX - margin && p.x <= l.maxX + margin && p.z >= l.minZ - margin && p.z <= l.maxZ + margin);
/** A superset of the designed shelf: 8 m ribbons, their corner bevels (inside
 * a 4 m disc at each turning node; R7 ends the shelf) and the flat landings. */
function onShelf(p: Point, margin = 0): boolean {
  if (inFurnitureFloor(p, margin) || inApron(p, margin) || inBay(p, margin)) return true;
  // U-164 opens R7's north edge onto its full-width bridge approach.
  if (p.x >= 66 - margin && p.x <= 74 + margin && p.z >= 322 - margin && p.z <= 350 + margin) return true;
  if (inLanding(p, margin) || NODES.slice(0, -1).some((n) => Math.hypot(p.x - n.x, p.z - n.z) <= HALF + margin)) return true;
  return segments.some((s) => {
    const t = (p.x - s.a.x) * s.u.x + (p.z - s.a.z) * s.u.z, across = Math.abs((p.x - s.a.x) * s.u.z - (p.z - s.a.z) * s.u.x);
    return t >= -margin && t <= s.length + margin && across <= HALF + margin;
  });
}
/** Highest top of any solid that would stand in a body on a floor at y. */
const wallTop = (p: Point, y: number) => Math.max(-Infinity, ...column(p).filter((b) => b.minY < y + 1.8).map((b) => b.maxY));

describe('U-163 continuous R0–R7 ridge shelf', () => {
  it('transcribes §6.1: nodes, riser counts, landings, 8 m width and the barrier', () => {
    expect(RIDGE.spine.slice(0, 8)).toEqual(NODES);
    expect(RIDGE.risers.slice(0, 7)).toEqual(RISERS);
    expect(RIDGE.landings.slice(0, 7)).toEqual(LANDINGS.map(({ y: _, ...l }) => l));
    expect(RIDGE).toMatchObject({ shelfWidth: 8, riserM: .2, treadM: .4, flightRisers: 10, restLandingM: 2, barrierM: BARRIER, bottomY: 5.5 });
    // U-167 replaced the three bay caps with built bays.
    expect(RIDGE.temporaryCaps.map((c) => [c.id, c.for])).toEqual([['east-gate', 'U-116']]);
    for (const [i, s] of segments.entries()) expect(Math.abs(s.b.y - s.a.y)).toBeCloseTo(RISERS[i]! * .2, 9);
  });

  it('builds each climb as 10-riser flights of 0.20 m risers and 0.40 m treads with ≥2 m rest landings', () => {
    const report: Record<string, unknown>[] = [];
    for (const s of segments) {
      const top = Math.max(s.a.y, s.b.y) + .1, steps: number[] = [];
      let previous = floorAt(at(s, 0), top);
      expect(previous, `${s.a.id} floor`).toBe(s.a.y);
      for (let t = .01; t <= s.length + 1e-9; t += .01) {
        const y = floorAt(at(s, t), top);
        if (Math.abs(y - previous) > 1e-9) {
          expect(Math.abs(y - previous), `${s.a.id}→${s.b.id} riser at ${t}`).toBeCloseTo(.2, 9);
          expect(Math.sign(y - previous)).toBe(Math.sign(s.b.y - s.a.y));
          steps.push(t);
        }
        previous = y;
      }
      expect(previous, `${s.b.id} floor`).toBe(s.b.y);
      expect(steps, `${s.a.id}→${s.b.id}`).toHaveLength(s.risers);
      const spacing = steps.slice(1).map((t, i) => t - steps[i]!);
      for (let k = 0; k < spacing.length; k++) {
        // Riser lines follow the generated 0.1 m rows: ≤5 cm displacement each.
        if ((k + 1) % 10) { expect(spacing[k]!).toBeGreaterThan(.3); expect(spacing[k]!).toBeLessThan(.5); }
        else expect(spacing[k]!, `${s.a.id}→${s.b.id} rest landing`).toBeGreaterThanOrEqual(1.9);
      }
      // Flat runs before and after the flights are rest landings too.
      if (steps.length) {
        const from = LANDINGS.find((l) => l.id === s.a.id), to = LANDINGS.find((l) => l.id === s.b.id)!;
        let exit = 0;
        while (from && inLanding(at(s, exit + .01))) exit += .01;
        let entry = s.length;
        while (inLanding(at(s, entry - .01)) === to) entry -= .01;
        expect(steps[0]! - exit).toBeGreaterThanOrEqual(1.9);
        expect(entry - steps.at(-1)!).toBeGreaterThanOrEqual(1.9);
        report.push({ segment: `${s.a.id}→${s.b.id}`, risers: steps.length, firstRest: +(steps[0]! - exit).toFixed(2),
          lastRest: +(entry - steps.at(-1)!).toFixed(2), minRest: +Math.min(...spacing.filter((_, k) => !((k + 1) % 10)), Infinity).toFixed(2) });
      }
    }
    expect(FLIGHTS.slice(0, 7).map((f) => f.risers.length)).toEqual(RISERS);
    console.log('U-163 stair flights', JSON.stringify(report));
  });

  it('keeps inherited shelf floors supported and head clearance outside fixed furnishing footprints', () => {
    let probes = 0;
    for (const s of segments) {
      const top = Math.max(s.a.y, s.b.y) + .1;
      // A footprint at either end of a segment may hang past it into the bevel's notch.
      for (let t = .35; t <= s.length - .35; t += .25) {
        const centre = floorAt(at(s, t), top);
        // An axis-aligned square footprint needs more room across a diagonal shelf.
        const reach = HALF - .35 * (Math.abs(s.u.x) + Math.abs(s.u.z)) - .01;
        for (let off = -reach; off <= reach + 1e-9; off += reach / 7) {
          const p = at(s, t, off), y = floorAt(p, top), boxes = near(p);
          // Across the width only rasterized riser lines may differ (one riser).
          expect(Math.abs(y - centre), `${s.a.id}→${s.b.id} at ${t}/${off}`).toBeLessThanOrEqual(.2 + 1e-9);
          if (furnishingAt(p, .35)) continue;
          // A standing soldier's whole footprint fits, stepping no more than the controller's 0.45 m.
          const feet = supportUnder(p.x, p.z, .35, top, boxes.filter(underlying), 0);
          expect(blockedAt(p.x, p.z, .35, feet, .45, 1.8, boxes), `blocked ${JSON.stringify(p)} y${feet}`).toBe(false);
          probes++;
        }
      }
    }
    let mouth = 0;
    for (const l of LANDINGS) for (let x = l.minX + .35; x <= l.maxX - .35 + 1e-9; x += .5) for (let z = l.minZ + .35; z <= l.maxZ - .35 + 1e-9; z += .5) {
      const p = { x, z };
      if (inMouth(p, .05)) {
        const [, , low, high] = MOUTHS.find(([, b]) => Math.hypot(b.x - p.x, b.z - p.z) < 20)!, y = floorAt(p, l.y + .1);
        expect(y, `${l.id} mouth at ${JSON.stringify(p)}`).toBeGreaterThanOrEqual(low);
        expect(y, `${l.id} mouth at ${JSON.stringify(p)}`).toBeLessThanOrEqual(high);
        mouth++;
        continue;
      }
      expect(floorAt(p, l.y + .1), `${l.id} flat at ${JSON.stringify(p)}`).toBe(l.y);
      if (furnishingAt(p, .35)) continue;
      // Fixed broken survey beams stay above standing head clearance.
      expect(blockedAt(x, z, .35, l.y, 0, 1.8, near(p)), `${l.id} roofed at ${JSON.stringify(p)}`).toBe(false);
      probes++;
    }
    expect(probes).toBeGreaterThan(15_000);
    expect(mouth).toBeGreaterThan(0);
    // Two 4 m flights' last few metres: about 54 m² of the 288 m² of landings.
    expect(mouth, 'the mouths stay a bounded corner of their landings').toBeLessThan(260);
  }, 60_000);

  it('stands every shelf edge against rock at least 2.2 m above the adjacent floor', () => {
    let probes = 0, lowest = Infinity;
    const probe = (inside: Point, out: Point, top: number) => {
      const y = floorAt(inside, top);
      for (const d of [.15, .6]) {
        const p = { x: inside.x + out.x * d, z: inside.z + out.z * d };
        // The rasterized floor may overshoot a designed edge by <0.05 m (§15).
        if (onShelf(p, .05) || onInsertionFloor(p, .2) || onCrossingFloor(p, .05)) continue;
        const wall = wallTop(p, y);
        expect(wall, `open ridge edge at ${JSON.stringify(p)} beside y${y}`).toBeGreaterThanOrEqual(y + BARRIER - 1e-9);
        lowest = Math.min(lowest, wall - y); probes++;
      }
    };
    for (const s of segments) for (let t = 0; t <= s.length; t += .25) for (const side of [-1, 1]) {
      const inside = at(s, t, side * (HALF - .05));
      probe(inside, { x: -s.u.z * side, z: s.u.x * side }, Math.max(s.a.y, s.b.y) + .1);
    }
    for (const l of LANDINGS) {
      for (let x = l.minX; x <= l.maxX; x += .25) for (const [z, dz] of [[l.minZ + .05, -1], [l.maxZ - .05, 1]] as const) probe({ x, z }, { x: 0, z: dz }, l.y + .1);
      for (let z = l.minZ; z <= l.maxZ; z += .25) for (const [x, dx] of [[l.minX + .05, -1], [l.maxX - .05, 1]] as const) probe({ x, z }, { x: dx, z: 0 }, l.y + .1);
    }
    expect(probes).toBeGreaterThan(4000);
    console.log('U-163 ridge edges', JSON.stringify({ probes, lowestBarrierM: lowest }));
  }, 60_000);

  it('caps permanent ridge rock 0.3 m under every bay fan and leaves every listed ray open through the built bays', () => {
    const permanent = world.boxes.filter((b) => b.id.startsWith('ridge-rock'));
    const ridge = world.boxes.filter((b) => b.id.startsWith('ridge-') && !isTemporaryRidgeCap(b.id));
    for (const bay of BAYS) {
      const eye = { x: bay.x, y: bay.y + DEFAULT_MUZZLE_RIG.eyeHeight, z: bay.z };
      for (const t of bay.targets) {
        expect(rayWorld(between({ ...eye, y: eye.y - .3 }, { ...t, y: t.y - .3 }), permanent), `${bay.id} → ${JSON.stringify(t)}`).toBeNull();
        // U-167: the whole built ridge, lip and canopy included, leaves the standing-eye ray open.
        expect(rayWorld(between(eye, t), ridge), `${bay.id} frame → ${JSON.stringify(t)}`).toBeNull();
      }
    }
    const clearances = ridgeRayClearances(level.boxes);
    for (const r of clearances) {
      if (r.clearanceM !== null) expect(r.clearanceM).toBeGreaterThanOrEqual(.3);
      expect(r.frameGapM, `${r.bay} ${r.target} frame`).toBeGreaterThanOrEqual(.15);
      expect(r.blockedOnlyByTemporaryCaps).toEqual([]);
    }
    expect(ridgeManifest(level.boxes).rays).toEqual(clearances);
    // Rock in a fan stays under its ray surface everywhere, not only on the rays.
    let samples = 0;
    for (const fan of VIEW_FANS) {
      const inHull = (p: Point) => fan.hull.every((a, i) => {
        const b = fan.hull[(i + 1) % fan.hull.length]!;
        return (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x) >= -1e-9;
      }) || fan.hull.every((a, i) => {
        const b = fan.hull[(i + 1) % fan.hull.length]!;
        return (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x) <= 1e-9;
      });
      const bay = BAYS.find((b) => b.id === fan.id)!;
      for (const box of permanent) {
        const nx = Math.max(1, Math.ceil((box.maxX - box.minX) / .25)), nz = Math.max(1, Math.ceil((box.maxZ - box.minZ) / .25));
        for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
          const p = { x: box.minX + (box.maxX - box.minX) * i / nx, z: box.minZ + (box.maxZ - box.minZ) * j / nz };
          if (!inHull(p)) continue;
          expect(box.maxY, `${fan.id} rock at ${JSON.stringify(p)}`).toBeLessThanOrEqual(rayFloorAt(bay, p) - .3 + 1e-6);
          samples++;
        }
      }
    }
    expect(samples).toBeGreaterThan(100);
  }, 60_000);

  it('retains the R0–R7 shelf apron slabs above the clear y8..14 volume', () => {
    const ridge = world.boxes.filter((b) => b.id.startsWith('ridge-') && b.maxZ <= 322);
    expect(ridge.length).toBeGreaterThan(5000);
    for (const b of ridge) {
      expect(b.minY).toBeGreaterThanOrEqual(5.5);
      expect(b.minZ, b.id).toBeGreaterThanOrEqual(60);
      const apron = Math.hypot(Math.max(b.minX - X4.x, 0, X4.x - b.maxX), Math.max(b.minZ - X4.z, 0, X4.z - b.maxZ)) < 18;
      if (b.id.startsWith('ridge-slab')) expect(b.minY, b.id).toBeGreaterThanOrEqual(14);
      else if (apron) expect(b.minY, `${b.id} enters the clear X4 volume`).toBeGreaterThanOrEqual(14);
    }
    expect(ridge.filter((b) => b.id.startsWith('ridge-slab')).every((b) => b.maxY === 20)).toBe(true);
  });
});
