import { describe, expect, it } from 'vitest';
import { discsSeeEachOther, farthestView, longestSegment, ribbonPieces, type Polygon } from './roadSightLines.ts';

const rect = (x0: number, z0: number, x1: number, z1: number): Polygon =>
  [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];

describe('U-159 plan-view sight-line measures', () => {
  it('finds the exact longest segment, including one pinned at a reflex corner', () => {
    expect(longestSegment([rect(0, 0, 10, 2)]).length).toBeCloseTo(Math.hypot(10, 2), 9);
    // An L of two 2 m bars: the best view runs from one outer end across the
    // inside corner (2,2) to the other bar, longer than either 10 m bar.
    const l = longestSegment([rect(0, 0, 10, 2), rect(0, 0, 2, 10)]);
    expect(l.length).toBeGreaterThan(Math.hypot(10, 2));
    // Brute force over dense lines never beats the exact answer.
    let sampled = 0;
    for (let k = 0; k < 1800; k++) {
      const a = k * Math.PI / 1800, d = { x: Math.cos(a), z: Math.sin(a) };
      for (let u = -12; u <= 12; u += .05) {
        const o = { x: -d.z * u, z: d.x * u };
        const inside = (t: number) => {
          const x = o.x + d.x * t, z = o.z + d.z * t;
          return (x >= 0 && x <= 10 && z >= 0 && z <= 2) || (x >= 0 && x <= 2 && z >= 0 && z <= 10);
        };
        let run = 0;
        for (let t = -15; t <= 15; t += .05) { run = inside(t) ? run + .05 : 0; sampled = Math.max(sampled, run - .05); }
      }
    }
    expect(sampled).toBeLessThanOrEqual(l.length + 1e-9);
    expect(sampled).toBeGreaterThan(l.length - .2);
  });

  it('builds §2.2 ribbons with a convex bevel at each corner', () => {
    const spine = [{ id: 'a', x: 0, z: 0 }, { id: 'b', x: 0, z: 40 }, { id: 'c', x: 40, z: 40 }];
    const pieces = ribbonPieces(spine, 12);
    expect(pieces).toHaveLength(3);
    // Ribbon, ribbon, then the bevel filling the outer corner at (-6,46).
    expect(longestSegment(pieces).length).toBeGreaterThan(40);
    expect(longestSegment([pieces[0]!]).length).toBeCloseTo(Math.hypot(40, 12), 9);
  });

  it('proves two areas cannot see each other only when a straight view must leave the surface', () => {
    const disc = (x: number, z: number) => ({ x, z, r: 5 });
    const straight = { polygons: [rect(-10, -6, 110, 6)], discs: [] };
    const seen = discsSeeEachOther(straight, disc(0, 0), disc(100, 0));
    expect(seen.visible).toBe(true);
    expect(seen.witness!.length).toBeGreaterThan(100);
    // A dog-leg: the corridor turns through a 30 m square with no straight view
    // from one end to the other.
    const dogleg = { polygons: [rect(-10, -6, 30, 6), rect(18, -6, 30, 50), rect(18, 38, 110, 50)], discs: [] };
    const hidden = discsSeeEachOther(dogleg, disc(0, 0), disc(100, 44));
    expect(hidden.visible).toBe(false);
    expect(hidden.lines).toBeGreaterThan(1000);
    // The grown margin is conservative: a 0.2 m slit still counts as a view.
    const slit = { polygons: [rect(-10, -6, 30, 6), rect(30, -.1, 70, .1), rect(70, -6, 110, 6)], discs: [] };
    expect(discsSeeEachOther(slit, disc(0, 0), disc(100, 0)).visible).toBe(true);
    expect(() => discsSeeEachOther(straight, disc(0, 0), disc(100, 0), { stepDeg: 1 })).toThrow(/slack/);
  });

  it('bounds the farthest view from an area from above', () => {
    const corridor = { polygons: [rect(-10, -6, 110, 6)], discs: [] };
    const view = farthestView(corridor, { x: 0, z: 0, r: 5 }, 200);
    // The true longest view runs through the disc's centre from its far side to
    // an east corner: |(110,6)| + 5 m. The grown bound adds at most the margin.
    const exact = Math.hypot(110, 6) + 5;
    expect(view.length).toBeGreaterThanOrEqual(exact);
    expect(view.length).toBeLessThanOrEqual(exact + .6);
    expect(() => farthestView(corridor, { x: 0, z: 0, r: 5 }, 60)).toThrow(/certified/);
  });
});
