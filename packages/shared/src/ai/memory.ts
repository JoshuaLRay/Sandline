/**
 * Target memory and target choice (T-3.14).
 *
 * What a brain knows about each target: a last known position, when it was
 * last updated, how sure it is, whether it can see the target right now,
 * whether the target was last seen downed, and when the target last shot at
 * it. Fed by sight (T-3.13's detection) and by stimuli (`stimuli.ts`), and
 * decaying without either: confidence falls linearly from whatever it was at
 * the last update to nothing over `forgetSeconds`, and the entry is forgotten
 * the moment it gets there.
 *
 * Target choice scores every remembered target — the visible above the
 * remembered, the close above the far, the one shooting at it above the rest
 * — and deprioritises the downed by `downedFactor`. At 0 (committed) a downed
 * target is chosen only when nothing else is known.
 *
 * Plain data and pure functions: time is the `now` (seconds) handed in, and
 * entries are kept in a `Map`, whose insertion order makes ties deterministic.
 * Every number is `data/memory.json` (standing rule 4).
 */
import RAW_MEMORY from '../data/memory.json' with { type: 'json' };
import type { Vec3 } from '../net/prediction.ts';
import { type Stimulus, STIMULI, type StimulusConfig, locatesSource, threatens } from './stimuli.ts';

export interface MemoryConfig {
  /** Seconds from the last sighting or sound until a target is forgotten. */
  forgetSeconds: number;
  /** Seconds a target counts as shooting at the brain after a threatening stimulus. */
  threatSeconds: number;
  /** Score of a visible target before distance, against a remembered one's confidence (≤ 1). */
  visibleWeight: number;
  /** Distance at which proximity halves a score, metres: score × 1 / (1 + d / proximityM). */
  proximityM: number;
  /** Score multiplier for a target shooting at the brain. */
  threatFactor: number;
  /** Score multiplier for a downed target. 0: only when nothing else is known. */
  downedFactor: number;
}

export interface MemoryEntry {
  netId: number;
  /** Last known position. */
  x: number;
  y: number;
  z: number;
  /** When the position was last updated, seconds. */
  updatedAt: number;
  /** Confidence at `updatedAt`, 0..1; it decays from there. */
  confidence: number;
  /** Seen on the brain's latest think. */
  visible: boolean;
  /** Downed when last seen. */
  downed: boolean;
  /** When it last shot (or threw) near the brain, seconds, or null. */
  threatAt: number | null;
}

export interface TargetMemory {
  readonly entries: Map<number, MemoryEntry>;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Hand-written for the reason `weapons.ts` gives: zod would be a new runtime dep. */
class MemoryDataError extends Error {}

const KEYS = ['forgetSeconds', 'threatSeconds', 'visibleWeight', 'proximityM', 'threatFactor', 'downedFactor'] as const;

export function parseMemoryConfig(raw: unknown): MemoryConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new MemoryDataError('memory: expected an object');
  const row = raw as Record<string, unknown>;
  for (const k of Object.keys(row)) if (!(KEYS as readonly string[]).includes(k)) throw new MemoryDataError(`memory: unknown key "${k}"`);
  const num = (key: (typeof KEYS)[number], min: number, max: number): number => {
    const v = row[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new MemoryDataError(`memory.${key} must be a finite number, got ${String(v)}`);
    if (v < min || v > max) throw new MemoryDataError(`memory.${key} must be in [${min}, ${max}], got ${v}`);
    return v;
  };
  return Object.freeze({
    // Above zero: a memory forgotten on the instant it forms is none.
    forgetSeconds: num('forgetSeconds', 0.1, 600),
    threatSeconds: num('threatSeconds', 0, 600),
    // At least 1: seeing a target is never worth less than being sure of it unseen.
    visibleWeight: num('visibleWeight', 1, 100),
    proximityM: num('proximityM', 0.1, 1000),
    // "Prefers the one shooting at it" and "deprioritises the downed" are the rule.
    threatFactor: num('threatFactor', 1, 100),
    downedFactor: num('downedFactor', 0, 1),
  });
}

/** The committed memory tuning, validated at import. */
export const MEMORY: MemoryConfig = parseMemoryConfig(RAW_MEMORY);

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export function createTargetMemory(): TargetMemory {
  return { entries: new Map() };
}

/** Confidence in an entry at `now`: linear from its last update to 0 at `forgetSeconds`. */
export function confidenceAt(entry: MemoryEntry, now: number, config: MemoryConfig = MEMORY): number {
  if (entry.visible) return entry.confidence;
  const age = Math.max(0, now - entry.updatedAt);
  return Math.max(0, entry.confidence * (1 - age / config.forgetSeconds));
}

/** Whether an entry has decayed to forgotten by `now`. A visible target never has. */
export function isForgotten(entry: MemoryEntry, now: number, config: MemoryConfig = MEMORY): boolean {
  return !entry.visible && now - entry.updatedAt >= config.forgetSeconds;
}

/**
 * The start of a think: nothing is visible until this think's sight says so,
 * and whatever has decayed to forgotten goes.
 */
export function beginThink(memory: TargetMemory, now: number, config: MemoryConfig = MEMORY): void {
  for (const entry of memory.entries.values()) entry.visible = false;
  for (const [netId, entry] of memory.entries) if (isForgotten(entry, now, config)) memory.entries.delete(netId);
}

function entryFor(memory: TargetMemory, netId: number, at: Vec3, now: number): MemoryEntry {
  let entry = memory.entries.get(netId);
  if (!entry) {
    entry = { netId, x: at.x, y: at.y, z: at.z, updatedAt: now, confidence: 0, visible: false, downed: false, threatAt: null };
    memory.entries.set(netId, entry);
  }
  return entry;
}

/** A detected target, seen now at `feet`: certain, visible, its stance as seen. */
export function rememberSeen(memory: TargetMemory, netId: number, feet: Vec3, now: number, downed: boolean): void {
  const entry = entryFor(memory, netId, feet, now);
  entry.x = feet.x;
  entry.y = feet.y;
  entry.z = feet.z;
  entry.updatedAt = now;
  entry.confidence = 1;
  entry.visible = true;
  entry.downed = downed;
}

/**
 * Something heard. A locating stimulus moves the source's last known position
 * to where it came from — unless the source is in sight, which is better —
 * and raises confidence to the kind's if that is higher than what is left. A
 * threatening one marks a source the brain already knows as shooting at it.
 * A stimulus from nobody (source 0) tells memory nothing.
 */
export function rememberHeard(
  memory: TargetMemory,
  stimulus: Stimulus,
  now: number,
  config: MemoryConfig = MEMORY,
  stimuli: StimulusConfig = STIMULI,
): void {
  if (stimulus.sourceNetId === 0) return;
  if (locatesSource(stimulus.kind)) {
    const entry = entryFor(memory, stimulus.sourceNetId, stimulus.at, now);
    if (!entry.visible) {
      const left = confidenceAt(entry, now, config);
      entry.x = stimulus.at.x;
      entry.y = stimulus.at.y;
      entry.z = stimulus.at.z;
      entry.updatedAt = now;
      entry.confidence = Math.max(left, stimuli.kinds[stimulus.kind].confidence);
    }
  }
  if (threatens(stimulus.kind)) {
    const entry = memory.entries.get(stimulus.sourceNetId);
    if (entry) entry.threatAt = now;
  }
}

/** Drop a target outright — it died, or is otherwise nobody to remember. */
export function forgetTarget(memory: TargetMemory, netId: number): void {
  memory.entries.delete(netId);
}

// ---------------------------------------------------------------------------
// Target choice
// ---------------------------------------------------------------------------

/** A target's score from `from` at `now`, before the downed discount. 0 once forgotten. */
export function targetScore(entry: MemoryEntry, from: Vec3, now: number, config: MemoryConfig = MEMORY): number {
  if (isForgotten(entry, now, config)) return 0;
  const base = entry.visible ? config.visibleWeight : confidenceAt(entry, now, config);
  const dx = entry.x - from.x;
  const dy = entry.y - from.y;
  const dz = entry.z - from.z;
  const proximity = 1 / (1 + Math.sqrt(dx * dx + dy * dy + dz * dz) / config.proximityM);
  const threat = entry.threatAt !== null && now - entry.threatAt <= config.threatSeconds ? config.threatFactor : 1;
  return base * proximity * threat;
}

/**
 * The target to engage, or null when nothing is remembered. Highest score
 * wins, downed targets scaled by `downedFactor`; when that leaves nothing
 * above zero, the best downed target is still better than none. Ties go to
 * the one remembered first.
 */
export function chooseTarget(memory: TargetMemory, from: Vec3, now: number, config: MemoryConfig = MEMORY): number | null {
  let best: number | null = null;
  let bestScore = 0;
  let fallback: number | null = null;
  let fallbackScore = 0;
  for (const entry of memory.entries.values()) {
    const raw = targetScore(entry, from, now, config);
    if (raw <= 0) continue;
    const score = entry.downed ? raw * config.downedFactor : raw;
    if (score > bestScore) {
      best = entry.netId;
      bestScore = score;
    }
    if (entry.downed && raw > fallbackScore) {
      fallback = entry.netId;
      fallbackScore = raw;
    }
  }
  return best ?? fallback;
}
