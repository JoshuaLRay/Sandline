/**
 * Offline navmesh bake (T-3.01, ADR-006).
 *
 * Recast turns a triangle soup into a navmesh; Detour exports it as bytes the
 * server loads through `NavMesh.load`. Baking happens here, in the tools
 * package, and never in a session: geometry is static (ADR-002), so a runtime
 * bake would spend server budget every session on a result that never changes.
 *
 * T-3.01 is the spike: it bakes a hand-built soup (a floor and a few boxes)
 * with agent parameters written out below. T-3.03 replaces both with a named
 * world's boxes and parameters derived from `MoveConfig`, and commits the
 * result per world with a staleness hash.
 */
import { exportNavMesh, init } from '@recast-navigation/core';
import { type SoloNavMeshGeneratorConfig, generateSoloNavMesh } from '@recast-navigation/generators';

/** An axis-aligned box, min and max corners, in world metres. */
export interface SoupBox {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

export interface TriangleSoup {
  positions: number[];
  indices: number[];
}

/**
 * A square floor at y = 0 plus each box as a closed cuboid. Every triangle is
 * wound counter-clockwise seen from outside, so Recast's slope test sees the
 * floor and box tops as facing up and the sides as walls.
 */
export function boxSoup(floorHalfExtent: number, boxes: readonly SoupBox[]): TriangleSoup {
  const f = floorHalfExtent;
  const positions = [-f, 0, -f, f, 0, -f, f, 0, f, -f, 0, f];
  const indices = [0, 2, 1, 0, 3, 2];
  for (const { min, max } of boxes) {
    const o = positions.length / 3;
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    positions.push(
      x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1,
      x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1,
    );
    // Top, then the four sides. The bottom face sits on the floor and is never
    // walked, so it is left out.
    const faces = [
      [4, 6, 5], [4, 7, 6],
      [0, 5, 1], [0, 4, 5],
      [1, 6, 2], [1, 5, 6],
      [2, 7, 3], [2, 6, 7],
      [3, 4, 0], [3, 7, 4],
    ];
    for (const tri of faces) for (const i of tri) indices.push(i + o);
  }
  return { positions, indices };
}

/**
 * Spike agent parameters. Voxel size 0.1 m across and 0.05 m up; the agent is
 * the standing capsule — 0.35 m radius, 1.8 m tall — and climbs the 0.45 m
 * step. Recast takes radius, height and climb in voxels, hence the division.
 */
export const SPIKE_AGENT = { radius: 0.35, height: 1.8, climb: 0.45 } as const;
const CELL = 0.1;
const CELL_HEIGHT = 0.05;

export function spikeConfig(): Partial<SoloNavMeshGeneratorConfig> {
  return {
    cs: CELL,
    ch: CELL_HEIGHT,
    walkableRadius: Math.ceil(SPIKE_AGENT.radius / CELL),
    walkableHeight: Math.ceil(SPIKE_AGENT.height / CELL_HEIGHT),
    walkableClimb: Math.floor(SPIKE_AGENT.climb / CELL_HEIGHT),
    walkableSlopeAngle: 45,
  };
}

/**
 * The spike's geometry: a 40 m floor, a 2.4 m wall across the middle with a
 * gap at one end, and two crates. The wall forces a path that is not a
 * straight line, which is what makes a path-length comparison mean anything.
 */
export const SPIKE_BOXES: readonly SoupBox[] = [
  { min: [-1, 0, -20], max: [1, 2.4, 10] },
  { min: [-8, 0, 4], max: [-6.8, 1.2, 5.2] },
  { min: [6, 0, -6], max: [7.2, 1.2, -4.8] },
];
export const SPIKE_FLOOR_HALF_EXTENT = 20;

/** The spike's two query points, either side of the wall. */
export const SPIKE_FROM = { x: -10, y: 0, z: -10 } as const;
export const SPIKE_TO = { x: 10, y: 0, z: -10 } as const;

/** Initialise Recast, bake the soup, export the mesh. */
export async function bakeNavMesh(
  soup: TriangleSoup,
  config: Partial<SoloNavMeshGeneratorConfig> = spikeConfig(),
): Promise<Uint8Array> {
  await init();
  const result = generateSoloNavMesh(soup.positions, soup.indices, config);
  if (!result.success) throw new Error(`navmesh bake failed: ${result.error}`);
  const bytes = exportNavMesh(result.navMesh);
  result.navMesh.destroy();
  return bytes;
}
