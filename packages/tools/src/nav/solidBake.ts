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
  type UnsignedCharArray,
  type Vector3Tuple,
  Detour,
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
  NavMeshParams,
  NavMeshCreateParams,
  rasterizeTriangles,
  recastConfigDefaults,
  statusFailed,
} from '@recast-navigation/core';
import {
  buildTiledNavMeshRcConfig,
  tiledNavMeshGeneratorConfigDefaults,
  type SoloNavMeshGeneratorConfig,
  type TiledNavMeshGeneratorConfig,
} from '@recast-navigation/generators';
import type { SoupBox, TriangleSoup } from './bake.ts';

/** rcCompactCell::index is a 24-bit field. */
export const MAX_COMPACT_SPANS = 1 << 24;

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
  const data = solidNavMeshData(soup, solids, generatorConfig);
  if (!data) throw new Error('could not create an empty solo navmesh');
  const navMesh = new NavMesh();
  try {
    if (!navMesh.initSolo(data)) {
      data.destroy();
      throw new Error('could not initialise solo navmesh');
    }
    return exportNavMesh(navMesh);
  } finally { navMesh.destroy(); }
}

/**
 * Opt-in tiled bake for an isolated map that exceeds Recast's 24-bit span
 * budget. Each tile runs the same solid/headroom pipeline as the solo bake,
 * including neighbouring geometry in the erosion border. Detour joins the
 * resulting edges; this does not add route links or change the agent size.
 */
export async function bakeSolidTiledNavMesh(
  soup: TriangleSoup,
  solids: readonly SoupBox[],
  generatorConfig: Partial<TiledNavMeshGeneratorConfig>,
): Promise<Uint8Array> {
  await init();
  const config = { ...tiledNavMeshGeneratorConfigDefaults, ...generatorConfig };
  if (!Number.isInteger(config.tileSize) || config.tileSize <= 0) throw new Error('tileSize must be a positive integer');
  const extent = bounds(soup);
  const [min, max] = config.bounds ?? [extent.min, extent.max];
  const tiled = buildTiledNavMeshRcConfig({ recastConfig: config, navMeshBounds: [min, max] });
  const mesh = new NavMesh();
  const params = NavMeshParams.create({
    orig: tiled.orig, tileWidth: tiled.tcs, tileHeight: tiled.tcs,
    maxTiles: tiled.maxTiles, maxPolys: tiled.maxPolysPerTile,
  });
  try {
    if (!mesh.initTiled(params)) throw new Error('could not initialise tiled navmesh');
    const padding = tiled.config.borderSize * config.cs;
    for (let z = 0; z < tiled.tileHeight; z++) for (let x = 0; x < tiled.tileWidth; x++) {
      const lo: Vector3Tuple = [min[0] + x * tiled.tcs - padding, min[1], min[2] + z * tiled.tcs - padding];
      const hi: Vector3Tuple = [min[0] + (x + 1) * tiled.tcs + padding, max[1], min[2] + (z + 1) * tiled.tcs + padding];
      const data = solidNavMeshData(soup, solids, { ...config, bounds: [lo, hi], borderSize: tiled.config.borderSize }, { x, z });
      // A full map may take over a minute under a busy test runner. Yield
      // between tiles so progress messages and worker RPCs can be serviced.
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (!data) continue;
      const added = mesh.addTile(data, Detour.DT_TILE_FREE_DATA, 0);
      if (statusFailed(added.status)) {
        data.destroy();
        throw new Error(`could not add navmesh tile ${x},${z}: ${added.status}`);
      }
    }
    return exportNavMesh(mesh);
  } finally { mesh.destroy(); }
}

/** The shared rasterizer; tiles only change bounds and reserve erosion padding. */
function solidNavMeshData(
  soup: TriangleSoup,
  solids: readonly SoupBox[],
  generatorConfig: Partial<SoloNavMeshGeneratorConfig>,
  tile?: { x: number; z: number },
): UnsignedCharArray | undefined {
  const config = { ...recastConfigDefaults, buildBvTree: true, ...generatorConfig };
  const rc = createRcConfig(config);
  rc.minRegionArea = rc.minRegionArea * rc.minRegionArea;
  rc.mergeRegionArea = rc.mergeRegionArea * rc.mergeRegionArea;
  rc.detailSampleDist = rc.detailSampleDist < 0.9 ? 0 : rc.cs * rc.detailSampleDist;
  rc.detailSampleMaxError = rc.ch * rc.detailSampleMaxError;
  const extent = bounds(soup);
  const [min, max] = generatorConfig.bounds ?? [extent.min, extent.max];
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
    // Recast indexes compact spans in 24 bits and does not check: past that
    // every later stage silently corrupts (U-160 found it as an empty mesh).
    if (compact.spanCount() >= MAX_COMPACT_SPANS) {
      throw new Error(`${compact.spanCount()} spans exceed Recast's ${MAX_COMPACT_SPANS} compact-span limit; bake a smaller area or tile the mesh`);
    }
    if (!erodeWalkableArea(context, rc.walkableRadius, compact)) throw new Error('could not erode walkable area');

    // U-125: the inside of every solid box is no one's ground.
    const inset = rc.cs / 2;
    for (const { min: lo, max: hi } of solids) {
      markBoxArea(context, [lo[0] + inset, lo[1] - rc.ch, lo[2] + inset], [hi[0] - inset, hi[1] - 2 * rc.ch, hi[2] - inset], Recast.RC_NULL_AREA, compact);
    }

    if (!buildDistanceField(context, compact)) throw new Error('could not build distance field');
    if (!buildRegions(context, compact, rc.borderSize, rc.minRegionArea, rc.mergeRegionArea)) throw new Error('could not build regions');
    if (!buildContours(context, compact, rc.maxSimplificationError, rc.maxEdgeLen, contours, Recast.RC_CONTOUR_TESS_WALL_EDGES)) throw new Error('could not build contours');
    if (tile && contours.nconts() === 0) return undefined;
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
    if (tile) {
      params.setTileX(tile.x);
      params.setTileY(tile.z);
    }
    const created = createNavMeshData(params);
    if (!created.success) throw new Error('could not create Detour navmesh data');
    return created.navMeshData;
  } finally {
    freeHeightfield(heightfield);
    freeCompactHeightfield(compact);
    freeContourSet(contours);
    freePolyMesh(polyMesh);
    freePolyMeshDetail(detail);
  }
}
