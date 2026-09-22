/**
 * The navmesh as the server sees it (T-3.01, ADR-006).
 *
 * WHY A WRAPPER. `@recast-navigation/core` exposes the whole of Detour. M3
 * needs three questions of a baked mesh — where is the nearest walkable point,
 * how do I get from here to there, and can I walk straight there — so that is
 * all this exposes. Everything downstream (path following, cover selection,
 * avoidance) is written against this surface, which keeps the WASM's object
 * lifetimes and status codes in one file.
 *
 * WHERE IT RUNS. Server-side logic, but not only on the host: the in-page
 * session (`LocalServer`) constructs a real `Session` in the browser, so this
 * must initialise in Chromium, Firefox and WebKit as well as in Node. The
 * default `@recast-navigation/wasm` entry is the "compat" build, which carries
 * the WASM inline as base64 — no second file to serve, no bundler plugin, the
 * same import in every runtime.
 *
 * WHAT IT DOES NOT DO. Bake. Meshes are baked offline in `packages/tools`
 * (ADR-006) and arrive here as bytes. AI is not parity-critical (§2.3): a path
 * may differ by a few millimetres between engines and nothing reconciles it.
 */
import {
  NavMeshQuery,
  type NavMesh as DetourNavMesh,
  importNavMesh,
  init,
} from '@recast-navigation/core';

export interface NavPoint {
  x: number;
  y: number;
  z: number;
}

export interface NavPath {
  /** Polygon refs from start to end — the corridor path following walks. */
  corridor: number[];
  /** The string-pulled path: start, each corner, end. */
  points: NavPoint[];
  /**
   * Indices into `points` where a vault link starts (T-3.04): the leg from
   * `points[i]` to `points[i + 1]` is a vault, walked into with forward
   * intent, not a straight walk.
   */
  vaults: number[];
}

/**
 * Polygon flags and areas the bake writes (T-3.04). Walkable ground is
 * Recast's default (area 0, flag 1); a vault link is flagged walk AND vault,
 * so the default query filter paths across it and a caller can tell it apart.
 */
export const NAV_FLAG_WALK = 1;
export const NAV_FLAG_VAULT = 2;
export const NAV_AREA_VAULT = 1;
/** Detour's straight-path flag for a point that starts an off-mesh connection. */
const DT_STRAIGHTPATH_OFFMESH_CONNECTION = 4;

/** One off-mesh link baked into the mesh (T-3.04). */
export interface NavLink {
  from: NavPoint;
  to: NavPoint;
  /** Flagged as a vault: walk into it with forward intent. */
  vault: boolean;
}

export interface NavRaycast {
  /** True when the ray met a mesh boundary before reaching its end. */
  hit: boolean;
  /** Fraction of the segment travelled before the hit (1 when clear). */
  t: number;
  /** Point along the segment where the ray stopped. */
  point: NavPoint;
}

/**
 * How far off the mesh a query point may be and still find it. Half a metre
 * across and two metres vertically: a soldier's feet are on the floor, a
 * baked surface sits a voxel or so above it, and a goal picked from a box top
 * is still findable.
 */
const QUERY_HALF_EXTENTS: NavPoint = { x: 0.5, y: 2, z: 0.5 };
const MAX_CORRIDOR = 256;

let ready: Promise<void> | null = null;
let initialised = false;

/**
 * Initialise the Recast WASM. Idempotent: every caller awaits the same
 * promise. Must resolve before a session's first tick in whichever runtime is
 * hosting it — `SessionHost.start` on the host, `LocalServer.create` in the
 * page.
 */
export function initNav(): Promise<void> {
  ready ??= init().then(() => {
    initialised = true;
  });
  return ready;
}

/** Whether `initNav` has resolved in this runtime. */
export function isNavReady(): boolean {
  return initialised;
}

export class NavMesh {
  private readonly query: NavMeshQuery;

  private constructor(private readonly mesh: DetourNavMesh) {
    this.query = new NavMeshQuery(mesh, { maxNodes: 2048 });
    this.query.defaultQueryHalfExtents = { ...QUERY_HALF_EXTENTS };
  }

  /** Load a mesh baked and exported by `packages/tools/src/nav/bake.ts`. */
  static load(bytes: Uint8Array): NavMesh {
    if (!initialised) throw new Error('NavMesh.load before initNav() resolved');
    const { navMesh } = importNavMesh(bytes);
    return new NavMesh(navMesh);
  }

  /** Nearest point on the mesh, or null when nothing is within the query extents. */
  nearestPoint(p: NavPoint): { point: NavPoint; polyRef: number } | null {
    const r = this.query.findClosestPoint(p);
    if (!r.success || r.polyRef === 0) return null;
    return { point: { x: r.point.x, y: r.point.y, z: r.point.z }, polyRef: r.polyRef };
  }

  /** Corridor and straight path between two points, or null when there is none. */
  path(from: NavPoint, to: NavPoint): NavPath | null {
    const start = this.nearestPoint(from);
    const end = this.nearestPoint(to);
    if (!start || !end) return null;
    const found = this.query.findPath(start.polyRef, end.polyRef, start.point, end.point, {
      maxPathPolys: MAX_CORRIDOR,
    });
    if (!found.success || found.polys.size === 0) {
      found.polys.destroy();
      return null;
    }
    const corridor: number[] = [];
    for (let i = 0; i < found.polys.size; i++) corridor.push(found.polys.get(i));
    // A partial corridor ends short of the goal: string-pull to the corridor's
    // own end point, not the goal, or the last leg crosses unwalkable ground.
    const last = corridor[corridor.length - 1];
    const goal = last === end.polyRef ? end.point : this.query.closestPointOnPoly(last ?? 0, end.point).closestPoint;
    const straight = this.query.findStraightPath(start.point, goal, found.polys, {
      maxStraightPathPoints: MAX_CORRIDOR,
    });
    found.polys.destroy();
    if (!straight.success) {
      straight.straightPath.destroy();
      straight.straightPathFlags.destroy();
      straight.straightPathRefs.destroy();
      return null;
    }
    const points: NavPoint[] = [];
    const vaults: number[] = [];
    const flat = straight.straightPath;
    for (let i = 0; i < straight.straightPathCount; i++) {
      points.push({ x: flat.get(i * 3), y: flat.get(i * 3 + 1), z: flat.get(i * 3 + 2) });
      if ((straight.straightPathFlags.get(i) & DT_STRAIGHTPATH_OFFMESH_CONNECTION) !== 0) {
        const flags = this.mesh.getPolyFlags(straight.straightPathRefs.get(i));
        if ((flags.flags & NAV_FLAG_VAULT) !== 0) vaults.push(i);
      }
    }
    flat.destroy();
    straight.straightPathFlags.destroy();
    straight.straightPathRefs.destroy();
    return { corridor, points, vaults };
  }

  /**
   * Walk a straight line along the mesh surface from `from` toward `to`.
   * Null when `from` is not on the mesh.
   */
  raycast(from: NavPoint, to: NavPoint): NavRaycast | null {
    const start = this.nearestPoint(from);
    if (!start) return null;
    const r = this.query.raycast(start.polyRef, start.point, to);
    if (!r.success) return null;
    // Detour reports a clear ray as t = FLT_MAX.
    const t = r.t > 1 ? 1 : r.t;
    const s = start.point;
    return {
      hit: r.t <= 1,
      t,
      point: { x: s.x + (to.x - s.x) * t, y: s.y + (to.y - s.y) * t, z: s.z + (to.z - s.z) * t },
    };
  }

  /** Every off-mesh link in the mesh, as baked. */
  links(): NavLink[] {
    const out: NavLink[] = [];
    for (let t = 0; t < this.mesh.getMaxTiles(); t++) {
      const tile = this.mesh.getTile(t);
      const header = tile.header();
      if (!header) continue;
      // A connection's own flags() are its direction bits; the vault flag is
      // on the polygon Detour made for it, found by the tile's base ref.
      const base = this.mesh.getPolyRefBase(tile);
      for (let i = 0; i < header.offMeshConCount(); i++) {
        const con = tile.offMeshCons(i);
        const polyFlags = this.mesh.getPolyFlags(base + con.poly()).flags;
        out.push({
          from: { x: con.pos(0), y: con.pos(1), z: con.pos(2) },
          to: { x: con.pos(3), y: con.pos(4), z: con.pos(5) },
          vault: (polyFlags & NAV_FLAG_VAULT) !== 0,
        });
      }
    }
    return out;
  }

  destroy(): void {
    this.query.destroy();
    this.mesh.destroy();
  }
}

/** Length of a polyline, summed segment by segment. */
export function pathLength(points: readonly NavPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2 + (b.z - a.z) ** 2);
  }
  return total;
}
