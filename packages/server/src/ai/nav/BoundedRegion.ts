import { regionContains, regionContainsSegment, type NavigationRegion } from '@sandline/shared';
import { completePathLength, type NavMesh, type NavPath, type NavPoint } from './NavMesh.ts';

export type RegionPath = (from: NavPoint, to: NavPoint, searchM?: number) => NavPath | null;

/** An authored volume resolved to the navmesh's real floor polygons. No bake mutation. */
export class BoundedRegion {
  private readonly refs: ReadonlySet<number>;
  constructor(readonly volumes: NavigationRegion, private readonly mesh: NavMesh) {
    this.refs = new Set(mesh.polygons().filter((p) => volumes.some((v) =>
      Math.min(...p.corners.map((c) => c.x)) <= v.maxX && Math.max(...p.corners.map((c) => c.x)) >= v.minX &&
      Math.min(...p.corners.map((c) => c.y)) <= v.maxY && Math.max(...p.corners.map((c) => c.y)) >= v.minY &&
      Math.min(...p.corners.map((c) => c.z)) <= v.maxZ && Math.max(...p.corners.map((c) => c.z)) >= v.minZ,
    )).map((p) => p.ref));
  }

  contains(point: NavPoint): boolean { return regionContains(this.volumes, point); }
  segment(a: NavPoint, b: NavPoint): boolean { return regionContainsSegment(this.volumes, a, b); }

  path(from: NavPoint, to: NavPoint, searchM?: number, pricedPath?: RegionPath): NavPath | null {
    if (!this.contains(from) || !this.contains(to)) return null;
    const path = this.mesh.within(this.refs, () => pricedPath ? pricedPath(from, to, searchM) : this.mesh.path(from, to, searchM));
    if (completePathLength(path, from, to) === null) return null;
    const points = [from, ...path!.points, to];
    // Boundary polygons can span more than one prism. Validate every segment
    // against the exact union, including any narrow hole, rather than samples.
    if (points.some((p, i) => i > 0 && !this.segment(points[i - 1]!, p))) return null;
    return path;
  }
}
