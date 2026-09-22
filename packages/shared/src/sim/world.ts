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
 * DATA, NOT CODE. Cover comes from `data/worlds/<id>.json` (standing rule 4),
 * and the generated pieces — the distance-post grid, the sprint-lane rails,
 * the reference figure — are built here from the same numbers the client used
 * to hard-code, for the worlds whose file asks for them. Positions are what
 * the renderer draws; there is no second copy.
 *
 * NAMED WORLDS (T-3.02). A world is a value, chosen by id: a session is built
 * with one, names it in `JoinAck`, and the client builds the same boxes from
 * the same file with the same function (`getWorld`). `range` is the QA range
 * this list always was, and the default. A world file is imported statically
 * below rather than read from disk, because this module runs in the page too.
 */
import RANGE_WORLD from '../data/worlds/range.json' with { type: 'json' };
import { POSITION } from '../net/quantize.ts';

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

/** Validate a world file's `cover` list, as weapons.json is validated. */
export function loadCover(raw: unknown = RANGE_WORLD): WorldBox[] {
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

/** The generated pieces a world file may ask for, in the order they are laid down. */
export const GENERATED_PIECES = ['posts', 'rails', 'figure'] as const;
export type GeneratedPiece = (typeof GENERATED_PIECES)[number];

/** A named world: the one value every consumer of the scenery reads. */
export interface World {
  id: string;
  boxes: readonly WorldBox[];
}

/** A world id is what travels in `JoinAck`: short, lowercase, no spaces. */
const WORLD_ID = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * Build a world from its file. Everything solid, in a fixed order — generated
 * pieces as `GENERATED_PIECES` orders them, then cover — so indices are
 * stable across client and server, which the renderer relies on for nothing
 * yet but a hit event might one day name a box by it.
 */
export function loadWorld(raw: unknown): World {
  if (typeof raw !== 'object' || raw === null) throw new Error('world file: expected an object');
  const file = raw as { id?: unknown; generate?: unknown };
  if (typeof file.id !== 'string' || !WORLD_ID.test(file.id)) {
    throw new Error(`world file: id must match ${WORLD_ID}, got ${JSON.stringify(file.id)}`);
  }
  const generate = file.generate ?? [];
  if (!Array.isArray(generate) || !generate.every((g) => (GENERATED_PIECES as readonly unknown[]).includes(g))) {
    throw new Error(`world '${file.id}': generate must list only ${GENERATED_PIECES.join(', ')}`);
  }
  const wants = (piece: GeneratedPiece): boolean => generate.includes(piece);
  return {
    id: file.id,
    boxes: [
      ...(wants('posts') ? postBoxes() : []),
      ...(wants('rails') ? railBoxes() : []),
      ...(wants('figure') ? [figureBox()] : []),
      ...loadCover(raw),
    ],
  };
}

/** Every world this build knows, by id. Validated once, at import. */
const WORLDS: ReadonlyMap<string, World> = new Map(
  [RANGE_WORLD].map((raw) => {
    const world = loadWorld(raw);
    return [world.id, world] as const;
  }),
);

/** The world a session gets when nobody names one. */
export const DEFAULT_WORLD_ID = 'range';

/** The ids `getWorld` answers for. */
export const WORLD_IDS: readonly string[] = [...WORLDS.keys()];

/** The world with this id, or undefined when this build does not have it. */
export function getWorld(id: string): World | undefined {
  return WORLDS.get(id);
}

/** Like `getWorld`, for an id that must exist; throws with the known ids when it does not. */
export function requireWorld(id: string): World {
  const world = WORLDS.get(id);
  if (!world) throw new Error(`unknown world '${id}' (this build has: ${WORLD_IDS.join(', ')})`);
  return world;
}

/**
 * The range world's boxes. The default world every pure function falls back
 * to when a caller passes none — tests, benches, and the lobby backdrop. A
 * session never relies on it: it is built with a world and passes it on.
 */
export const DEFAULT_WORLD: readonly WorldBox[] = requireWorld(DEFAULT_WORLD_ID).boxes;

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
  /**
   * Outward unit normal of the face the ray entered through (T-2.30), all
   * zeroes when the ray began inside the box and there is no entry face.
   * A hitscan ray only ever needed where it stopped; a grenade needs to know
   * which way to bounce, and the slab test already computes it.
   */
  normal: { x: number; y: number; z: number };
}

/**
 * Nearest box along a ray, or null. Slab method; only arithmetic and
 * comparison, so the answer is identical on every engine.
 *
 * A ray starting inside a box hits it at distance 0. An axis the ray does not
 * move along is a miss if the origin is outside that slab and ignored if inside
 * — spelled out rather than left to `1/0`, whose `0 * Infinity` is NaN.
 *
 * `inflate` grows every box by that much on all three axes, which turns the
 * centre ray into a swept SPHERE of that radius (T-2.30). Exact for the faces,
 * generous at the corners by up to the radius — a grenade that clips a corner
 * bounces a hair early, which is the harmless direction to be wrong in, and it
 * keeps one slab test rather than a second capsule-per-edge implementation.
 */
export function rayWorld(
  ray: WorldRay,
  world: readonly WorldBox[],
  inflate = 0,
): WorldHit | null {
  const { origin: o, direction: d, maxDistance } = ray;
  let best: WorldBox | null = null;
  let bestT = maxDistance;
  /** Axis (0/1/2) and sign of the face the ray entered through, or -1 inside. */
  let bestAxis = -1;
  let bestSign = 0;
  for (const box of world) {
    let tNear = 0;
    let tFar = bestT;
    let miss = false;
    let axisIndex = -1;
    let axisSign = 0;
    for (const axis of ['x', 'y', 'z'] as const) {
      const oa = o[axis];
      const da = d[axis];
      const lo = (axis === 'x' ? box.minX : axis === 'y' ? box.minY : box.minZ) - inflate;
      const hi = (axis === 'x' ? box.maxX : axis === 'y' ? box.maxY : box.maxZ) + inflate;
      if (da === 0) {
        if (oa < lo || oa > hi) {
          miss = true;
          break;
        }
        continue;
      }
      let t1 = (lo - oa) / da;
      let t2 = (hi - oa) / da;
      // WHICH face is the near one follows from the direction's sign, and the
      // swap below is about to throw that information away.
      const sign = da > 0 ? -1 : 1;
      if (t1 > t2) {
        const swap = t1;
        t1 = t2;
        t2 = swap;
      }
      if (t1 > tNear) {
        tNear = t1;
        axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
        axisSign = sign;
      }
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
      bestAxis = axisIndex;
      bestSign = axisSign;
    }
  }
  if (best === null) return null;
  return {
    box: best,
    distance: bestT,
    point: { x: o.x + d.x * bestT, y: o.y + d.y * bestT, z: o.z + d.z * bestT },
    normal: {
      x: bestAxis === 0 ? bestSign : 0,
      y: bestAxis === 1 ? bestSign : 0,
      z: bestAxis === 2 ? bestSign : 0,
    },
  };
}

export interface WorldSurface {
  box: WorldBox;
  /** Outward unit normal of the face, axis-aligned. */
  normal: { x: number; y: number; z: number };
  /** The point snapped onto the face along its normal. */
  point: { x: number; y: number; z: number };
}

/**
 * How far a wire point may sit off a face and still be on it: one position
 * quantum. Hit events carry positions at wire precision (T-1.02), so the
 * server's exact stopping point arrives rounded by up to half a step.
 */
export const WIRE_POINT_TOLERANCE_M = POSITION.step;

/**
 * The face of the world a point lies on, or null (T-2.11).
 *
 * The server's hit event carries a point and nothing else. When the target
 * is netId 0 that point is EITHER where a round stopped on scenery OR the end
 * of a ray that hit nothing, at max range in the air; the message does not
 * say which, and a client that drew an impact at every such point would
 * paint marks in the sky. This tells them apart from the geometry: a point
 * within `tolerance` of a box face is on that face, with that face's normal.
 * The ground is not in the server's world, so a shot into it is a miss here
 * as it is there, which is honest: nobody confirmed a round stopped on it.
 *
 * The default tolerance is the wire's own position step, because the point
 * has been through the wire; the returned point is snapped back onto the
 * face so a mark drawn there sits ON the wall, not a few millimetres off it.
 *
 * Pure comparison and subtraction, so it is safe under ADR-014.
 */
export function surfaceAt(
  point: { x: number; y: number; z: number },
  world: readonly WorldBox[],
  tolerance = WIRE_POINT_TOLERANCE_M,
): WorldSurface | null {
  let best: WorldSurface | null = null;
  let bestGap = tolerance;
  for (const box of world) {
    if (
      point.x < box.minX - tolerance || point.x > box.maxX + tolerance ||
      point.y < box.minY - tolerance || point.y > box.maxY + tolerance ||
      point.z < box.minZ - tolerance || point.z > box.maxZ + tolerance
    ) {
      continue;
    }
    // [gap, normal, the snapped point]
    const faces: [number, number, number, number, { x: number; y: number; z: number }][] = [
      [Math.abs(point.x - box.minX), -1, 0, 0, { x: box.minX, y: point.y, z: point.z }],
      [Math.abs(point.x - box.maxX), 1, 0, 0, { x: box.maxX, y: point.y, z: point.z }],
      [Math.abs(point.y - box.minY), 0, -1, 0, { x: point.x, y: box.minY, z: point.z }],
      [Math.abs(point.y - box.maxY), 0, 1, 0, { x: point.x, y: box.maxY, z: point.z }],
      [Math.abs(point.z - box.minZ), 0, 0, -1, { x: point.x, y: point.y, z: box.minZ }],
      [Math.abs(point.z - box.maxZ), 0, 0, 1, { x: point.x, y: point.y, z: box.maxZ }],
    ];
    for (const [gap, x, y, z, snapped] of faces) {
      if (gap <= bestGap) {
        bestGap = gap;
        best = { box, normal: { x, y, z }, point: snapped };
      }
    }
  }
  return best;
}

/**
 * The highest surface under a footprint that is no higher than `below`: a box
 * top, or `groundY` when none qualifies (T-2.21). The same rule the
 * controller's vertical step uses to land, lifted out so a vault can ask
 * where it will come down before it commits.
 */
export function supportUnder(
  x: number,
  z: number,
  half: number,
  below: number,
  world: readonly WorldBox[],
  groundY: number,
): number {
  let support = groundY;
  for (const box of world) {
    if (box.maxY <= below && box.maxY > support && overlapsFootprint(x, z, half, box)) support = box.maxY;
  }
  return support;
}

/**
 * True when something a soldier of `height` standing at `feet` could neither
 * step onto nor pass under overlaps the footprint (T-2.21): the controller's
 * "blocks" rule, as a question about a place rather than a move.
 */
export function blockedAt(
  x: number,
  z: number,
  half: number,
  feet: number,
  stepHeight: number,
  height: number,
  world: readonly WorldBox[],
): boolean {
  for (const box of world) {
    if (box.maxY > feet + stepHeight && box.minY < feet + height && overlapsFootprint(x, z, half, box)) return true;
  }
  return false;
}

/** True when a square footprint of half-size `half` at (x, z) overlaps the box in the ground plane. */
export function overlapsFootprint(x: number, z: number, half: number, box: WorldBox): boolean {
  return x + half > box.minX && x - half < box.maxX && z + half > box.minZ && z - half < box.maxZ;
}
