/**
 * Suppression (T-3.16).
 *
 * Every soldier — slot or enemy — carries a level in 0..1 that rounds going
 * past raise and time lowers. A NEAR MISS is a round whose path passes within
 * `nearMissM` of a soldier's capsule without touching it; a round striking
 * the ground or a wall close by, and a blast inside `blastRadiusM`, raise it
 * too. What the level does is the reader's: an AI's aim widens through its
 * archetype's `suppressionFactor` (and T-3.20's urge to take cover reads it),
 * a human's weapon cone widens by `coneDeg` at level 1, and the level
 * replicates as the `Suppression` component so the page can show it.
 *
 * The curve is a hold and a line: the level stays where the latest raise left
 * it for `holdSeconds`, then falls at `decayPerSec` to zero. It is a function
 * of time since that raise, not of ticks, so reading it never steps anything
 * and a level read twice in one tick is the same level.
 *
 * SHARED because the client widens its predicted cone by the replicated level
 * exactly as the server widens the real one. Only arithmetic and `Math.sqrt`
 * (ADR-014); the numbers are `data/suppression.json` (standing rule 4).
 */
import RAW_SUPPRESSION from '../data/suppression.json' with { type: 'json' };
import type { Vec3 } from '../net/prediction.ts';
import { degToAngle } from './weapons.ts';

export interface SuppressionConfig {
  /** A round passing within this distance of a capsule's surface is a near miss, metres. */
  nearMissM: number;
  /** Level added by one near miss. */
  nearMiss: number;
  /** An impact within this distance of a soldier's capsule surface counts, metres. */
  impactRadiusM: number;
  /** Level added by one impact that close. */
  impact: number;
  /** A blast within this distance counts, falling linearly to nothing at it, metres. */
  blastRadiusM: number;
  /** Level added by a blast at the soldier's feet. */
  blast: number;
  /** Seconds the level holds after the latest raise before it starts to fall. */
  holdSeconds: number;
  /** Fall per second after the hold. */
  decayPerSec: number;
  /** A human's weapon cone at level 1 is this many degrees wider (linear in the level). */
  coneDeg: number;
}

/** One soldier's suppression: the level the latest raise left, and when. */
export interface SuppressionState {
  level: number;
  at: number;
}

/** Bits of the replicated level: 64 steps from none to full. */
export const SUPPRESSION_BITS = 6;
const WIRE_MAX = (1 << SUPPRESSION_BITS) - 1;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Hand-written for the reason `weapons.ts` gives: zod would be a new runtime dep. */
class SuppressionDataError extends Error {}

const KEYS = ['$comment', 'nearMissM', 'nearMiss', 'impactRadiusM', 'impact', 'blastRadiusM', 'blast', 'holdSeconds', 'decayPerSec', 'coneDeg'] as const;

export function parseSuppressionConfig(raw: unknown): SuppressionConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SuppressionDataError('suppression: expected an object');
  const row = raw as Record<string, unknown>;
  for (const k of Object.keys(row)) if (!(KEYS as readonly string[]).includes(k)) throw new SuppressionDataError(`suppression: unknown key "${k}"`);
  const num = (key: string, min: number, max: number): number => {
    const v = row[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new SuppressionDataError(`suppression.${key} must be a finite number, got ${String(v)}`);
    if (v < min || v > max) throw new SuppressionDataError(`suppression.${key} must be in [${min}, ${max}], got ${v}`);
    return v;
  };
  return Object.freeze({
    nearMissM: num('nearMissM', 0, 10),
    nearMiss: num('nearMiss', 0, 1),
    impactRadiusM: num('impactRadiusM', 0, 20),
    impact: num('impact', 0, 1),
    // Above zero: it is a divisor.
    blastRadiusM: num('blastRadiusM', 0.1, 100),
    blast: num('blast', 0, 1),
    holdSeconds: num('holdSeconds', 0, 30),
    // Above zero: a level that never falls is a soldier pinned for the session.
    decayPerSec: num('decayPerSec', 0.001, 100),
    coneDeg: num('coneDeg', 0, 45),
  });
}

/** The committed tuning, validated at import. */
export const SUPPRESSION: SuppressionConfig = parseSuppressionConfig(RAW_SUPPRESSION);

// ---------------------------------------------------------------------------
// The near miss
// ---------------------------------------------------------------------------

/** A standing capsule: a vertical axis from `centre.y - halfHeight` to `centre.y + halfHeight`, `radius` round it. */
export interface Capsule {
  centre: Vec3;
  halfHeight: number;
  radius: number;
}

/**
 * How close a round's path — `origin` along unit `direction` for `length` —
 * comes to a capsule: the gap to its surface (zero or less is a touch, which
 * is a hit, not a miss) and the point on the path where it is closest.
 *
 * Segment against segment (the capsule's axis), clamped on both, then the
 * radius off. Arithmetic and `Math.sqrt` only.
 */
export function passCapsule(origin: Vec3, direction: Vec3, length: number, capsule: Capsule): { gap: number; at: Vec3 } {
  const { centre, halfHeight, radius } = capsule;
  const ax = centre.x;
  const ay = centre.y - halfHeight;
  const az = centre.z;
  const axisLength = 2 * halfHeight;
  // Path P(s) = origin + direction·s, s ∈ [0, length]; axis Q(t) = (ax, ay + t, az), t ∈ [0, axisLength].
  const rx = origin.x - ax;
  const ry = origin.y - ay;
  const rz = origin.z - az;
  const b = direction.y; // direction · axis unit (0,1,0)
  const d = rx * direction.x + ry * direction.y + rz * direction.z;
  const e = ry;
  const denom = 1 - b * b; // |dir|² |axis|² − (dir·axis)², both unit
  let s = denom > 1e-12 ? (b * e - d) / denom : 0;
  s = Math.min(length, Math.max(0, s));
  let t = Math.min(axisLength, Math.max(0, ry + direction.y * s));
  // Re-clamp the path parameter against the clamped axis point.
  s = Math.min(length, Math.max(0, (ax - origin.x) * direction.x + (ay + t - origin.y) * direction.y + (az - origin.z) * direction.z));
  t = Math.min(axisLength, Math.max(0, origin.y + direction.y * s - ay));
  const at = { x: origin.x + direction.x * s, y: origin.y + direction.y * s, z: origin.z + direction.z * s };
  const dx = at.x - ax;
  const dy = at.y - (ay + t);
  const dz = at.z - az;
  return { gap: Math.sqrt(dx * dx + dy * dy + dz * dz) - radius, at };
}

/** How far a point is from a capsule's surface; zero or less is inside it. */
export function capsuleGap(point: Vec3, capsule: Capsule): number {
  return passCapsule(point, { x: 0, y: 1, z: 0 }, 0, capsule).gap;
}

/** Whether a pass is a near miss: clear of the capsule, and within `nearMissM` of it. */
export function isNearMiss(gap: number, config: SuppressionConfig = SUPPRESSION): boolean {
  return gap > 0 && gap <= config.nearMissM;
}

// ---------------------------------------------------------------------------
// The level
// ---------------------------------------------------------------------------

export function createSuppression(): SuppressionState {
  return { level: 0, at: 0 };
}

/** The level at `now`: held, then falling on the data's line to zero. */
export function suppressionLevel(state: Readonly<SuppressionState>, now: number, config: SuppressionConfig = SUPPRESSION): number {
  const falling = now - state.at - config.holdSeconds;
  if (falling <= 0) return state.level;
  const level = state.level - falling * config.decayPerSec;
  return level > 0 ? level : 0;
}

/** Add `amount` at `now`, saturating at 1. The hold starts again from here. */
export function raiseSuppression(state: SuppressionState, amount: number, now: number, config: SuppressionConfig = SUPPRESSION): void {
  if (!(amount > 0)) return;
  const level = suppressionLevel(state, now, config) + amount;
  state.level = level > 1 ? 1 : level;
  state.at = now;
}

/** What a blast `distanceM` away adds: the data's full amount at the feet, nothing at the radius. */
export function blastSuppression(distanceM: number, config: SuppressionConfig = SUPPRESSION): number {
  if (!(distanceM < config.blastRadiusM)) return 0;
  return config.blast * (1 - Math.max(0, distanceM) / config.blastRadiusM);
}

// ---------------------------------------------------------------------------
// On the wire, and on the cone
// ---------------------------------------------------------------------------

/** A level as the `Suppression` component carries it. */
export function suppressionToWire(level: number): number {
  const i = Math.round(level * WIRE_MAX);
  return i < 0 ? 0 : i > WIRE_MAX ? WIRE_MAX : i;
}

export function suppressionFromWire(wire: number): number {
  return Math.min(WIRE_MAX, Math.max(0, wire)) / WIRE_MAX;
}

/**
 * How much wider a human's weapon cone is at `level`, binary angle units —
 * added on top of the weapon's own clamped cone, so a suppressed shooter is
 * wider by exactly the data's amount. Taken from the WIRE level, so the server
 * widens by the number the page is told, and the client's predicted cone,
 * given the replicated level, is the same width.
 */
export function suppressionConeUnits(level: number, config: SuppressionConfig = SUPPRESSION): number {
  return degToAngle(config.coneDeg * suppressionFromWire(suppressionToWire(level)));
}
