/**
 * Lag compensation (T-1.18, ADR-012).
 *
 * THE PROBLEM. A client sees the world as it was: snapshots take half a round
 * trip to arrive, and remote entities are then rendered a further
 * INTERPOLATION_DELAY_MS behind that so interpolation always has two samples to
 * work between (T-1.16). So when a player puts their reticle on a target and
 * fires, they are aiming at where that target was 100-200 ms ago. By the time
 * the fire command reaches the server the target has moved, and a naive
 * server-side raycast against current positions misses a shot that was, from
 * the only viewpoint the player has, dead on.
 *
 * THE FIX. Rewind: sample where each hitbox WAS at the time the firing client
 * was rendering, and trace against that.
 *
 * WHAT THIS COSTS, DELIBERATELY. Someone is always wrong about the world, and
 * rewinding chooses who. It favours the shooter, which means a player who has
 * already run behind cover on their own screen can still be killed by a shot
 * fired at them in the open. That is "I was shot behind cover", and ADR-012
 * takes it as a design position rather than a bug: the alternative is telling
 * the shooter their visibly-on-target shot missed, which reads as the game
 * being broken rather than as someone else's latency. MAX_REWIND_MS bounds how
 * wrong the victim can be.
 *
 * NO MUTATION, THEREFORE NO RESTORE. The textbook implementation moves the
 * colliders back, traces, and moves them forward again, which makes "restore"
 * a step that can be skipped on an early return and corrupt the world. Here the
 * history IS the source for the trace and live state is never touched, so there
 * is no restore step to get wrong.
 */

import { DEFAULT_WORLD, type WorldBox, rayWorld } from '@sandline/shared';

/**
 * How far back a shot may be rewound, whatever the client claims.
 *
 * ADR-012. This is the bound on how wrong a victim can be about their own
 * safety, so it is a gameplay constant, not a tuning detail. It is also the
 * defence against a client asserting a huge latency to shoot into the past.
 */
export const MAX_REWIND_MS = 200;

/**
 * How much history to keep per entity. Longer than MAX_REWIND_MS so a rewind to
 * the cap still has a sample on each side to interpolate between rather than
 * landing on the oldest edge and clamping.
 */
export const HISTORY_WINDOW_MS = 500;

/** Samples per entity. 500 ms at 30 Hz is 15; 32 leaves room for a faster tick. */
const DEFAULT_CAPACITY = 32;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * A hitbox: a capsule standing on the entity's feet position.
 *
 * One box for now. Head/torso/limb zones and their multipliers are T-1.19; this
 * returns the impact point so that classification has something to work from.
 */
export interface Hitbox {
  radius: number;
  /** Centre-to-cap-centre, so total height is 2 * (halfHeight + radius). */
  halfHeight: number;
  /** Capsule centre above the entity's ground position. */
  centerOffsetY: number;
  /** Crouched capsule geometry; feet remain the authoritative position. */
  crouchHalfHeight?: number;
  crouchCenterOffsetY?: number;
}

/** Matches the 1.8 m reference figure the movement harness is scaled against. */
export const DEFAULT_HITBOX: Hitbox = {
  radius: 0.35,
  halfHeight: 0.55,
  centerOffsetY: 0.9,
  crouchHalfHeight: 0.25,
  crouchCenterOffsetY: 0.6,
};

interface Sample {
  timeMs: number;
  x: number;
  y: number;
  z: number;
  crouched: boolean;
}

/**
 * Fixed-capacity ring of recent positions for one entity.
 *
 * Fixed capacity rather than a growing list because this is written to on every
 * tick for every entity for the life of the session; a structure that allocates
 * per sample would be the one piece of steady garbage in the tick loop.
 */
class Track {
  private readonly samples: Sample[] = [];
  private head = -1;
  private count = 0;

  constructor(private readonly capacity: number) {}

  record(timeMs: number, x: number, y: number, z: number, crouched = false): void {
    this.head = (this.head + 1) % this.capacity;
    const existing = this.samples[this.head];
    if (existing === undefined) {
      this.samples[this.head] = { timeMs, x, y, z, crouched };
    } else {
      existing.timeMs = timeMs;
      existing.x = x;
      existing.y = y;
      existing.z = z;
      existing.crouched = crouched;
    }
    if (this.count < this.capacity) this.count += 1;
  }

  /** Newest first. */
  private at(age: number): Sample | undefined {
    if (age >= this.count) return undefined;
    return this.samples[(this.head - age + this.capacity * 2) % this.capacity];
  }

  get newest(): Sample | undefined {
    return this.at(0);
  }

  /**
   * Position at `timeMs`, interpolated between the bracketing samples.
   *
   * Outside the retained window it clamps to the nearest end rather than
   * returning nothing: a shot that arrives later than expected should still
   * resolve against the oldest thing known, not silently fail to hit anything.
   * `windowMs` discards samples too old to be trusted.
   */
  sampleAt(timeMs: number, windowMs: number): Vec3 | null {
    const newest = this.at(0);
    if (newest === undefined) return null;
    if (timeMs >= newest.timeMs) return { x: newest.x, y: newest.y, z: newest.z };

    const horizon = newest.timeMs - windowMs;
    let older: Sample | undefined;
    let newer: Sample = newest;
    for (let age = 1; age < this.count; age += 1) {
      const candidate = this.at(age);
      if (candidate === undefined) break;
      if (candidate.timeMs < horizon) break;
      if (candidate.timeMs <= timeMs) {
        older = candidate;
        break;
      }
      newer = candidate;
    }

    if (older === undefined) {
      // Older than anything retained: clamp to the oldest sample still valid.
      return { x: newer.x, y: newer.y, z: newer.z };
    }

    const span = newer.timeMs - older.timeMs;
    if (span <= 0) return { x: older.x, y: older.y, z: older.z };
    const t = (timeMs - older.timeMs) / span;
    return {
      x: older.x + (newer.x - older.x) * t,
      y: older.y + (newer.y - older.y) * t,
      z: older.z + (newer.z - older.z) * t,
    };
  }
}

/** Per-entity position history, written once per tick by the session. */
export class HitboxHistory {
  private readonly tracks = new Map<number, Track>();

  constructor(
    private readonly windowMs: number = HISTORY_WINDOW_MS,
    private readonly capacity: number = DEFAULT_CAPACITY,
  ) {}

  record(netId: number, timeMs: number, x: number, y: number, z: number, crouched = false): void {
    let track = this.tracks.get(netId);
    if (track === undefined) {
      track = new Track(this.capacity);
      this.tracks.set(netId, track);
    }
    track.record(timeMs, x, y, z, crouched);
  }

  positionAt(netId: number, timeMs: number): Vec3 | null {
    const sample = this.tracks.get(netId)?.sampleAt(timeMs, this.windowMs);
    return sample === null ? null : { x: sample.x, y: sample.y, z: sample.z };
  }

  stateAt(netId: number, timeMs: number): { position: Vec3; crouched: boolean } | null {
    const sample = this.tracks.get(netId)?.sampleAt(timeMs, this.windowMs);
    return sample === null
      ? null
      : { position: { x: sample.x, y: sample.y, z: sample.z }, crouched: sample.crouched };
  }

  /** Newest recorded position, i.e. no rewind at all. */
  currentPosition(netId: number): Vec3 | null {
    const newest = this.tracks.get(netId)?.newest;
    return newest === undefined ? null : { x: newest.x, y: newest.y, z: newest.z };
  }

  netIds(): number[] {
    return [...this.tracks.keys()];
  }

  /** Drop an entity's history, e.g. when a slot is recycled. */
  forget(netId: number): void {
    this.tracks.delete(netId);
  }
}

/**
 * How far back this shot may look.
 *
 * The client's claimed render time is untrusted input. A hostile client
 * reporting five seconds of latency would otherwise get to shoot at where
 * everyone stood five seconds ago; a negative one would get to shoot into the
 * future. Both collapse to the same clamp.
 */
export function clampRewindMs(nowMs: number, clientRenderTimeMs: number): number {
  const requested = nowMs - clientRenderTimeMs;
  if (!Number.isFinite(requested) || requested < 0) return 0;
  return requested > MAX_REWIND_MS ? MAX_REWIND_MS : requested;
}

export interface Ray {
  origin: Vec3;
  /** Expected to be unit length. */
  direction: Vec3;
  maxDistance: number;
}

/**
 * Ray against a Y-axis-aligned capsule. Returns the distance along the ray, or
 * null. Only `Math.sqrt` and arithmetic, both exactly specified by IEEE-754.
 *
 * Infinite-cylinder test first, accepted only where it lands between the cap
 * centres; then each cap as a sphere. Nearest positive root wins.
 */
export function rayCapsule(ray: Ray, center: Vec3, radius: number, halfHeight: number): number | null {
  const { origin: o, direction: d, maxDistance } = ray;
  let best = Infinity;

  // Cylinder body: solve in the XZ plane, then bound the Y of the hit.
  const ox = o.x - center.x;
  const oz = o.z - center.z;
  const a = d.x * d.x + d.z * d.z;
  if (a > 1e-12) {
    const b = 2 * (ox * d.x + oz * d.z);
    const c = ox * ox + oz * oz - radius * radius;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
        if (t < 0 || t > maxDistance || t >= best) continue;
        const y = o.y + d.y * t - center.y;
        if (y >= -halfHeight && y <= halfHeight) best = t;
      }
    }
  }

  // Caps.
  for (const capY of [center.y - halfHeight, center.y + halfHeight]) {
    const px = o.x - center.x;
    const py = o.y - capY;
    const pz = o.z - center.z;
    const b = 2 * (px * d.x + py * d.y + pz * d.z);
    const c = px * px + py * py + pz * pz - radius * radius;
    const disc = b * b - 4 * c;
    if (disc < 0) continue;
    const root = Math.sqrt(disc);
    for (const t of [(-b - root) / 2, (-b + root) / 2]) {
      if (t < 0 || t > maxDistance || t >= best) continue;
      best = t;
    }
  }

  return best === Infinity ? null : best;
}

export interface ShotQuery {
  /** Excluded from the trace; you cannot shoot yourself. */
  shooterNetId: number;
  ray: Ray;
  /** Server time when the shot is being resolved. */
  nowMs: number;
  /**
   * The server time the firing client was RENDERING when it pulled the
   * trigger — roughly nowMs - rtt/2 - INTERPOLATION_DELAY_MS. Untrusted.
   */
  clientRenderTimeMs: number;
}

export interface ShotHit {
  /** 0 when the shot stopped on scenery rather than on an entity. */
  netId: number;
  distance: number;
  point: Vec3;
  /** Where the hitbox was taken from, for the hit event and for debugging. */
  rewoundTo: number;
  rewindMs: number;
}

/**
 * Resolve a hitscan shot against rewound hitboxes. Nearest hit wins, or null.
 *
 * `hitbox` is passed in rather than read from data so a test can state its own
 * geometry, per the rule that parity and behaviour tests own their constants.
 */
export function resolveShot(
  history: HitboxHistory,
  query: ShotQuery,
  hitbox: Hitbox = DEFAULT_HITBOX,
  world: readonly WorldBox[] = DEFAULT_WORLD,
): ShotHit | null {
  const rewindMs = clampRewindMs(query.nowMs, query.clientRenderTimeMs);
  const rewoundTo = query.nowMs - rewindMs;

  /**
   * Scenery first (T-1.12). A wall between the shooter and the target stops
   * the shot: any capsule hit beyond the first box is discarded, and a shot
   * that hits only scenery is reported as a hit on netId 0 at the point of
   * impact, so tracers end on the wall rather than flying to max range.
   * Scenery is static, so it is never rewound.
   */
  const scenery = rayWorld(query.ray, world);
  let best: ShotHit | null =
    scenery === null
      ? null
      : { netId: 0, distance: scenery.distance, point: scenery.point, rewoundTo, rewindMs };

  for (const netId of history.netIds()) {
    if (netId === query.shooterNetId) continue;
    const state = history.stateAt(netId, rewoundTo);
    if (state === null) continue;
    const feet = state.position;
    const halfHeight = state.crouched ? (hitbox.crouchHalfHeight ?? hitbox.halfHeight) : hitbox.halfHeight;
    const centerOffsetY = state.crouched ? (hitbox.crouchCenterOffsetY ?? hitbox.centerOffsetY) : hitbox.centerOffsetY;
    const center: Vec3 = { x: feet.x, y: feet.y + centerOffsetY, z: feet.z };
    const distance = rayCapsule(query.ray, center, hitbox.radius, halfHeight);
    if (distance === null) continue;
    if (best !== null && distance >= best.distance) continue;

    const { origin: o, direction: d } = query.ray;
    best = {
      netId,
      distance,
      point: {
        x: o.x + d.x * distance,
        y: o.y + d.y * distance,
        z: o.z + d.z * distance,
      },
      rewoundTo,
      rewindMs,
    };
  }
  return best;
}
