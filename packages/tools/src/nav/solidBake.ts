/**
 * U-125: Recast's solo navmesh pipeline, step for step as
 * `@recast-navigation/generators`' `generateSoloNavMeshData` runs it, with
 * the area-marking step the Recast sample leaves optional filled in: every
 * solid box's inside is marked unwalkable.
 *
 * Recast rasterizes a box's faces, not its volume. A box standing on the
 * ground (or sunk into a slab) leaves the floor inside it covered only by the
 * box's top, high overhead — open, headroom-enough ground that Recast bakes
 * into a walkable island nobody can reach and nothing should snap to (§14.2.7:
 * no walking under the map). Boxes are solid to the controller, so their inside
 * is never ground. Marking happens after erosion, as in the Recast sample, so
 * nothing outside a box changes; tops stay walkable.
 */
import {
  type OffMeshConnectionParams,
  Recast,
  RecastBuildContext,
  TriangleAreasArray,
  TrianglesArray,
  VerticesArray,
  allocCompactHeightfield,
  allocContourSet,
  allocHeightfield,
  allocPolyMesh,
  allocPolyMeshDetail,
  buildCompactHeightfield,
  buildContours,
  buildDistanceField,
  buildPolyMesh,
  buildPolyMeshDetail,
  buildRegions,
  calcGridSize,
  createHeightfield,
  createNavMeshData,
  createRcConfig,
  erodeWalkableArea,
  exportNavMesh,
  filterLedgeSpans,
  filterLowHangingWalkableObstacles,
  filterWalkableLowHeightSpans,
  freeCompactHeightfield,
  freeContourSet,
  freeHeightfield,
  freePolyMesh,
  freePolyMeshDetail,
  init,
  markBoxArea,
  markWalkableTriangles,
  NavMesh,
  NavMeshCreateParams,
  rasterizeTriangles,
  recastConfigDefaults,
} from '@recast-navigation/core';
import type { SoloNavMeshGeneratorConfig } from '@recast-navigation/generators';
import type { SoupBox, TriangleSoup } from './bake.ts';

/** The world-space corners of a soup's triangles. */
function bounds(soup: TriangleSoup): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const index of soup.indices) {
    for (let axis = 0; axis < 3; axis++) {
      const v = soup.positions[index * 3 + axis]!;
      if (v < min[axis]!) min[axis] = v;
      if (v > max[axis]!) max[axis] = v;
    }
  }
  return { min, max };
}

/**
 * Bake `soup` to Detour bytes, with the inside of every box in `solids`
 * unwalkable: across it inset half a cell (so no neighbouring cell outside is
 * touched), from a cell below its base to two cells below its top (so its own
 * top, and anything resting on it, stays walkable).
 */
export async function bakeSolidNavMesh(
  soup: TriangleSoup,
  solids: readonly SoupBox[],
  generatorConfig: Partial<SoloNavMeshGeneratorConfig> & { offMeshConnections?: OffMeshConnectionParams[] },
): Promise<Uint8Array> {
  await init();
  const config = { ...recastConfigDefaults, buildBvTree: true, ...generatorConfig };
  const rc = createRcConfig(config);
  rc.minRegionArea = rc.minRegionArea * rc.minRegionArea;
  rc.mergeRegionArea = rc.mergeRegionArea * rc.mergeRegionArea;
  rc.detailSampleDist = rc.detailSampleDist < 0.9 ? 0 : rc.cs * rc.detailSampleDist;
  rc.detailSampleMaxError = rc.ch * rc.detailSampleMaxError;
  const { min, max } = bounds(soup);
  const grid = calcGridSize(min, max, rc.cs);
  rc.width = grid.width;
  rc.height = grid.height;

  const context = new RecastBuildContext();
  const heightfield = allocHeightfield();
  const compact = allocCompactHeightfield();
  const contours = allocContourSet();
  const polyMesh = allocPolyMesh();
  const detail = allocPolyMeshDetail();
  try {
    if (!createHeightfield(context, heightfield, rc.width, rc.height, min, max, rc.cs, rc.ch)) throw new Error('could not create heightfield');
    const vertices = new VerticesArray();
    vertices.copy(soup.positions);
    const triangles = new TrianglesArray();
    triangles.copy(soup.indices);
    const triangleCount = soup.indices.length / 3;
    const areas = new TriangleAreasArray();
    areas.resize(triangleCount);
    markWalkableTriangles(context, rc.walkableSlopeAngle, vertices, soup.indices.length, triangles, triangleCount, areas);
    const rasterized = rasterizeTriangles(context, vertices, soup.indices.length, triangles, areas, triangleCount, heightfield, rc.walkableClimb);
    areas.destroy();
    vertices.destroy();
    triangles.destroy();
    if (!rasterized) throw new Error('could not rasterize triangles');

    filterLowHangingWalkableObstacles(context, rc.walkableClimb, heightfield);
    filterLedgeSpans(context, rc.walkableHeight, rc.walkableClimb, heightfield);
    filterWalkableLowHeightSpans(context, rc.walkableHeight, heightfield);
    if (!buildCompactHeightfield(context, rc.walkableHeight, rc.walkableClimb, heightfield, compact)) throw new Error('could not build compact heightfield');
    if (!erodeWalkableArea(context, rc.walkableRadius, compact)) throw new Error('could not erode walkable area');

    // U-125: the inside of every solid box is no one's ground.
    const inset = rc.cs / 2;
    for (const { min: lo, max: hi } of solids) {
      markBoxArea(context, [lo[0] + inset, lo[1] - rc.ch, lo[2] + inset], [hi[0] - inset, hi[1] - 2 * rc.ch, hi[2] - inset], Recast.RC_NULL_AREA, compact);
    }

    if (!buildDistanceField(context, compact)) throw new Error('could not build distance field');
    if (!buildRegions(context, compact, rc.borderSize, rc.minRegionArea, rc.mergeRegionArea)) throw new Error('could not build regions');
    if (!buildContours(context, compact, rc.maxSimplificationError, rc.maxEdgeLen, contours, Recast.RC_CONTOUR_TESS_WALL_EDGES)) throw new Error('could not build contours');
    if (!buildPolyMesh(context, contours, rc.maxVertsPerPoly, polyMesh)) throw new Error('could not triangulate contours');
    if (!buildPolyMeshDetail(context, polyMesh, compact, rc.detailSampleDist, rc.detailSampleMaxError, detail)) throw new Error('could not build detail mesh');

    // As the generator does: walkable polygons become area 0 with flag 1 (walk).
    for (let i = 0; i < polyMesh.npolys(); i++) {
      if (polyMesh.areas(i) === Recast.RC_WALKABLE_AREA) polyMesh.setAreas(i, 0);
      if (polyMesh.areas(i) === 0) polyMesh.setFlags(i, 1);
    }
    const params = new NavMeshCreateParams();
    params.setPolyMeshCreateParams(polyMesh);
    params.setPolyMeshDetailCreateParams(detail);
    params.setWalkableHeight(rc.walkableHeight * rc.ch);
    params.setWalkableRadius(rc.walkableRadius * rc.cs);
    params.setWalkableClimb(rc.walkableClimb * rc.ch);
    params.setCellSize(rc.cs);
    params.setCellHeight(rc.ch);
    params.setBuildBvTree(config.buildBvTree);
    if (generatorConfig.offMeshConnections) params.setOffMeshConnections(generatorConfig.offMeshConnections);
    const created = createNavMeshData(params);
    if (!created.success) throw new Error('could not create Detour navmesh data');
    const navMesh = new NavMesh();
    if (!navMesh.initSolo(created.navMeshData)) {
      created.navMeshData.destroy();
      throw new Error('could not initialise solo navmesh');
    }
    const bytes = exportNavMesh(navMesh);
    navMesh.destroy();
    return bytes;
  } finally {
    freeHeightfield(heightfield);
    freeCompactHeightfield(compact);
    freeContourSet(contours);
    freePolyMesh(polyMesh);
    freePolyMeshDetail(detail);
  }
}
