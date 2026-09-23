/**
 * Stimuli: what a brain can hear (T-3.14).
 *
 * The session emits one whenever something audible happens — a shot (at the
 * shooter), an impact and a near miss (at the point), a detonation (at the
 * blast), a sprinting soldier (at the soldier) — and every listener inside
 * the kind's loudness radius hears it. What a brain does with what it heard
 * is `memory.ts`; this file only says what was heard, and by whom.
 *
 * Two kinds of stimulus, by where they happen:
 *
 *   - **Locating** (`shot`, `sprint`): heard AT the source, so hearing one
 *     tells the listener where the source is. An unseen shooter's last known
 *     position is where its shot came from.
 *   - **Threatening** (`impact`, `nearMiss`, `detonation`): heard at a point
 *     away from the source. They say nothing about where the source stands,
 *     but they say it is shooting (or throwing) near the listener — which is
 *     what target choice prefers.
 *
 * Which kind does which is the rule, not tuning, so it is here; how far each
 * carries and how sure hearing it makes a listener is data
 * (`data/stimuli.json`, standing rule 4).
 *
 * Hearing is a radius, through walls: sound carries round corners, and a
 * muffled-by-geometry model is a tuning pass for when there is a building to
 * hear through. Pure functions; no clock, no state.
 */
import RAW_STIMULI from '../data/stimuli.json' with { type: 'json' };
import type { Vec3 } from '../net/prediction.ts';

export const STIMULUS_KINDS = ['shot', 'impact', 'nearMiss', 'detonation', 'sprint'] as const;
export type StimulusKind = (typeof STIMULUS_KINDS)[number];

/** Heard at the source: hearing it places the source. */
export const LOCATING_STIMULI: readonly StimulusKind[] = ['shot', 'sprint'];
/** Heard near the listener because of the source: the source is shooting at it. */
export const THREATENING_STIMULI: readonly StimulusKind[] = ['impact', 'nearMiss', 'detonation'];

export interface Stimulus {
  kind: StimulusKind;
  /** Where it was heard from. */
  at: Vec3;
  /** Who made it: the shooter, thrower or sprinter. 0 for nobody in particular. */
  sourceNetId: number;
}

export interface StimulusKindDef {
  /** Loudness: heard at or inside this distance, metres. */
  radiusM: number;
  /** How sure hearing it makes a listener of the source's position, 0..1. */
  confidence: number;
}

export interface StimulusConfig {
  /**
   * A shot that passes within this distance of a soldier's chest without
   * hitting it is a near miss at its closest point, metres. T-3.16 replaces
   * this with a capsule test and its own data.
   */
  nearMissM: number;
  kinds: Readonly<Record<StimulusKind, StimulusKindDef>>;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Hand-written for the reason `weapons.ts` gives: zod would be a new runtime dep. */
class StimulusDataError extends Error {}

type Row = Record<string, unknown>;

function obj(raw: unknown, where: string): Row {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new StimulusDataError(`${where}: expected an object`);
  return raw as Row;
}

function only(row: Row, keys: readonly string[], where: string): void {
  for (const k of Object.keys(row)) if (!keys.includes(k)) throw new StimulusDataError(`${where}: unknown key "${k}"`);
}

function num(row: Row, key: string, where: string, min: number, max: number): number {
  const v = row[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new StimulusDataError(`${where}.${key} must be a finite number, got ${String(v)}`);
  if (v < min || v > max) throw new StimulusDataError(`${where}.${key} must be in [${min}, ${max}], got ${v}`);
  return v;
}

/** Validate a stimulus table: every kind present, nothing else. */
export function parseStimulusConfig(raw: unknown): StimulusConfig {
  const row = obj(raw, 'stimuli');
  only(row, ['nearMissM', 'kinds'], 'stimuli');
  const kindsRow = obj(row['kinds'], 'stimuli.kinds');
  only(kindsRow, STIMULUS_KINDS, 'stimuli.kinds');
  const kinds = {} as Record<StimulusKind, StimulusKindDef>;
  for (const kind of STIMULUS_KINDS) {
    const where = `stimuli.kinds.${kind}`;
    if (!(kind in kindsRow)) throw new StimulusDataError(`${where}: missing`);
    const k = obj(kindsRow[kind], where);
    only(k, ['radiusM', 'confidence'], where);
    // Above zero: a confidence of 0 would be heard and forgotten in one breath.
    kinds[kind] = Object.freeze({ radiusM: num(k, 'radiusM', where, 0, 1000), confidence: num(k, 'confidence', where, 0.01, 1) });
  }
  return Object.freeze({ nearMissM: num(row, 'nearMissM', 'stimuli', 0, 10), kinds: Object.freeze(kinds) });
}

/** The committed stimulus table, validated at import. */
export const STIMULI: StimulusConfig = parseStimulusConfig(RAW_STIMULI);

// ---------------------------------------------------------------------------
// Hearing
// ---------------------------------------------------------------------------

/** Whether a listener with its ears at `ear` hears `stimulus`: inside the kind's radius. */
export function hears(ear: Vec3, stimulus: Stimulus, config: StimulusConfig = STIMULI): boolean {
  const dx = stimulus.at.x - ear.x;
  const dy = stimulus.at.y - ear.y;
  const dz = stimulus.at.z - ear.z;
  const r = config.kinds[stimulus.kind].radiusM;
  return dx * dx + dy * dy + dz * dz <= r * r;
}

export function locatesSource(kind: StimulusKind): boolean {
  return LOCATING_STIMULI.includes(kind);
}

export function threatens(kind: StimulusKind): boolean {
  return THREATENING_STIMULI.includes(kind);
}

/**
 * The point of a segment (`origin` along unit `direction` for `length`)
 * nearest `point`, and how far it is. What makes a shot a near miss.
 */
export function closestApproach(origin: Vec3, direction: Vec3, length: number, point: Vec3): { at: Vec3; distance: number } {
  const px = point.x - origin.x;
  const py = point.y - origin.y;
  const pz = point.z - origin.z;
  const t = Math.min(length, Math.max(0, px * direction.x + py * direction.y + pz * direction.z));
  const at = { x: origin.x + direction.x * t, y: origin.y + direction.y * t, z: origin.z + direction.z * t };
  const dx = point.x - at.x;
  const dy = point.y - at.y;
  const dz = point.z - at.z;
  return { at, distance: Math.sqrt(dx * dx + dy * dy + dz * dz) };
}
