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

import { DEFAULT_WORLD, type HitZone, type WorldBox, cos, rayWorld, sin, wireToTable, zoneAt } from '@sandline/shared';

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
 * A hitbox: the body as capsules on the entity's feet position.
 *
 * Standing is one vertical capsule, zoned by the impact's height up it
 * (T-1.19). Every other stance is shaped part by part, because its body is
 * not a short upright capsule: a crouch leans forward over its knees, and a
 * body on the ground is 1.9 m long and 0.5 m high, head toward its facing.
 * Those are a capsule per leg, torso, head and arm in the body's own frame,
 * fitted to the rig's skin in that pose and turning with the facing, each
 * carrying the zone it scores.
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
  /**
   * Prone as an upright capsule (T-2.40): lower again than crouch, feet
   * unchanged. Only read when `posed` has no prone body.
   */
  proneHalfHeight?: number;
  proneCenterOffsetY?: number;
  /**
   * Every stance but standing as capsules in the body's frame, turning with
   * its facing. A stance with none here falls back to an upright capsule.
   */
  posed?: Partial<Record<PosedStance, readonly BodyPartSpec[]>>;
  /**
   * Standing's arms, held out on the rifle past the upright capsule: extra
   * capsules in the body's frame, beside the one zoned by height.
   */
  standingArms?: readonly BodyPartSpec[];
}

/** The stances a body is shaped for part by part: every one but standing. */
export type PosedStance = 'crouched' | 'prone' | 'downed' | 'dead';
/** Every stance a hitbox has a shape for. */
export type BodyStance = 'standing' | PosedStance;

/**
 * One capsule of a posed body, between two points in the body's frame:
 * `[right, up, forward]` metres from the feet position, forward being the
 * facing (where a lying body's head is), right the body's own right.
 */
export interface BodyPartSpec {
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  radius: number;
  /**
   * What a hit here scores; null reads it from the impact's height, as on
   * the upright capsule. Arms score as torso, the band they are drawn in
   * standing, so no stance turns a chest-high shot into a limb hit.
   */
  zone: HitZone | null;
}

/**
 * The posed bodies, fitted to the rig's skin in each pose
 * (`humanoidSoldier.ts`; `humanoidSoldier.test.ts` holds the two together):
 * a capsule per leg, the torso, the head and each arm, each along the
 * principal axis of the skin that bone group carries. Crouched leans into
 * its rifle; prone is face down on the elbows, head and shoulders up; downed
 * is on the back, a shoulder rolled up; dead is face down and flat, the arms
 * in a V past the head. Refit by the same test if the rig changes.
 */
export const POSED_BODIES: Record<PosedStance, readonly BodyPartSpec[]> = {
  crouched: [
    { from: [-0.12, 0.18, 0.19], to: [-0.13, 0.3, 0.34], radius: 0.29, zone: 'limb' }, // left leg
    { from: [0.12, 0.18, 0.19], to: [0.14, 0.3, 0.34], radius: 0.29, zone: 'limb' }, // right leg
    { from: [0, 0.43, 0.1], to: [0, 0.75, 0.17], radius: 0.31, zone: 'torso' }, // torso
    { from: [0, 0.94, 0.28], to: [0.01, 1.12, 0.3], radius: 0.17, zone: 'head' }, // head
    { from: [0.29, 0.52, 0.51], to: [-0.21, 0.84, 0.21], radius: 0.07, zone: 'torso' }, // left arm
    { from: [0.31, 0.64, 0.13], to: [0.28, 0.66, 0.27], radius: 0.23, zone: 'torso' }, // right arm
  ],
  prone: [
    { from: [-0.2, 0.23, -0.85], to: [-0.11, 0.19, -0.08], radius: 0.17, zone: 'limb' }, // left leg
    { from: [0.21, 0.23, -0.84], to: [0.12, 0.19, -0.08], radius: 0.17, zone: 'limb' }, // right leg
    { from: [0, 0.14, 0.06], to: [0, 0.24, 0.38], radius: 0.31, zone: 'torso' }, // torso
    { from: [0, 0.4, 0.55], to: [0.01, 0.58, 0.58], radius: 0.17, zone: 'head' }, // head
    { from: [-0.22, 0.28, 0.51], to: [0.21, 0.16, 0.86], radius: 0.11, zone: 'torso' }, // left arm
    { from: [0.37, 0.17, 0.53], to: [0.23, 0.18, 0.58], radius: 0.22, zone: 'torso' }, // right arm
  ],
  downed: [
    { from: [0.17, 0.3, -0.85], to: [0.1, 0.27, -0.07], radius: 0.16, zone: 'limb' }, // left leg
    { from: [-0.18, 0.3, -0.85], to: [-0.12, 0.27, -0.07], radius: 0.16, zone: 'limb' }, // right leg
    { from: [0, 0.36, 0.06], to: [0.01, 0.3, 0.4], radius: 0.31, zone: 'torso' }, // torso
    { from: [0, 0.29, 0.63], to: [-0.01, 0.29, 0.81], radius: 0.17, zone: 'head' }, // head
    { from: [0.53, 0.19, -0.04], to: [0.17, 0.19, 0.49], radius: 0.09, zone: 'torso' }, // left arm
    { from: [0.11, 0.67, 0.08], to: [-0.19, 0.32, 0.45], radius: 0.11, zone: 'torso' }, // right arm
  ],
  dead: [
    { from: [-0.2, 0.22, -0.97], to: [-0.1, 0.27, -0.06], radius: 0.15, zone: 'limb' }, // left leg
    { from: [0.2, 0.22, -0.97], to: [0.12, 0.27, -0.06], radius: 0.15, zone: 'limb' }, // right leg
    { from: [0, 0.17, 0.06], to: [0, 0.23, 0.4], radius: 0.29, zone: 'torso' }, // torso
    { from: [0, 0.24, 0.64], to: [0, 0.24, 0.81], radius: 0.17, zone: 'head' }, // head
    { from: [-0.21, 0.25, 0.47], to: [-0.41, 0.25, 1.1], radius: 0.08, zone: 'torso' }, // left arm
    { from: [0.2, 0.25, 0.47], to: [0.4, 0.25, 1.1], radius: 0.07, zone: 'torso' }, // right arm
  ],
};

/**
 * Standing's arms on the rifle, fitted the same way as the posed bodies.
 * Zoned by height like the rest of the standing body, so they score as the
 * torso band they are in (T-1.19).
 */
export const STANDING_ARMS: readonly BodyPartSpec[] = [
  { from: [-0.21, 1.44, -0.01], to: [0.29, 1.4, 0.42], radius: 0.07, zone: null }, // left arm, across to the foregrip
  { from: [0.31, 1.24, 0.05], to: [0.28, 1.35, 0.14], radius: 0.23, zone: null }, // right arm, on the grip
];

/** Matches the 1.8 m reference figure the movement harness is scaled against. */
export const DEFAULT_HITBOX: Hitbox = {
  radius: 0.35,
  halfHeight: 0.55,
  centerOffsetY: 0.9,
  // The upright crouch and prone capsules stand in for the posed bodies
  // where one capsule is enough: suppression's near misses (T-3.16).
  crouchHalfHeight: 0.25,
  crouchCenterOffsetY: 0.6,
  proneHalfHeight: 0.05,
  proneCenterOffsetY: 0.4,
  posed: POSED_BODIES,
  standingArms: STANDING_ARMS,
};

/** The capsule geometry for an upright stance (T-2.40): prone beats crouch beats standing. */
export function capsuleFor(
  hitbox: Hitbox,
  crouched: boolean,
  prone: boolean,
): { halfHeight: number; centerOffsetY: number } {
  if (prone) {
    return {
      halfHeight: hitbox.proneHalfHeight ?? hitbox.halfHeight,
      centerOffsetY: hitbox.proneCenterOffsetY ?? hitbox.centerOffsetY,
    };
  }
  if (crouched) {
    return {
      halfHeight: hitbox.crouchHalfHeight ?? hitbox.halfHeight,
      centerOffsetY: hitbox.crouchCenterOffsetY ?? hitbox.centerOffsetY,
    };
  }
  return { halfHeight: hitbox.halfHeight, centerOffsetY: hitbox.centerOffsetY };
}

/** The stance a body's shape follows: dead beats downed beats prone beats crouched. */
export function bodyStance(crouched: boolean, prone: boolean, lying: 'downed' | 'dead' | null = null): BodyStance {
  return lying ?? (prone ? 'prone' : crouched ? 'crouched' : 'standing');
}

/** One capsule of a body in the world: a segment and a radius, with the zone it scores (null: by height). */
export interface BodyPart {
  a: Vec3;
  b: Vec3;
  radius: number;
  zone: HitZone | null;
}

/**
 * A body's capsules in the world: at `feet`, facing wire yaw `yaw`. Standing
 * is one vertical capsule whose zone is read from the impact's height; posed
 * stances turn with the facing (table trig, as the client's mesh
 * turns, `remoteSoldiers.ts`).
 */
export function bodyParts(hitbox: Hitbox, stance: BodyStance, feet: Vec3, yaw = 0): BodyPart[] {
  const posed = stance === 'standing' ? undefined : hitbox.posed?.[stance];
  const angle = wireToTable(yaw);
  const fx = sin(angle);
  const fz = cos(angle);
  // The body's right, facing +Z, is -X (three's model space: the left is +X).
  const place = (p: readonly [number, number, number]): Vec3 => ({
    x: feet.x - p[0] * fz + p[2] * fx,
    y: feet.y + p[1],
    z: feet.z + p[0] * fx + p[2] * fz,
  });
  const specs = (list: readonly BodyPartSpec[]): BodyPart[] =>
    list.map((part) => ({ a: place(part.from), b: place(part.to), radius: part.radius, zone: part.zone }));
  if (posed !== undefined) return specs(posed);
  const { halfHeight, centerOffsetY } = capsuleFor(hitbox, stance === 'crouched', stance !== 'standing' && stance !== 'crouched');
  const y = feet.y + centerOffsetY;
  const upright: BodyPart = { a: { x: feet.x, y: y - halfHeight, z: feet.z }, b: { x: feet.x, y: y + halfHeight, z: feet.z }, radius: hitbox.radius, zone: null };
  return stance === 'standing' && hitbox.standingArms ? [upright, ...specs(hitbox.standingArms)] : [upright];
}

/** The nearest part a ray meets, and how far along it. */
export function rayBody(ray: Ray, parts: readonly BodyPart[], grow = 0): { distance: number; part: BodyPart } | null {
  let best: { distance: number; part: BodyPart } | null = null;
  for (const part of parts) {
    const d = raySegmentCapsule(ray, part.a, part.b, part.radius + grow);
    if (d !== null && (best === null || d < best.distance)) best = { distance: d, part };
  }
  return best;
}

/**
 * The zone a hit on `part` scores: the part's own on a posed body, else the
 * impact's height up the standing capsule (T-1.19).
 */
export function zoneOfHit(part: BodyPart, point: Vec3, feetY: number, hitbox: Hitbox = DEFAULT_HITBOX): HitZone {
  if (part.zone !== null) return part.zone;
  return zoneAt(point.y, feetY, 2 * (hitbox.halfHeight + hitbox.radius));
}

/** What lies on the ground and is not prone: 0 not, 1 downed, 2 dead. */
type LyingCode = 0 | 1 | 2;
const LYING: readonly ('downed' | 'dead' | null)[] = [null, 'downed', 'dead'];

interface Sample {
  timeMs: number;
  x: number;
  y: number;
  z: number;
  crouched: boolean;
  prone: boolean;
  /** Wire yaw: which way a lying body lies. */
  yaw: number;
  lying: LyingCode;
}

/** How a body stands, besides where: its stance flags, its facing and whether it is down. */
export interface BodyPose {
  crouched?: boolean;
  prone?: boolean;
  yaw?: number;
  lying?: 'downed' | 'dead' | null;
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

  record(timeMs: number, x: number, y: number, z: number, crouched: boolean, prone: boolean, yaw: number, lying: LyingCode): void {
    this.head = (this.head + 1) % this.capacity;
    const existing = this.samples[this.head];
    if (existing === undefined) {
      this.samples[this.head] = { timeMs, x, y, z, crouched, prone, yaw, lying };
    } else {
      existing.timeMs = timeMs;
      existing.x = x;
      existing.y = y;
      existing.z = z;
      existing.crouched = crouched;
      existing.prone = prone;
      existing.yaw = yaw;
      existing.lying = lying;
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
  sampleAt(timeMs: number, windowMs: number): Sample | null {
    const newest = this.at(0);
    if (newest === undefined) return null;
    if (timeMs >= newest.timeMs) return newest;

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
      return newer;
    }

    const span = newer.timeMs - older.timeMs;
    if (span <= 0) return older;
    const t = (timeMs - older.timeMs) / span;
    return {
      timeMs,
      x: older.x + (newer.x - older.x) * t,
      y: older.y + (newer.y - older.y) * t,
      z: older.z + (newer.z - older.z) * t,
      // Stance (and a lying body's facing) changes at the authoritative
      // sample boundary, not halfway through the position interpolation span.
      crouched: older.crouched,
      prone: older.prone,
      yaw: older.yaw,
      lying: older.lying,
    };
  }
}

/** A body as the history holds it at one moment. */
export interface HistoryState {
  position: Vec3;
  crouched: boolean;
  prone: boolean;
  yaw: number;
  lying: 'downed' | 'dead' | null;
  stance: BodyStance;
}

/** Per-entity position history, written once per tick by the session. */
export class HitboxHistory {
  private readonly tracks = new Map<number, Track>();

  constructor(
    private readonly windowMs: number = HISTORY_WINDOW_MS,
    private readonly capacity: number = DEFAULT_CAPACITY,
  ) {}

  record(netId: number, timeMs: number, x: number, y: number, z: number, crouched = false, prone = false, pose: Omit<BodyPose, 'crouched' | 'prone'> = {}): void {
    let track = this.tracks.get(netId);
    if (track === undefined) {
      track = new Track(this.capacity);
      this.tracks.set(netId, track);
    }
    const lying: LyingCode = pose.lying === 'dead' ? 2 : pose.lying === 'downed' ? 1 : 0;
    track.record(timeMs, x, y, z, crouched, prone, pose.yaw ?? 0, lying);
  }

  positionAt(netId: number, timeMs: number): Vec3 | null {
    const sample = this.tracks.get(netId)?.sampleAt(timeMs, this.windowMs);
    return sample === undefined || sample === null ? null : { x: sample.x, y: sample.y, z: sample.z };
  }

  stateAt(netId: number, timeMs: number): HistoryState | null {
    const sample = this.tracks.get(netId)?.sampleAt(timeMs, this.windowMs);
    return sample === undefined || sample === null
      ? null
      : {
          position: { x: sample.x, y: sample.y, z: sample.z },
          crouched: sample.crouched,
          prone: sample.prone,
          yaw: sample.yaw,
          lying: LYING[sample.lying] ?? null,
          stance: bodyStance(sample.crouched, sample.prone, LYING[sample.lying] ?? null),
        };
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
 * null. The upright case of `raySegmentCapsule`.
 */
export function rayCapsule(ray: Ray, center: Vec3, radius: number, halfHeight: number): number | null {
  return raySegmentCapsule(ray, { x: center.x, y: center.y - halfHeight, z: center.z }, { x: center.x, y: center.y + halfHeight, z: center.z }, radius);
}

/**
 * Ray against the capsule around segment a→b. Returns the distance along the
 * ray, or null. Only `Math.sqrt` and arithmetic, both exactly specified by
 * IEEE-754.
 *
 * Infinite-cylinder test first, accepted only where it lands between the cap
 * centres; then each cap as a sphere. Nearest root in [0, maxDistance] wins,
 * so a ray starting inside finds where it leaves.
 */
export function raySegmentCapsule(ray: Ray, a: Vec3, b: Vec3, radius: number): number | null {
  const { origin: o, direction: d, maxDistance } = ray;
  let best = Infinity;
  const r2 = radius * radius;

  const bax = b.x - a.x;
  const bay = b.y - a.y;
  const baz = b.z - a.z;
  const baba = bax * bax + bay * bay + baz * baz;
  const oax = o.x - a.x;
  const oay = o.y - a.y;
  const oaz = o.z - a.z;

  // Cylinder body: the ray's distance from the axis, in the plane across it.
  if (baba > 1e-12) {
    const bard = bax * d.x + bay * d.y + baz * d.z;
    const baoa = bax * oax + bay * oay + baz * oaz;
    const rdoa = d.x * oax + d.y * oay + d.z * oaz;
    const rdrd = d.x * d.x + d.y * d.y + d.z * d.z;
    const oaoa = oax * oax + oay * oay + oaz * oaz;
    const qa = baba * rdrd - bard * bard;
    const qb = baba * rdoa - baoa * bard;
    const qc = baba * oaoa - baoa * baoa - r2 * baba;
    if (qa > 1e-12) {
      const disc = qb * qb - qa * qc;
      if (disc >= 0) {
        const root = Math.sqrt(disc);
        for (const t of [(-qb - root) / qa, (-qb + root) / qa]) {
          if (t < 0 || t > maxDistance || t >= best) continue;
          const along = baoa + t * bard;
          if (along >= 0 && along <= baba) best = t;
        }
      }
    }
  }

  // Caps.
  for (const cap of baba > 1e-12 ? [a, b] : [a]) {
    const px = o.x - cap.x;
    const py = o.y - cap.y;
    const pz = o.z - cap.z;
    const hb = px * d.x + py * d.y + pz * d.z;
    const c = px * px + py * py + pz * pz - r2;
    const disc = hb * hb - c;
    if (disc < 0) continue;
    const root = Math.sqrt(disc);
    for (const t of [-hb - root, -hb + root]) {
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
  /** The zone the hit scores (T-1.19); meaningless on scenery. */
  zone: HitZone;
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
      : { netId: 0, distance: scenery.distance, point: scenery.point, rewoundTo, rewindMs, zone: 'torso' };

  for (const netId of history.netIds()) {
    if (netId === query.shooterNetId) continue;
    const state = history.stateAt(netId, rewoundTo);
    if (state === null) continue;
    const feet = state.position;
    const hit = rayBody(query.ray, bodyParts(hitbox, state.stance, feet, state.yaw));
    if (hit === null) continue;
    const { distance } = hit;
    if (best !== null && distance >= best.distance) continue;

    const { origin: o, direction: d } = query.ray;
    const point = {
      x: o.x + d.x * distance,
      y: o.y + d.y * distance,
      z: o.z + d.z * distance,
    };
    best = { netId, distance, point, rewoundTo, rewindMs, zone: zoneOfHit(hit.part, point, feet.y, hitbox) };
  }
  return best;
}
