/**
 * Cover query and reservation (T-3.19).
 *
 * "Best cover from these threats." The candidates are the world's baked cover
 * points (T-3.18) within a path distance of the asker; each is scored by
 *
 *   - **protection**: the fraction of threats whose eye has no line of sight
 *     to any of the point's concealed probes — shin, chest and eye of the body
 *     in the stance the point conceals (crouched behind low cover, standing
 *     behind high), traced through the same boxes the shots are;
 *   - **a firing position**: standing up at a low point, or a side step out of
 *     a high one, from which the soldier's eye can see the threat. A point
 *     without one hides a soldier who can do nothing from it, and is never
 *     chosen for combat;
 *   - **path cost**: metres walked to it, on the mesh when there is one;
 *   - **crowding**: friends standing within a radius of it.
 *
 * The chosen point is reserved by whoever chose it, so two brains asking at
 * once are given different points, and released when they leave it (having
 * reached it) or die. Whether a point still protects its holder as threats
 * move is `stillProtects`: a threat that walks round the crate makes it worth
 * nothing, and the holder should ask again (T-3.20 relocates on it).
 *
 * Server-only and never predicted (§7.9 rule 2). No randomness: ties go to the
 * earlier point in the baked order, so a run is reproducible.
 */
import { DEFAULT_MOVE_CONFIG, DEFAULT_MUZZLE_RIG, type MoveConfig, type WorldBox, rayWorld } from '@sandline/shared';
import type { CoverPoint } from './nav/baked/types.ts';
import { DEFAULT_HITBOX } from '../net/lagComp.ts';
import RAW_COVER from './cover.json' with { type: 'json' };

type Vec3 = { x: number; y: number; z: number };

/** Cover choice tuning (`cover.json`). */
export interface CoverConfig {
  /** Candidates further than this to walk are not considered, metres. */
  maxPathM: number;
  /** How far a soldier steps out along a high point's face to fire, metres. */
  sideStepM: number;
  /** Friends within this of a point crowd it, metres. */
  crowdRadiusM: number;
  /** A holder within this of its point has reached it, metres. */
  arriveM: number;
  /** A holder that has reached its point and is further than this has left it, metres. */
  leaveM: number;
  weights: { protection: number; firing: number; pathPerM: number; crowd: number };
}

// ---------------------------------------------------------------------------
// Tuning data — hand-validated, as avoidance.json is
// ---------------------------------------------------------------------------

class CoverDataError extends Error {}

function num(row: Record<string, unknown>, key: string, where: string, min: number, max: number): number {
  const v = row[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new CoverDataError(`${where}.${key} must be a finite number, got ${String(v)}`);
  if (v < min || v > max) throw new CoverDataError(`${where}.${key} must be in [${min}, ${max}], got ${v}`);
  return v;
}

function obj(raw: unknown, where: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new CoverDataError(`${where}: expected an object`);
  const row = raw as Record<string, unknown>;
  for (const k of Object.keys(row)) if (!keys.includes(k)) throw new CoverDataError(`${where}: unknown key "${k}"`);
  return row;
}

export function parseCoverConfig(raw: unknown): CoverConfig {
  const row = obj(raw, 'cover', ['$comment', 'maxPathM', 'sideStepM', 'crowdRadiusM', 'arriveM', 'leaveM', 'weights']);
  const w = obj(row['weights'], 'cover.weights', ['protection', 'firing', 'pathPerM', 'crowd']);
  const out: CoverConfig = {
    maxPathM: num(row, 'maxPathM', 'cover', 1, 500),
    sideStepM: num(row, 'sideStepM', 'cover', 0, 10),
    crowdRadiusM: num(row, 'crowdRadiusM', 'cover', 0, 50),
    arriveM: num(row, 'arriveM', 'cover', 0.05, 10),
    leaveM: num(row, 'leaveM', 'cover', 0.05, 50),
    weights: {
      protection: num(w, 'protection', 'cover.weights', 0, 1000),
      firing: num(w, 'firing', 'cover.weights', 0, 1000),
      pathPerM: num(w, 'pathPerM', 'cover.weights', 0, 1000),
      crowd: num(w, 'crowd', 'cover.weights', 0, 1000),
    },
  };
  // Leaving is further out than arriving, or a holder would release on arrival.
  if (out.leaveM < out.arriveM) throw new CoverDataError('cover: leaveM is below arriveM');
  return out;
}

/** The committed tuning, validated at import. */
export const COVER: CoverConfig = parseCoverConfig(RAW_COVER);

// ---------------------------------------------------------------------------
// Probes, protection and firing positions
// ---------------------------------------------------------------------------

/** Heights above the feet of the body a point conceals, and of the eye a soldier fires with. */
export interface CoverBody {
  /** Shin, chest and eye, standing. */
  standing: readonly number[];
  /** Shin, chest and eye, crouched. */
  crouched: readonly number[];
  /** The eye a soldier fires from, standing. */
  fireEye: number;
}

export function coverBodyFrom(move: MoveConfig = DEFAULT_MOVE_CONFIG): CoverBody {
  const eye = DEFAULT_MUZZLE_RIG.eyeHeight;
  const crouchedEye = move.crouchHeight - (move.height - eye);
  const shin = 0.3;
  return {
    standing: [shin, DEFAULT_HITBOX.centerOffsetY, eye],
    crouched: [shin, DEFAULT_HITBOX.crouchCenterOffsetY ?? DEFAULT_HITBOX.centerOffsetY, crouchedEye],
    fireEye: eye,
  };
}

export const DEFAULT_COVER_BODY = coverBodyFrom();

function clear(from: Vec3, to: Vec3, boxes: readonly WorldBox[]): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (length < 1e-9) return true;
  return rayWorld({ origin: from, direction: { x: dx / length, y: dy / length, z: dz / length }, maxDistance: length }, boxes) === null;
}

/** The concealed body's probes at a point: shin, chest and eye in the stance it hides. */
export function concealedProbes(point: CoverPoint, body: CoverBody = DEFAULT_COVER_BODY): Vec3[] {
  const heights = point.height === 'low' ? body.crouched : body.standing;
  return heights.map((h) => ({ x: point.x, y: point.y + h, z: point.z }));
}

/** Whether a point hides its concealed body from a threat's eye: no probe in sight. */
export function protects(point: CoverPoint, threatEye: Vec3, boxes: readonly WorldBox[], body: CoverBody = DEFAULT_COVER_BODY): boolean {
  for (const probe of concealedProbes(point, body)) if (clear(threatEye, probe, boxes)) return false;
  return true;
}

/**
 * Where a soldier at this point fires at the threat from, or null when
 * nowhere: standing up in place at a low point; a side step of `sideStepM`
 * along the face, either way, out of a high one. The standing eye there must
 * see the threat's eye, and the stepped-to feet must be clear of every box.
 */
export function firingPosition(
  point: CoverPoint,
  threatEye: Vec3,
  boxes: readonly WorldBox[],
  config: CoverConfig = COVER,
  body: CoverBody = DEFAULT_COVER_BODY,
): Vec3 | null {
  const sees = (feet: Vec3) => clear({ x: feet.x, y: feet.y + body.fireEye, z: feet.z }, threatEye, boxes);
  if (point.height === 'low') return sees(point) ? { x: point.x, y: point.y, z: point.z } : null;
  // Along the face: perpendicular to its normal.
  const tx = -point.nz;
  const tz = point.nx;
  for (const side of [1, -1]) {
    const feet = { x: point.x + tx * config.sideStepM * side, y: point.y, z: point.z + tz * config.sideStepM * side };
    if (footprintBlocked(feet, boxes)) continue;
    if (sees(feet)) return feet;
  }
  return null;
}

/** Whether a standing body's footprint at `feet` overlaps a box above ankle height. */
function footprintBlocked(feet: Vec3, boxes: readonly WorldBox[]): boolean {
  const r = DEFAULT_HITBOX.radius;
  for (const b of boxes) {
    if (b.maxY <= feet.y + DEFAULT_MOVE_CONFIG.stepHeight || b.minY >= feet.y + DEFAULT_MOVE_CONFIG.height) continue;
    const cx = Math.min(b.maxX, Math.max(b.minX, feet.x));
    const cz = Math.min(b.maxZ, Math.max(b.minZ, feet.z));
    if ((cx - feet.x) ** 2 + (cz - feet.z) ** 2 < r * r) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The query and the reservations
// ---------------------------------------------------------------------------

/** What an asker wants cover from, and who else is about. */
export interface CoverQuery {
  /** The asker's feet. */
  from: Vec3;
  /** Each threat's eye. */
  threats: readonly Vec3[];
  /** Friends' feet, for crowding. The asker itself is not one. */
  friends?: readonly Vec3[];
  /**
   * For combat (the default): only points with a firing position on at least
   * one threat. False for a point to hide at — reloading, or bleeding.
   */
  combat?: boolean;
}

export interface CoverChoice {
  /** Index into the system's points. */
  index: number;
  point: CoverPoint;
  score: number;
  /** Fraction of the threats it hides the concealed body from, 0..1. */
  protection: number;
  /** Where to fire at the first threat that can be seen from it, or null. */
  firingFrom: Vec3 | null;
  pathM: number;
}

/** Path metres from `a` to `b`, or null when there is no path. */
export type PathCost = (a: Vec3, b: Vec3) => number | null;

/** Straight-line distance: the path cost without a mesh (fixtures). */
export function straightLine(a: Vec3, b: Vec3): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2 + (b.z - a.z) ** 2);
}

/** One threat eye's view of every point (`CoverSystem.sightFrom`). */
interface ThreatSight {
  protects: readonly boolean[];
  firing: (index: number) => Vec3 | null;
}

/** Threat eyes remembered at once: a squad and then some, over a tick or two. */
const SIGHT_CACHE_SIZE = 64;

interface Reservation {
  index: number;
  arrived: boolean;
}

export class CoverSystem {
  private readonly heldBy = new Map<number, number>();
  private readonly held = new Map<number, Reservation>();

  constructor(
    readonly points: readonly CoverPoint[],
    private readonly boxes: readonly WorldBox[],
    private readonly pathCost: PathCost = straightLine,
    private readonly config: CoverConfig = COVER,
    private readonly body: CoverBody = DEFAULT_COVER_BODY,
  ) {}

  /**
   * The best point for `owner` against `query`, reserved for it — or null when
   * none is worth anything. Asking again releases what `owner` held before;
   * points others hold are not candidates.
   */
  choose(owner: number, query: CoverQuery): CoverChoice | null {
    this.release(owner);
    const best = this.search(query, owner, 1)[0] ?? null;
    if (best) {
      this.heldBy.set(best.index, owner);
      this.held.set(owner, { index: best.index, arrived: false });
    }
    return best;
  }

  /**
   * Every candidate worth anything, best first, without reserving. `owner`'s
   * own reservation, if any, does not exclude its point.
   */
  rank(query: CoverQuery, owner = -1): CoverChoice[] {
    return this.search(query, owner, Infinity);
  }

  /**
   * Candidates best first, stopping once `limit` are certain. Line of sight
   * and crowding are cheap; the path is not. So every candidate is scored
   * first with its STRAIGHT-LINE distance, which a path is never shorter than
   * — an optimistic score — and paths are found in that order only until the
   * next optimistic score cannot beat the `limit`-th real one. The answer is
   * exactly the one pathing every candidate would give (T-3.19's cost test
   * logs what this saves).
   */
  private search(query: CoverQuery, owner: number, limit: number): CoverChoice[] {
    const { weights, maxPathM, crowdRadiusM } = this.config;
    const combat = query.combat ?? true;
    const sights = query.threats.map((t) => this.sightFrom(t));
    const optimistic: { choice: CoverChoice; bound: number }[] = [];
    this.points.forEach((point, index) => {
      const holder = this.heldBy.get(index);
      if (holder !== undefined && holder !== owner) return;
      const straight = straightLine(query.from, point);
      if (straight > maxPathM) return;
      let hidden = 0;
      let firingFrom: Vec3 | null = null;
      for (const sight of sights) {
        if (sight.protects[index]) hidden++;
        firingFrom ??= sight.firing(index);
      }
      const protection = query.threats.length === 0 ? 0 : hidden / query.threats.length;
      if (protection === 0) return;
      if (combat && !firingFrom) return;
      let crowd = 0;
      for (const f of query.friends ?? []) if ((f.x - point.x) ** 2 + (f.z - point.z) ** 2 <= crowdRadiusM ** 2) crowd++;
      // A firing position is what combat asks for; to hide, it is worth nothing extra.
      const base = weights.protection * protection + (combat && firingFrom ? weights.firing : 0) - weights.crowd * crowd;
      optimistic.push({ choice: { index, point, score: base, protection, firingFrom, pathM: straight }, bound: base - weights.pathPerM * straight });
    });
    optimistic.sort((a, b) => b.bound - a.bound || a.choice.index - b.choice.index);
    const out: CoverChoice[] = [];
    for (const { choice, bound } of optimistic) {
      if (out.length >= limit && bound < out[limit - 1]!.score) break;
      this.pathQueries++;
      const pathM = this.pathCost(query.from, choice.point);
      if (pathM === null || pathM > maxPathM) continue;
      const scored = { ...choice, pathM, score: choice.score - weights.pathPerM * pathM };
      // Keep `out` sorted, best first, ties to the earlier point.
      let at = out.length;
      while (at > 0 && (out[at - 1]!.score < scored.score || (out[at - 1]!.score === scored.score && out[at - 1]!.index > scored.index))) at--;
      out.splice(at, 0, scored);
    }
    return out;
  }

  /** Path queries made so far, for the cost test. */
  pathQueries = 0;

  /**
   * What one threat's eye sees of every point: whether each hides its
   * concealed body, and (lazily, since most candidates never need it) where
   * each fires on it from. A function of the threat and the geometry alone —
   * not of who is asking — so the forty brains of a tick facing the same
   * soldiers share it rather than each tracing the same rays. Keyed by the
   * eye's exact position; bounded, so a threat that moves every tick costs a
   * new entry and no growth.
   */
  private sightFrom(threatEye: Vec3): ThreatSight {
    const key = `${threatEye.x},${threatEye.y},${threatEye.z}`;
    let sight = this.sights.get(key);
    if (!sight) {
      if (this.sights.size >= SIGHT_CACHE_SIZE) this.sights.clear();
      const protectsAll = this.points.map((p) => protects(p, threatEye, this.boxes, this.body));
      const firing = new Map<number, Vec3 | null>();
      sight = {
        protects: protectsAll,
        firing: (i) => {
          if (!firing.has(i)) firing.set(i, firingPosition(this.points[i]!, threatEye, this.boxes, this.config, this.body));
          return firing.get(i)!;
        },
      };
      this.sights.set(key, sight);
    }
    return sight;
  }

  private readonly sights = new Map<string, ThreatSight>();

  /** Whether `owner`'s point still hides it from every one of `threats`; false when it holds none. */
  stillProtects(owner: number, threats: readonly Vec3[]): boolean {
    const r = this.held.get(owner);
    if (!r) return false;
    const point = this.points[r.index]!;
    return threats.every((t) => protects(point, t, this.boxes, this.body));
  }

  /**
   * Each tick, for each holder: a dead one releases, one that has reached its
   * point is marked arrived, and one that arrived and has since gone further
   * than `leaveM` releases.
   */
  track(owner: number, feet: Vec3, alive: boolean): void {
    const r = this.held.get(owner);
    if (!r) return;
    if (!alive) {
      this.release(owner);
      return;
    }
    const point = this.points[r.index]!;
    const d2 = (feet.x - point.x) ** 2 + (feet.z - point.z) ** 2;
    if (d2 <= this.config.arriveM ** 2) r.arrived = true;
    else if (r.arrived && d2 > this.config.leaveM ** 2) this.release(owner);
  }

  release(owner: number): void {
    const r = this.held.get(owner);
    if (!r) return;
    this.held.delete(owner);
    this.heldBy.delete(r.index);
  }

  /** The point `owner` holds, or null. */
  heldPoint(owner: number): CoverPoint | null {
    const r = this.held.get(owner);
    return r ? this.points[r.index]! : null;
  }

  /** Who holds point `index`, or null. */
  holder(index: number): number | null {
    return this.heldBy.get(index) ?? null;
  }
}
