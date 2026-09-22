/**
 * Offline navmesh bake (T-3.01, ADR-006).
 *
 * Recast turns a triangle soup into a navmesh; Detour exports it as bytes the
 * server loads through `NavMesh.load`. Baking happens here, in the tools
 * package, and never in a session: geometry is static (ADR-002), so a runtime
 * bake would spend server budget every session on a result that never changes.
 *
 * T-3.01's spike bakes a hand-built soup (a floor and a few boxes) with agent
 * parameters written out below; its bytes stay committed for the
 * cross-runtime test. T-3.03 bakes each named world with parameters derived
 * from `MoveConfig` and the hitbox (`bakeWorld`), and `pnpm gen:nav` commits
 * the result per world with a staleness hash (`navBakeHash`).
 */
import { createHash } from 'node:crypto';
import { type OffMeshConnectionParams, exportNavMesh, init } from '@recast-navigation/core';
import { type SoloNavMeshGeneratorConfig, generateSoloNavMesh } from '@recast-navigation/generators';
import {
  DEFAULT_MOVE_CONFIG,
  type MoveConfig,
  type World,
  createMoveState,
  supportUnder,
  tryStartVault,
} from '@sandline/shared';
import {
  NAV_AREA_VAULT,
  NAV_FLAG_VAULT,
  NAV_FLAG_WALK,
  NavMesh,
  initNav,
} from '../../../server/src/ai/nav/NavMesh.ts';
import { DEFAULT_HITBOX, type Hitbox } from '../../../server/src/net/lagComp.ts';

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

/* -- Named worlds (T-3.03) --------------------------------------------------- */

/**
 * The agent a world is baked for, derived — never typed in a second time —
 * from the numbers the controller and the server already use: the body's
 * radius (the larger of the controller's footprint and the server's hit
 * capsule, so the mesh never lets a soldier path somewhere their capsule
 * would not fit), the standing height, and the step a soldier climbs without
 * a jump.
 */
export interface NavAgent {
  radius: number;
  height: number;
  climb: number;
  groundY: number;
  /**
   * The vault rule's own numbers (T-3.04), carried so the staleness hash
   * covers them: retuning the vault changes which boxes get a link.
   */
  vaultMaxHeight: number;
  vaultDistance: number;
  vaultProbe: number;
}

export function navAgentFrom(move: MoveConfig, hitbox: Hitbox): NavAgent {
  return {
    radius: Math.max(move.radius, hitbox.radius),
    height: move.height,
    climb: move.stepHeight,
    groundY: move.groundY,
    vaultMaxHeight: move.vaultMaxHeight,
    vaultDistance: move.vaultDistance,
    vaultProbe: move.vaultProbe,
  };
}

/**
 * The controller config the vault predicate is asked with: today's defaults
 * with every field the agent carries laid over them, so a link is generated
 * for exactly the agent the mesh was baked for.
 */
function moveConfigFor(agent: NavAgent): MoveConfig {
  return {
    ...DEFAULT_MOVE_CONFIG,
    radius: agent.radius,
    height: agent.height,
    stepHeight: agent.climb,
    groundY: agent.groundY,
    vaultMaxHeight: agent.vaultMaxHeight,
    vaultDistance: agent.vaultDistance,
    vaultProbe: agent.vaultProbe,
  };
}

/** The agent the committed bakes are for: today's movement and hitbox defaults. */
export const DEFAULT_NAV_AGENT = navAgentFrom(DEFAULT_MOVE_CONFIG, DEFAULT_HITBOX);

/**
 * Voxel size, 0.1 m across and 0.05 m up. Recast erodes by whole voxels, so
 * the 0.35 m radius rounds UP to 0.4 m: the mesh stays 5 cm further from a
 * wall than the capsule needs, which is the safe direction to be wrong in.
 */
export const NAV_CELL = { cs: 0.1, ch: 0.05 } as const;

export function navConfigFor(agent: NavAgent): Partial<SoloNavMeshGeneratorConfig> {
  return {
    cs: NAV_CELL.cs,
    ch: NAV_CELL.ch,
    walkableRadius: Math.ceil(agent.radius / NAV_CELL.cs),
    walkableHeight: Math.ceil(agent.height / NAV_CELL.ch),
    walkableClimb: Math.floor(agent.climb / NAV_CELL.ch),
    walkableSlopeAngle: 45,
  };
}

/**
 * A named world as a triangle soup: its floor at `groundY` and every box as a
 * closed cuboid (tops walkable, sides walls). Only the tops a soldier can
 * reach within `climb` join the floor's mesh; the rest become islands no
 * path can reach, which is what they are.
 */
export function worldSoup(world: World, groundY = DEFAULT_NAV_AGENT.groundY): TriangleSoup {
  const soup = boxSoup(
    world.floorHalfExtent,
    world.boxes.map((b) => ({ min: [b.minX, b.minY, b.minZ], max: [b.maxX, b.maxY, b.maxZ] }) as const),
  );
  if (groundY !== 0) for (let i = 1; i < 12; i += 3) soup.positions[i] = groundY;
  return soup;
}

/**
 * Everything that decides a bake, hashed: the world (id, floor, every box,
 * in order), the agent and the voxel grid. The committed bake stores this;
 * a test recomputes it from the live data, so an edited box, a retuned step
 * height or a new capsule radius fails until `pnpm gen:nav` is re-run.
 */
export function navBakeHash(world: World, agent: NavAgent = DEFAULT_NAV_AGENT): string {
  const inputs = {
    world: {
      id: world.id,
      floorHalfExtent: world.floorHalfExtent,
      boxes: world.boxes.map((b) => [b.id, b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ]),
    },
    agent,
    config: navConfigFor(agent),
    // How vault links are searched for and kept (T-3.04). The vault rule's
    // own numbers are in `agent`; the rule itself is the controller's code.
    links: { spacing: LINK_SPACING_M, approachMargin: APPROACH_MARGIN_M, endOnMesh: LINK_END_ON_MESH_M },
  };
  return createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
}

/* -- Vault links (T-3.04) ----------------------------------------------------- */

/** One vault a soldier could make: walk to `from`, face `yaw`, vault to `to`. */
export interface VaultLink {
  box: string;
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  /** The four axis directions, as wire yaw (1024 per turn): +Z 0, +X 256, −Z 512, −X 768. */
  yaw: number;
}

/**
 * How far off a face the approach point stands: the body's radius plus a
 * margin, so it sits just inside the mesh (eroded by a whole voxel beyond
 * the radius) while the vault probe still reaches the box.
 */
const APPROACH_MARGIN_M = NAV_CELL.cs;
/** Approach points along a long face, at most this far apart. */
const LINK_SPACING_M = 2;

/** The four facings, as the controller reads them: forward is (sin yaw, cos yaw). */
const FACINGS = [
  { yaw: 0, dirX: 0, dirZ: 1 },
  { yaw: 256, dirX: 1, dirZ: 0 },
  { yaw: 512, dirX: 0, dirZ: -1 },
  { yaw: 768, dirX: -1, dirZ: 0 },
] as const;

/**
 * Every vault the controller would make, found by ASKING it (T-2.21's
 * `tryStartVault`), not by restating its rule. For each box and each of its
 * four faces, a soldier stands just off the face at points along it, facing
 * in; where the controller says it would vault, the link runs from there to
 * where the vault lands. Each side is asked separately, so a box that can be
 * vaulted both ways gets a link each way, and one whose far side has no
 * landing gets only the links that can actually happen.
 */
export function vaultLinks(world: World, agent: NavAgent = DEFAULT_NAV_AGENT): VaultLink[] {
  const config = moveConfigFor(agent);
  const half = agent.radius;
  const stand = half + APPROACH_MARGIN_M;
  const links: VaultLink[] = [];
  for (const box of world.boxes) {
    for (const f of FACINGS) {
      // The face the soldier walks at, and the span along it they can stand on.
      const alongX = f.dirX === 0;
      const lo = (alongX ? box.minX : box.minZ) + half;
      const hi = (alongX ? box.maxX : box.maxZ) - half;
      const face = f.dirX > 0 ? box.minX : f.dirX < 0 ? box.maxX : f.dirZ > 0 ? box.minZ : box.maxZ;
      const count = hi <= lo ? 1 : Math.max(1, Math.ceil((hi - lo) / LINK_SPACING_M) + 1);
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * i) / (count - 1);
        const x = alongX ? t : face - f.dirX * stand;
        const z = alongX ? face - f.dirZ * stand : t;
        const y = supportUnder(x, z, half, agent.groundY + agent.climb, world.boxes, agent.groundY);
        const vault = tryStartVault(createMoveState(x, y, z), f.yaw, f.dirX, f.dirZ, config, world.boxes);
        if (!vault) continue;
        const toX = x + f.dirX * config.vaultDistance;
        const toZ = z + f.dirZ * config.vaultDistance;
        const toY = supportUnder(toX, toZ, half, vault.topY + config.stepHeight, world.boxes, config.groundY);
        links.push({ box: box.id, from: { x, y, z }, to: { x: toX, y: toY, z: toZ }, yaw: f.yaw });
      }
    }
  }
  return links;
}

/** How close a link end must be, across the ground, to the mesh to count as on it. */
export const LINK_END_ON_MESH_M = NAV_CELL.cs;

/** True when a point is on the mesh: close across the ground and within a step vertically. */
export function onMesh(mesh: NavMesh, p: { x: number; y: number; z: number }, climb: number): boolean {
  const near = mesh.nearestPoint(p);
  if (!near) return false;
  const across = Math.sqrt((near.point.x - p.x) ** 2 + (near.point.z - p.z) ** 2);
  return across <= LINK_END_ON_MESH_M && Math.abs(near.point.y - p.y) <= climb;
}

/**
 * The vault links that can join the mesh: both ends on it. The controller
 * will happily vault onto a surface the mesh does not reach — the 0.3 m top
 * of the low wall walked along lengthwise, the top of a post — and a link to
 * nowhere is not a route, so the mesh is baked once without links to find
 * out which ends it has.
 */
export async function meshVaultLinks(world: World, agent: NavAgent = DEFAULT_NAV_AGENT): Promise<VaultLink[]> {
  await initNav();
  const bare = NavMesh.load(await bakeNavMesh(worldSoup(world, agent.groundY), navConfigFor(agent)));
  const kept = vaultLinks(world, agent).filter((l) => onMesh(bare, l.from, agent.climb) && onMesh(bare, l.to, agent.climb));
  bare.destroy();
  return kept;
}

/** Bake a named world for an agent: the mesh, and a vault link for every vault the controller would make onto it. */
export async function bakeWorld(world: World, agent: NavAgent = DEFAULT_NAV_AGENT): Promise<Uint8Array> {
  const offMeshConnections: OffMeshConnectionParams[] = (await meshVaultLinks(world, agent)).map((link) => ({
    startPosition: link.from,
    endPosition: link.to,
    radius: agent.radius,
    bidirectional: false,
    area: NAV_AREA_VAULT,
    flags: NAV_FLAG_WALK | NAV_FLAG_VAULT,
  }));
  return bakeNavMesh(worldSoup(world, agent.groundY), { ...navConfigFor(agent), offMeshConnections });
}
