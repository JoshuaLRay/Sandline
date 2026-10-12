import { describe, expect, it } from 'vitest';
import { blockedAt, supportUnder, type WorldBox } from '@sandline/shared';
import { FLIGHTS, RIDGE } from './qalatRidge.ts';
import { buildRoadSupportWorld } from './qalatRoadSupports.ts';

// Independent §6.1 transcription. Coordinates stay fixed when clearance
// moves the final descent's first flight beyond the J2/J3 road pads.
const NODES = [{ id: 'R7', x: 70, y: 20, z: 322 }, { id: 'R7b', x: 70, y: 16, z: 336 },
  { id: 'R8', x: 70, y: 12, z: 350 }, { id: 'R9', x: 56, y: 8, z: 370 }];
const world = buildRoadSupportWorld(), bands = new Map<number, WorldBox[]>();
for (const b of world.boxes) for (let z = Math.floor(b.minZ); z <= Math.floor(b.maxZ); z++) {
  const row = bands.get(z) ?? []; row.push(b); bands.set(z, row);
}
const near = (x: number, z: number, reach = .5) => {
  const found = new Set<WorldBox>();
  for (let row = Math.floor(z - reach); row <= Math.floor(z + reach); row++)
    for (const b of bands.get(row) ?? [])
      if (b.maxX >= x - reach && b.minX <= x + reach && b.maxZ >= z - reach && b.minZ <= z + reach) found.add(b);
  return [...found];
};
const floor = (x: number, z: number, top = 20.1) => supportUnder(x, z, .001, top, near(x, z, .002), 0);
const descent = { length: Math.hypot(14, 20), ux: -14 / Math.hypot(14, 20), uz: 20 / Math.hypot(14, 20) };
const at = (t: number, off = 0) => ({ x: 70 + descent.ux * t - descent.uz * off, z: 350 + descent.uz * t + descent.ux * off });
const onBridge = (x: number, z: number, margin = 0) => {
  if (x >= 66 - margin && x <= 74 + margin && z >= 320 - margin && z <= 352 + margin) return true;
  if (x >= 52 - margin && x <= 60 + margin && z >= 368 - margin && z <= 374 + margin) return true;
  const along = (x - 70) * descent.ux + (z - 350) * descent.uz, across = Math.abs((x - 70) * descent.uz - (z - 350) * descent.ux);
  return along >= -margin && along <= descent.length + margin && across <= 4 + margin;
};

describe('U-164 built service bridge and final ridge descent', () => {
  it('builds the exact structural deck, R8 slab and temporary east-gate cap', () => {
    expect(RIDGE.spine.slice(7)).toEqual(NODES);
    expect(RIDGE.landings.slice(7)).toEqual([
      { id: 'R7b', minX: 66, maxX: 74, minZ: 330, maxZ: 342 },
      { id: 'R8', minX: 66, maxX: 74, minZ: 348, maxZ: 352 },
      { id: 'R9', minX: 52, maxX: 60, minZ: 368, maxZ: 374 }]);
    expect(world.boxes.find((b) => b.id === 'ridge-bridge-deck')).toMatchObject({ minX: 66, maxX: 74, minZ: 330, maxZ: 342, minY: 14, maxY: 16 });
    expect(world.boxes.some((b) => b.id.startsWith('ridge-cap-R7'))).toBe(false);
    expect(world.boxes.find((b) => b.id === 'ridge-cap-east-gate')).toMatchObject({ minX: 52, maxX: 60, minZ: 374, maxZ: 374.6, maxY: 10.2 });
    for (let x = 66.1; x < 74; x += .2) for (let z = 348.1; z < 352; z += .2) {
      expect(floor(x, z, 12.1)).toBe(12);
      expect(near(x, z, .002).some((b) => b.minY === 11.4 && b.maxY === 12)).toBe(true);
    }
  });

  it('measures both twenty-riser 0.30 m approaches outside the flat deck', () => {
    for (const [start, top, bottom] of [[322, 20, 16], [342, 16, 12]] as const) {
      const steps: number[] = []; let previous = top as number;
      for (let t = .01; t < 8; t += .01) {
        const y = floor(70, start + t, top + .1);
        if (Math.abs(y - previous) > 1e-8) { expect(previous - y).toBeCloseTo(.2, 8); steps.push(t); }
        previous = y;
      }
      expect(steps).toHaveLength(20);
      expect(previous).toBe(bottom);
      steps.forEach((t, i) => expect(t).toBeCloseTo((i + 1) * .3, 1));
      for (let z = start + 6.01; z < start + 8; z += .1) expect(floor(70, z, top + .1)).toBe(bottom);
    }
    for (let z = 330; z <= 342; z += .1) expect(floor(70, z, 16.1)).toBe(16);
  });

  it('fits twenty 0.40 m risers with two-metre rests after the entire width clears the road', () => {
    const f = FLIGHTS.at(-1)!;
    expect(f.risers).toHaveLength(20); expect(f.restLandingM).toBeGreaterThanOrEqual(2);
    const first = at(f.risers[0]!, 4);
    expect(first.z).toBeGreaterThanOrEqual(355.05);
    const lower = world.boxes.filter((b) => b.id.startsWith('ridge-floor') && b.minZ >= 348 && b.maxY < 12);
    expect(lower.length).toBeGreaterThan(0);
    const builtMinZ = Math.min(...lower.map((b) => b.minZ));
    expect(builtMinZ).toBeGreaterThan(355.04); // independently beyond the z355 pad plus 0.01 m support skin
    const steps: number[] = []; let previous = 12;
    for (let t = .01; t < descent.length; t += .01) {
      const p = at(t), y = floor(p.x, p.z, 12.1);
      if (Math.abs(y - previous) > 1e-8) { expect(previous - y).toBeCloseTo(.2, 8); steps.push(t); }
      previous = y;
    }
    expect(steps).toHaveLength(20); expect(previous).toBe(8);
    for (let i = 1; i < steps.length; i++) {
      const run = steps[i]! - steps[i - 1]!;
      if (i === 10) expect(run).toBeGreaterThanOrEqual(2);
      else { expect(run).toBeGreaterThan(.3); expect(run).toBeLessThan(.5); }
    }
    console.log('U-164 final descent', JSON.stringify({ firstRiserMinZ: first.z, builtLowerStairMinZ: builtMinZ,
      firstRiserM: f.risers[0], restLandingM: f.restLandingM }));
  });

  it('keeps full-width standing clearance and continuous barriers to feet along bridge and descent edges', () => {
    let barriers = 0;
    const probe = (x: number, z: number, top: number, dx: number, dz: number) => {
      const y = floor(x, z, top);
      for (const d of [.2, .6]) {
        const px = x + dx * d, pz = z + dz * d;
        if (onBridge(px, pz, .05)) continue;
        const wall = near(px, pz, .002).filter((b) => px >= b.minX - 1e-6 && px <= b.maxX + 1e-6 && pz >= b.minZ - 1e-6 && pz <= b.maxZ + 1e-6);
        expect(wall.some((b) => b.minY <= y + .005 && b.maxY >= y + 2.2 - 1e-8), `barrier gap at ${px},${pz} beside y${y}`).toBe(true);
        barriers++;
      }
    };
    for (let z = 322.25; z < 352; z += .25) {
      const centre = floor(70, z);
      // A full standing footprint must remain inside the pad's north edge.
      for (let x = 66.4; z <= 351.65 && x <= 73.6; x += .4) {
        const y = floor(x, z), boxes = near(x, z);
        expect(y, `unsupported bridge at ${x},${z}`).toBeGreaterThanOrEqual(12);
        expect(Math.abs(y - centre)).toBeLessThanOrEqual(.2 + 1e-8);
        expect(blockedAt(x, z, .35, y, .45, 1.8, boxes), `blocked bridge at ${x},${z} y${y}`).toBe(false);
      }
      for (const side of [-1, 1]) probe(70 + side * 3.95, z, 20.1, side, 0);
    }
    for (let t = 3; t < descent.length - 2; t += .25) {
      const mid = at(t), centre = floor(mid.x, mid.z, 12.1);
      for (let off = -3.45; off <= 3.45; off += .69) {
        const p = at(t, off), y = floor(p.x, p.z, 12.1);
        expect(y, `unsupported descent at ${JSON.stringify(p)}`).toBeGreaterThanOrEqual(8);
        expect(Math.abs(y - centre)).toBeLessThanOrEqual(.2 + 1e-8);
        expect(blockedAt(p.x, p.z, .35, y, .45, 1.8, near(p.x, p.z)), `blocked descent at ${JSON.stringify(p)} y${y}`).toBe(false);
      }
      for (const side of [-1, 1]) {
        const p = at(t, side * 3.95);
        probe(p.x, p.z, 12.1, -descent.uz * side, descent.ux * side);
      }
    }
    expect(barriers).toBeGreaterThan(500);
  }, 60_000);
});
