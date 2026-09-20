/**
 * The static world: what stops a soldier and what stops a shot (T-1.12).
 *
 * ONE LIST, FOUR CONSUMERS. The character controller collides with it, the
 * server resolves hitscan against it, the client renders it and raycasts it
 * for aim convergence and predicted tracers, and the camera arm collides with
 * it. Until this existed each of those had its own idea of the scenery: the
 * posts were decoration the client drew and nothing else knew about, so a
 * player walked through a post that stopped the camera and a shot passed
 * through a post that stopped the player's eye. Every aiming bug this project
 * has shipped came from two of those sets disagreeing (note 16 in the
 * handoffs). They cannot disagree about a list they all read.
 *
 * AXIS-ALIGNED BOXES, PURE ARITHMETIC. The plan named a Rapier kinematic
 * controller for this. Boxes in pure `+ - * /` were chosen instead, for the
 * reason §2.3 gives: arithmetic and comparison are exactly specified by
 * IEEE-754, so client and server agree bit-for-bit on every engine with no
 * WASM in the prediction path, and the parity test asserts zero rather than a
 * bound. Rapier stays for anything dynamic (ADR-005 addendum). What boxes
 * cannot express — slopes, stairs beyond a step, round columns — is not in
 * this world and is not what a firefight in a grey box needs first.
 *
 * DATA, NOT CODE. Cover comes from `data/world.json` (standing rule 4), and
 * the generated pieces — the distance-post grid, the sprint-lane rails, the
 * reference figure — are built here from the same numbers the client used to
 * hard-code. Positions are what the renderer draws; there is no second copy.
 */
import RAW_WORLD from '../data/world.json' with { type: 'json' };

export type WorldBoxKind = 'post-minor' | 'post-major' | 'rail' | 'figure' | 'cover';

/** An axis-aligned box in world space. Ready for the arithmetic, not authoring. */
export interface WorldBox {
  id: string;
  kind: WorldBoxKind;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Authoring form: centre x/z, BOTTOM y, full sizes. What world.json holds. */
export interface BoxSpec {
  id: string;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
}

export function boxFrom(spec: BoxSpec, kind: WorldBoxKind): WorldBox {
  return {
    id: spec.id,
    kind,
    minX: spec.x - spec.w / 2,
    minY: spec.y,
    minZ: spec.z - spec.d / 2,
    maxX: spec.x + spec.w / 2,
    maxY: spec.y + spec.h,
    maxZ: spec.z + spec.d / 2,
  };
}

/** Centre and full size of a box, for a renderer that thinks in those terms. */
export function boxCentre(box: WorldBox): { x: number; y: number; z: number; w: number; h: number; d: number } {
  return {
    x: (box.minX + box.maxX) / 2,
    y: (box.minY + box.maxY) / 2,
    z: (box.minZ + box.maxZ) / 2,
    w: box.maxX - box.minX,
    h: box.maxY - box.minY,
    d: box.maxZ - box.minZ,
  };
}

/**
 * The distance-post grid: every 10 m across the playable area, taller every
 * 20 m so distance stays countable, spawn cell left clear. The same numbers
 * the client drew from T-0.06 on; now they are solid — which is why the x = 0
 * column north of spawn is gone. Now that a post stops a shot, a post 2.5 m
 * beside the firing lane sat inside the fan from the left-hand spawn slots to
 * the far targets, and the range test that has held since T-1.17 failed on
 * the 20 m target. Distance up-range is still countable from the x = ±10
 * columns.
 */
export const POST_GRID = {
  spacing: 10,
  extent: 40,
  minor: { width: 0.18, height: 1.4 },
  major: { width: 0.22, height: 2.6 },
} as const;

export function postBoxes(): WorldBox[] {
  const out: WorldBox[] = [];
  const { spacing, extent, minor, major } = POST_GRID;
  for (let gx = -extent; gx <= extent; gx += spacing) {
    for (let gz = -extent; gz <= extent; gz += spacing) {
      if (gx === 0 && gz >= 0) continue; // spawn cell, and the firing lane
      const isMajor = gx % 20 === 0 && gz % 20 === 0;
      const size = isMajor ? major : minor;
      out.push(
        boxFrom(
          { id: `post ${gx},${gz}`, x: gx, y: 0, z: gz, w: size.width, h: size.height, d: size.width },
          isMajor ? 'post-major' : 'post-minor',
        ),
      );
    }
  }
  return out;
}

/** The 10 m sprint lane at spawn: two rails a soldier steps over. */
export function railBoxes(): WorldBox[] {
  return [-1.2, 1.2].map((z) =>
    boxFrom({ id: `rail ${z > 0 ? 'left' : 'right'}`, x: 5, y: 0, z, w: 10, h: 0.05, d: 0.12 }, 'rail'),
  );
}

/**
 * The 1.8 m reference figure, as the box its capsule fits in. The client still
 * draws it as a capsule; the box is what it collides and stops shots with.
 */
export function figureBox(): WorldBox {
  // 4.5 m left of the spawn line's centre: at 3 m it stood in the firing fan
  // from the leftmost slot to the far targets, now that it stops a shot.
  return boxFrom({ id: 'reference figure', x: -4.5, y: 0, z: 3, w: 0.7, h: 1.8, d: 0.7 }, 'figure');
}

function isSpec(value: unknown): value is BoxSpec {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['id'] === 'string' &&
    ['x', 'y', 'z', 'w', 'h', 'd'].every((k) => typeof v[k] === 'number' && Number.isFinite(v[k] as number))
  );
}

/** Validate world.json once at import, as weapons.json is. */
export function loadCover(raw: unknown = RAW_WORLD): WorldBox[] {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { cover?: unknown }).cover)) {
    throw new Error('world.json: expected { cover: [...] }');
  }
  const seen = new Set<string>();
  return (raw as { cover: unknown[] }).cover.map((entry, i) => {
    if (!isSpec(entry)) throw new Error(`world.json: cover[${i}] is not a box spec`);
    if (entry.w <= 0 || entry.h <= 0 || entry.d <= 0) throw new Error(`world.json: cover[${i}] '${entry.id}' has a non-positive size`);
    if (seen.has(entry.id)) throw new Error(`world.json: duplicate id '${entry.id}'`);
    seen.add(entry.id);
    return boxFrom(entry, 'cover');
  });
}

/**
 * Everything solid. The order is fixed — posts, rails, figure, cover — so
 * indices are stable across client and server, which the renderer relies on
 * for nothing yet but a hit event might one day name a box by it.
 */
export const DEFAULT_WORLD: readonly WorldBox[] = [
  ...postBoxes(),
  ...railBoxes(),
  figureBox(),
  ...loadCover(),
];

export interface WorldRay {
  origin: { x: number; y: number; z: number };
  /** Expected to be unit length. */
  direction: { x: number; y: number; z: number };
  maxDistance: number;
}

export interface WorldHit {
  box: WorldBox;
  distance: number;
  point: { x: number; y: number; z: number };
}

/**
 * Nearest box along a ray, or null. Slab method; only arithmetic and
 * comparison, so the answer is identical on every engine.
 *
 * A ray starting inside a box hits it at distance 0. An axis the ray does not
 * move along is a miss if the origin is outside that slab and ignored if inside
 * — spelled out rather than left to `1/0`, whose `0 * Infinity` is NaN.
 */
export function rayWorld(ray: WorldRay, world: readonly WorldBox[]): WorldHit | null {
  const { origin: o, direction: d, maxDistance } = ray;
  let best: WorldBox | null = null;
  let bestT = maxDistance;
  for (const box of world) {
    let tNear = 0;
    let tFar = bestT;
    let miss = false;
    for (const axis of ['x', 'y', 'z'] as const) {
      const oa = o[axis];
      const da = d[axis];
      const lo = axis === 'x' ? box.minX : axis === 'y' ? box.minY : box.minZ;
      const hi = axis === 'x' ? box.maxX : axis === 'y' ? box.maxY : box.maxZ;
      if (da === 0) {
        if (oa < lo || oa > hi) {
          miss = true;
          break;
        }
        continue;
      }
      let t1 = (lo - oa) / da;
      let t2 = (hi - oa) / da;
      if (t1 > t2) {
        const swap = t1;
        t1 = t2;
        t2 = swap;
      }
      if (t1 > tNear) tNear = t1;
      if (t2 < tFar) tFar = t2;
      if (tNear > tFar) {
        miss = true;
        break;
      }
    }
    if (miss) continue;
    // tNear <= tFar <= bestT here; a strictly nearer box replaces the best.
    if (best === null || tNear < bestT) {
      best = box;
      bestT = tNear;
    }
  }
  if (best === null) return null;
  return {
    box: best,
    distance: bestT,
    point: { x: o.x + d.x * bestT, y: o.y + d.y * bestT, z: o.z + d.z * bestT },
  };
}

/** True when a square footprint of half-size `half` at (x, z) overlaps the box in the ground plane. */
export function overlapsFootprint(x: number, z: number, half: number, box: WorldBox): boolean {
  return x + half > box.minX && x - half < box.maxX && z + half > box.minZ && z - half < box.maxZ;
}
