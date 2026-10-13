import { describe, expect, it } from 'vitest';
import { DEFAULT_MOVE_CONFIG, blockedAt, supportUnder, type WorldBox } from '@sandline/shared';
import { C12, crossingFlights } from './qalatC12.ts';
import { buildRoadSupportWorld } from './qalatRoadSupports.ts';
import { inConvex } from './planStrata.ts';
import { convexHull } from './roadSightLines.ts';

// Independent §6.3 coordinates and counts: moving a waypoint or dropping a
// flight must fail even if the generated world agrees with its authoring JSON.
const APPROVED = [
  { id: 'C12-L', spine: [[12, 8, 128], [28, 8, 134], [40, 12, 140], [54, 16, 140], [64, 20, 128]], risers: [0, 20, 20, 20] },
  { id: 'C12-U', spine: [[26, 8, 232], [40, 8, 218], [62, 14, 216], [78, 20, 224], [66, 24, 244], [86, 30, 248]], risers: [0, 30, 30, 20, 30] },
] as const;
const world = buildRoadSupportWorld(), grid = new Map<string, WorldBox[]>(), CELL = 2;
for (const b of world.boxes) for (let x = Math.floor(b.minX / CELL); x <= Math.floor(b.maxX / CELL); x++)
  for (let z = Math.floor(b.minZ / CELL); z <= Math.floor(b.maxZ / CELL); z++) {
    const key = `${x},${z}`, row = grid.get(key) ?? []; row.push(b); grid.set(key, row);
  }
const near = (x: number, z: number, radius = .4) => {
  const out = new Set<WorldBox>();
  for (let gx = Math.floor((x - radius) / CELL); gx <= Math.floor((x + radius) / CELL); gx++)
    for (let gz = Math.floor((z - radius) / CELL); gz <= Math.floor((z + radius) / CELL); gz++)
      for (const b of grid.get(`${gx},${gz}`) ?? [])
        if (b.maxX >= x - radius && b.minX <= x + radius && b.maxZ >= z - radius && b.minZ <= z + radius) out.add(b);
  return [...out];
};
const floorAt = (x: number, z: number, top: number) => supportUnder(x, z, .001, top, near(x, z, .002), 0);
const segments = APPROVED.flatMap((s) => s.spine.slice(1).map((b, i) => {
  const a = s.spine[i]!, length = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const ux = (b[0] - a[0]) / length, uz = (b[2] - a[2]) / length;
  return { crossing: s.id, i, a, b, length, ux, uz, risers: s.risers[i]! };
}));
const at = (s: typeof segments[number], t: number, off = 0) =>
  ({ x: s.a[0] + s.ux * t - s.uz * off, z: s.a[2] + s.uz * t + s.ux * off });

describe('U-168 exact C12 road–ridge stair construction', () => {
  it('transcribes the two exact spines, counts, clear width, risers and four-metre pads', () => {
    expect(C12.stairs.map((s) => ({ id: s.id, spine: s.spine.map((n) => [n.x, n.y, n.z]), risers: s.risers }))).toEqual(APPROVED);
    expect(C12).toMatchObject({ widthM: 4, riserM: .2, treadM: .4, flightRisers: 10, restLandingM: 2, landingM: 4, bottomY: 5.5, cheekM: 1 });
    expect(C12.stairs.map((s) => s.risers.reduce((sum, n) => sum + n, 0))).toEqual([60, 110]);
    expect(world.boxes.some((b) => b.id.startsWith('road-cap-C12-L-mouth'))).toBe(false);
    const flights = crossingFlights();
    for (const s of segments) {
      const f = flights.filter((f) => f.crossing === s.crossing)[s.i]!;
      expect(f.risers).toHaveLength(s.risers);
      expect(f.length).toBeCloseTo(s.length, 9);
      expect(f.fromY).toBe(s.a[1]); expect(f.toY).toBe(s.b[1]);
      // Owner-approved compact treads on the constrained §6.3 segments;
      // every other segment retains the standard construction dimension.
      expect(f.treadM).toBe((s.crossing === 'C12-L' && [1, 3].includes(s.i)) || (s.crossing === 'C12-U' && [2, 4].includes(s.i)) ? .3 : .4);
      if (s.risers) expect(f.restLandingM).toBeGreaterThanOrEqual(2);
      for (let k = 1; k < f.risers.length; k++) {
        const run = f.risers[k]! - f.risers[k - 1]!;
        if (k % 10) expect(run).toBeCloseTo(f.treadM, 9);
        else expect(run).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('measures all 170 built risers and the standard treads and rests on the exact centre lines', () => {
    const report: Record<string, unknown>[] = [], flights = crossingFlights();
    for (const s of segments) {
      const top = s.b[1] + .1, steps: number[] = [];
      let previous = floorAt(s.a[0], s.a[2], top);
      expect(previous).toBe(s.a[1]);
      for (let t = .01; t < s.length; t += .01) {
        const p = at(s, t), y = floorAt(p.x, p.z, top);
        // Each centre line stays open to the sky, including where a mouth
        // carves into an existing ridge pad: a covered underpass is not C12.
        const overhead = near(p.x, p.z, .002).filter((b) => p.x > b.minX + 1e-6 && p.x < b.maxX - 1e-6
          && p.z > b.minZ + 1e-6 && p.z < b.maxZ - 1e-6 && b.minY > y + 1e-6);
        expect(overhead, `${s.crossing}/${s.i} roof at ${t}`).toEqual([]);
        if (Math.abs(y - previous) > 1e-8) {
          expect(y - previous, `${s.crossing}/${s.i} rise at ${t}`).toBeCloseTo(.2, 8); steps.push(t);
        }
        previous = y;
      }
      expect(previous, `${s.crossing}/${s.i} endpoint`).toBe(s.b[1]);
      expect(steps, `${s.crossing}/${s.i} built risers`).toHaveLength(s.risers);
      const tread = flights.filter((f) => f.crossing === s.crossing)[s.i]!.treadM;
      for (let k = 1; k < steps.length; k++) {
        const run = steps[k]! - steps[k - 1]!;
        // The generated 0.05 m rows can move a riser plane by at most 5 cm.
        if (k % 10) expect(Math.abs(run - tread), `${s.crossing}/${s.i} tread ${k}`).toBeLessThanOrEqual(.06);
        else expect(run, `${s.crossing}/${s.i} rest ${k}`).toBeGreaterThanOrEqual(1.94);
      }
      report.push({ crossing: s.crossing, segment: s.i, risers: steps.length, treadM: tread });
    }
    console.log('U-168 built C12 flights', JSON.stringify(report));
  }, 60_000);

  it('supports the entire four-metre width and every four-by-four landing with standing clearance', () => {
    let widthProbes = 0, padProbes = 0;
    for (const s of segments) for (let t = .4; t < s.length - .4; t += .2) {
      const centre = at(s, t), top = s.b[1] + .1, cy = floorAt(centre.x, centre.z, top);
      for (const off of [-1.99, -1.6, -.8, 0, .8, 1.6, 1.99]) {
        const p = at(s, t, off), y = floorAt(p.x, p.z, top);
        expect(Math.abs(y - cy), `${s.crossing}/${s.i} width ${t}/${off}`).toBeLessThanOrEqual(.2 + 1e-8);
        if (Math.abs(off) <= 1.6) {
          const boxes = near(p.x, p.z), feet = supportUnder(p.x, p.z, DEFAULT_MOVE_CONFIG.radius, top, boxes, 0);
          expect(blockedAt(p.x, p.z, DEFAULT_MOVE_CONFIG.radius, feet, .45, DEFAULT_MOVE_CONFIG.height, boxes), `${s.crossing}/${s.i} body ${t}/${off}`).toBe(false);
        }
        widthProbes++;
      }
    }
    for (const s of APPROVED) for (const [x, y, z] of s.spine.slice(1, -1))
      for (let dx = -1.99; dx <= 1.99; dx += .2) for (let dz = -1.99; dz <= 1.99; dz += .2) {
        expect(floorAt(x + dx, z + dz, y + .1), `${s.id} landing ${x}/${z} at ${dx}/${dz}`).toBe(y);
        if (Math.abs(dx) < 1.6 && Math.abs(dz) < 1.6)
          expect(blockedAt(x + dx, z + dz, DEFAULT_MOVE_CONFIG.radius, y, 0, DEFAULT_MOVE_CONFIG.height, near(x + dx, z + dz))).toBe(false);
        padProbes++;
      }
    expect(widthProbes).toBeGreaterThan(5_000); expect(padProbes).toBe(2_800);
    console.log('U-168 C12 clearance', JSON.stringify({ widthProbes, padProbes }));
  }, 60_000);

  it('preserves the full eight-metre ridge lane and its turning bevel through both crossing mouths', () => {
    let probes = 0;
    for (const [node, neighbours] of [
      [[64, 20, 128], [[78, 96], [80, 168]]], [[86, 30, 248], [[94, 210], [72, 286]]],
    ] as const) {
      const [x, y, z] = node, corners: { x: number; z: number }[] = [];
      const probe = (px: number, pz: number, body = false) => {
        expect(floorAt(px, pz, y + .1), `ridge lane at ${px}/${pz}`).toBe(y);
        if (body) expect(blockedAt(px, pz, DEFAULT_MOVE_CONFIG.radius, y, 0, DEFAULT_MOVE_CONFIG.height, near(px, pz))).toBe(false);
        probes++;
      };
      for (const [nx, nz] of neighbours) {
        const length = Math.hypot(nx - x, nz - z), ux = (nx - x) / length, uz = (nz - z) / length;
        corners.push(...[-4, 4].map((off) => ({ x: x - uz * off, z: z + ux * off })));
        for (let t = 0; t <= 4; t += .2) for (let off = -3.99; off <= 3.99; off += .2) {
          const body = Math.abs(off) <= 4 - DEFAULT_MOVE_CONFIG.radius * (Math.abs(ux) + Math.abs(uz));
          probe(x + ux * t - uz * off, z + uz * t + ux * off, body);
        }
      }
      const bevel = convexHull(corners);
      for (let px = x - 4; px <= x + 4; px += .1) for (let pz = z - 4; pz <= z + 4; pz += .1)
        if (inConvex(bevel, { x: px, z: pz })) probe(px, pz);
    }
    expect(probes).toBeGreaterThan(5_000);
    console.log('U-168 retained eight-metre ridge junctions', JSON.stringify({ probes }));
  }, 60_000);
});
