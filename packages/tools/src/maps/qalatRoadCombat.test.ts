import { describe, expect, it } from 'vitest';
import type { BoxSpec } from '@sandline/shared';
import { rectPolygon } from './planStrata.ts';
import { certifySightBlockers, conservativeCombatView } from './qalatRoadCombatSight.ts';
import { ROAD_SUPPORTS, roadCombatReport, roadSightPieces } from './qalatRoadSupports.ts';

const rectangle = (minX: number, maxX: number, minZ: number, maxZ: number) => rectPolygon({ minX, maxX, minZ, maxZ });
const surface = { polygons: [rectangle(0, 100, -5, 5)], discs: [] };

describe('U-161 conservative physical-cover sight proof', () => {
  it('bounds the entire built road, all three fight aprons and both relocated riflemen below 90 m', () => {
    const report = roadCombatReport();
    expect(report.longestRoadView?.upperBoundM).toBeLessThanOrEqual(90);
    expect(report.ordinaryEyeDomain.map((p) => p.id)).toEqual(expect.arrayContaining(['A2', 'A4', 'A5', 'A8', 'AF2', 'AF3']));
    for (const id of ['A2', 'A4', 'A5', 'A8']) expect(report.ordinaryEyeDomain.find((p) => p.id === id)?.radiusM).toBe(18);
    for (const [id, view] of Object.entries(report.longestFightViews)) {
      expect(view.upperBoundM, `${id}: ${JSON.stringify(view.witness)}`).toBeLessThanOrEqual(90);
      expect(view.displacementM).toBeLessThanOrEqual(view.marginM);
    }
    expect(report.certification.occluders).toBeGreaterThan(20);
    expect(report.certification.checkedBands).toBeGreaterThan(500);
    const a5 = ROAD_SUPPORTS.spine.find((p) => p.id === 'A5')!;
    const before = conservativeCombatView(roadSightPieces().surface, [], { x: a5.x, z: a5.z, r: 18 });
    expect(before.upperBoundM).toBeGreaterThan(125);
  }, 180_000);

  it('bounds all continuous lines and every point of an eye area, including an unsampled diagonal', () => {
    const area = { x: 1, z: 0, r: 1 };
    const result = conservativeCombatView(surface, [], area, { reachM: 200, marginM: .2 });
    expect(result.upperBoundM).toBeGreaterThanOrEqual(Math.hypot(100, 5));
    expect(result.displacementM).toBeLessThanOrEqual(result.marginM);
    expect(result.upperBoundM).toBeLessThan(102);
    expect(result.sampledLines).toBeGreaterThan(10_000);
  });

  it('cuts the full line family with an eroded high solid, and detects its removal', () => {
    const blockers = [rectangle(45, 55, -6, 6)], area = { x: 1, z: 0, r: 1 };
    const options = { reachM: 200, marginM: .2 };
    expect(conservativeCombatView(surface, blockers, area, options).upperBoundM).toBeLessThan(47);
    expect(conservativeCombatView(surface, [], area, options).upperBoundM).toBeGreaterThan(100);
    expect(conservativeCombatView(surface, blockers, undefined, options).upperBoundM).toBeLessThan(47);
  });

  it('rejects a sampling family whose continuous-line displacement exceeds its erosion margin', () => {
    expect(() => conservativeCombatView(surface, [], { x: 1, z: 0, r: 1 }, { stepM: 2, marginM: .2 }))
      .toThrow(/displacement/);
    expect(() => conservativeCombatView(surface, [], { x: 1, z: 0, r: 1 }, { reachM: 50 }))
      .toThrow(/physical surface reach/);
  });

  it('rejects concave and degenerate inputs rather than claiming a convex clipping proof', () => {
    const concave = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 2, z: 2 }, { x: 5, z: 5 }, { x: 0, z: 5 }];
    expect(() => conservativeCombatView({ polygons: [concave], discs: [] }, []))
      .toThrow(/convex polygons/);
    expect(() => conservativeCombatView(surface, [[{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }]]))
      .toThrow(/convex polygons/);
  });

  it('excludes invalid square-controller endpoints without obstructing nearby ray interiors', () => {
    const thin = { polygons: [rectangle(0, 100, -.1, .1)], discs: [] };
    const blockers = [rectangle(45, 55, -1, 1)];
    const options = { reachM: 200, marginM: .2, surfaceExpansionM: 0 };
    const pointEyes = conservativeCombatView(thin, blockers, undefined, options);
    const standing = conservativeCombatView(thin, blockers, undefined, { ...options, endpointHalfSizeM: .35 });
    expect(pointEyes.upperBoundM - standing.upperBoundM).toBeGreaterThan(.3);
    // A ray above the wall passes through its controller-exclusion fringe.
    // Its distant endpoints remain valid, so that fringe must not cut the ray.
    const beside = { polygons: [rectangle(0, 100, 1.1, 1.2)], discs: [] };
    expect(conservativeCombatView(beside, blockers, undefined, { ...options, endpointHalfSizeM: .35 }).upperBoundM)
      .toBeGreaterThanOrEqual(100);
  });

  it('certifies the union of adjoining stepped boxes, without opening artificial strip seams', () => {
    const blockers = [rectangle(45, 55, -6, 6)];
    const boxes: BoxSpec[] = Array.from({ length: 120 }, (_, i) => ({
      id: `strip-${i}`, x: 50, y: 8, z: -6 + (i + .5) * .1, w: 10, h: 2.2, d: .1,
    }));
    expect(certifySightBlockers(blockers, boxes)).toMatchObject({ occluders: 1, floorY: 8, headHeightM: 1.8 });
    expect(() => certifySightBlockers(blockers, boxes.filter((b) => b.id !== 'strip-60'))).toThrow(/lacks actual high solid/);
    expect(() => certifySightBlockers(blockers, boxes.map((b) => ({ ...b, h: 1.1 })))).toThrow(/lacks actual high solid/);
  });
});
