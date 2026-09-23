/**
 * Cover points in the bake (T-3.18).
 *
 * Every face of every box a soldier can stand against, sampled along its
 * length: where a soldier would stand with their back to the fire and the box
 * between. Generated offline with the navmesh, from the same world and the
 * same agent, and committed beside it under the same staleness hash — cover is
 * as static as the geometry it is made of (ADR-002), so a session never
 * searches for it; T-3.19 queries and reserves these.
 *
 * A point is kept only where a soldier can actually be: on the mesh (so
 * nothing is generated in a gap too narrow to stand in — the mesh is eroded
 * there), with the body's footprint clear of every box (so nothing is inside
 * a box, or wedged against a second one), and with the whole body behind the
 * face (so a face narrower than a soldier gives none — a post hides nobody).
 *
 * HEIGHT CLASS, from the box's top above where the soldier stands against the
 * crouched and standing eye heights:
 *   - **low**: above the crouched eye, below the standing one. Crouching
 *     conceals; standing up fires over it. The low wall, the crates.
 *   - **high**: at or above the standing eye. Standing conceals; firing means
 *     stepping out past its edge. The long walls.
 *   - below the crouched eye: no cover at all, and no point.
 */
import { DEFAULT_MOVE_CONFIG, DEFAULT_MUZZLE_RIG, type MoveConfig, type MuzzleRig, type World, supportUnder } from '@sandline/shared';
import type { CoverPoint } from '../../../server/src/ai/nav/baked/types.ts';
// Types only: `bake.ts` imports this file for the staleness hash, so nothing
// of its is needed here at run time and the two never form a load cycle.
import type { NavAgent } from './bake.ts';

/** Cover points along a long face, at most this far apart. */
export const COVER_SPACING_M = 1;
/**
 * How far off a face a point stands, beyond the body's radius: one voxel
 * (`NAV_CELL.cs`, checked in `cover.test.ts`), so it sits just inside the
 * mesh, which is eroded by a whole voxel past the radius (as a vault's
 * approach point does, T-3.04).
 */
export const COVER_MARGIN_M = 0.1;

/** The eye heights a height class is judged against. */
export interface CoverEyes {
  /** Standing eye above the feet. */
  standing: number;
  /**
   * Crouched eye above the feet: the crouched body's top less the same
   * crown-to-eye distance standing has. The rig carries no crouched eye of
   * its own (shots trace from standing unless prone, T-2.42).
   */
  crouched: number;
}

export function coverEyesFrom(move: MoveConfig = DEFAULT_MOVE_CONFIG, rig: MuzzleRig = DEFAULT_MUZZLE_RIG): CoverEyes {
  return { standing: rig.eyeHeight, crouched: move.crouchHeight - (move.height - rig.eyeHeight) };
}

/** The eyes the committed bakes are classed with. */
export const DEFAULT_COVER_EYES = coverEyesFrom();

/** Everything that decides the cover beyond the world and the agent, for the staleness hash. */
export function coverHashInputs(eyes: CoverEyes = DEFAULT_COVER_EYES): Record<string, unknown> {
  return { spacing: COVER_SPACING_M, margin: COVER_MARGIN_M, eyes };
}

/** The class a box top `heightM` above the feet gives, or null for none. */
export function heightClass(heightM: number, eyes: CoverEyes = DEFAULT_COVER_EYES): CoverPoint['height'] | null {
  if (heightM >= eyes.standing) return 'high';
  if (heightM > eyes.crouched) return 'low';
  return null;
}

function round(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

/** Outward normals of a box's four sides: the side a soldier stands on. */
const SIDES = [
  { nx: 0, nz: -1 },
  { nx: 0, nz: 1 },
  { nx: -1, nz: 0 },
  { nx: 1, nz: 0 },
] as const;

/** Whether a standing body's footprint at (x, y, z) overlaps any box above the step it can climb. */
export function bodyBlocked(x: number, y: number, z: number, world: World, agent: NavAgent): boolean {
  const r = agent.radius;
  for (const b of world.boxes) {
    if (b.maxY <= y + agent.climb || b.minY >= y + agent.height) continue;
    const cx = Math.min(b.maxX, Math.max(b.minX, x));
    const cz = Math.min(b.maxZ, Math.max(b.minZ, z));
    // Strictly inside the radius: a face exactly a radius away is touched, not entered.
    if ((cx - x) ** 2 + (cz - z) ** 2 < r * r - 1e-9) return true;
  }
  return false;
}

/**
 * Every cover point of a world, checked against its baked mesh — `isOnMesh`
 * is `bake.ts`'s `onMesh` over it. Ordered by box, then side, then along the
 * face, so a re-bake of unchanged data writes the same list.
 */
export function coverPoints(
  world: World,
  agent: NavAgent,
  isOnMesh: (p: { x: number; y: number; z: number }) => boolean,
  eyes: CoverEyes = DEFAULT_COVER_EYES,
): CoverPoint[] {
  const r = agent.radius;
  const stand = r + COVER_MARGIN_M;
  const out: CoverPoint[] = [];
  for (const box of world.boxes) {
    for (const { nx, nz } of SIDES) {
      // Along the face, the span where the whole body is behind it.
      const alongX = nx === 0;
      const lo = (alongX ? box.minX : box.minZ) + r;
      const hi = (alongX ? box.maxX : box.maxZ) - r;
      if (hi < lo) continue;
      const face = nx > 0 ? box.maxX : nx < 0 ? box.minX : nz > 0 ? box.maxZ : box.minZ;
      const count = Math.max(1, Math.ceil((hi - lo) / COVER_SPACING_M) + 1);
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * i) / (count - 1);
        // To a tenth of a millimetre, so the committed list reads cleanly and
        // re-bakes byte for byte; every check below is of the rounded point.
        const x = round(alongX ? t : face + nx * stand);
        const z = round(alongX ? face + nz * stand : t);
        const y = supportUnder(x, z, r, agent.groundY + agent.climb, world.boxes, agent.groundY);
        const height = heightClass(box.maxY - y, eyes);
        if (!height) continue;
        if (bodyBlocked(x, y, z, world, agent)) continue;
        if (!isOnMesh({ x, y, z })) continue;
        out.push({ box: box.id, x, y, z, nx, nz, height });
      }
    }
  }
  return out;
}

/** How many points of each class a list has, for the log line and the tests. */
export function coverCounts(points: readonly CoverPoint[]): { low: number; high: number; total: number } {
  let low = 0;
  let high = 0;
  for (const p of points) if (p.height === 'low') low++;
  else high++;
  return { low, high, total: points.length };
}
