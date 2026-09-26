/**
 * First-run hints (T-5.03): one line on the HUD at the moment a thing first
 * matters — how to move at the start, how to fire when an enemy is first in
 * view, the order wheel once there is a squad to order — each shown once a
 * device and never again once it is done, dismissed, or has had its time.
 * The list is data (`hints.json`); what has been seen is kept in the
 * browser's storage, behind two functions that never throw.
 */
import RAW from './hints.json' with { type: 'json' };

export const HINT_CONDITIONS = ['start', 'enemy-seen', 'magazine-low', 'squad', 'mate-downed', 'under-fire', 'near-gun'] as const;
export type HintCondition = (typeof HINT_CONDITIONS)[number];
export const HINT_ACTIONS = ['move', 'fire', 'reload', 'order', 'mark', 'throw', 'revive', 'crouch', 'mount'] as const;
export type HintAction = (typeof HINT_ACTIONS)[number];

export interface HintDef {
  id: string;
  text: string;
  when: HintCondition;
  after: readonly string[];
  doneBy: HintAction;
}

export interface HintsConfig {
  showSeconds: number;
  gapSeconds: number;
  squadAfterSeconds: number;
  hints: readonly HintDef[];
}

export class HintsDataError extends Error {}

export function parseHints(raw: unknown): HintsConfig {
  const o = raw as Record<string, unknown>;
  const num = (k: string, min: number, max: number): number => {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new HintsDataError(`hints.${k} must be in [${min}, ${max}]`);
    return v;
  };
  if (!Array.isArray(o['hints'])) throw new HintsDataError('hints.hints must be a list');
  const ids = new Set<string>();
  const hints = (o['hints'] as Record<string, unknown>[]).map((h, i) => {
    const where = `hints.hints[${i}]`;
    for (const k of Object.keys(h)) if (!['id', 'text', 'when', 'after', 'doneBy'].includes(k)) throw new HintsDataError(`${where}: unknown key '${k}'`);
    if (typeof h['id'] !== 'string' || !/^[a-z][a-z-]*$/.test(h['id'])) throw new HintsDataError(`${where}.id must be a lowercase id`);
    if (ids.has(h['id'])) throw new HintsDataError(`${where}: '${h['id']}' twice`);
    if (typeof h['text'] !== 'string' || h['text'].length === 0 || h['text'].length > 120) throw new HintsDataError(`${where}.text must be 1–120 characters`);
    if (!(HINT_CONDITIONS as readonly unknown[]).includes(h['when'])) throw new HintsDataError(`${where}.when must be one of ${HINT_CONDITIONS.join(', ')}`);
    if (!(HINT_ACTIONS as readonly unknown[]).includes(h['doneBy'])) throw new HintsDataError(`${where}.doneBy must be one of ${HINT_ACTIONS.join(', ')}`);
    const after = h['after'] === undefined ? [] : h['after'];
    if (!Array.isArray(after) || !after.every((a) => typeof a === 'string' && ids.has(a))) throw new HintsDataError(`${where}.after must name hints listed before it`);
    ids.add(h['id']);
    return { id: h['id'], text: h['text'], when: h['when'] as HintCondition, after: after as string[], doneBy: h['doneBy'] as HintAction };
  });
  return { showSeconds: num('showSeconds', 1, 60), gapSeconds: num('gapSeconds', 0, 60), squadAfterSeconds: num('squadAfterSeconds', 0, 600), hints };
}

export const HINTS: HintsConfig = parseHints(RAW);

/** Where one browser keeps the hints it has seen. */
export const HINTS_KEY = 'sandline.hints';

export interface HintStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadSeenHints(store: HintStore | null): Set<string> {
  try {
    const raw = store?.getItem(HINTS_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveSeenHints(store: HintStore | null, seen: ReadonlySet<string>): void {
  try {
    store?.setItem(HINTS_KEY, JSON.stringify([...seen].sort()));
  } catch {
    // A refused store costs the memory of what was seen, not the game.
  }
}

/**
 * Which hint shows, and when. `update` with the conditions that hold now
 * returns the line to show ('' for none); `did` records what the player did,
 * finishing any hint it answers — shown or not yet; `dismiss` finishes the
 * one showing; `reset` forgets everything seen.
 */
export class HintTracker {
  private seen: Set<string>;
  private current: { hint: HintDef; until: number } | null = null;
  private nextAt = 0;

  constructor(
    private readonly store: HintStore | null = null,
    private readonly config: HintsConfig = HINTS,
    public enabled = true,
  ) {
    this.seen = loadSeenHints(store);
  }

  /** Hints done, for tests and the menu. */
  get done(): ReadonlySet<string> {
    return this.seen;
  }

  private finish(id: string, now: number): void {
    if (!this.seen.has(id)) {
      this.seen.add(id);
      saveSeenHints(this.store, this.seen);
    }
    if (this.current?.hint.id === id) {
      this.current = null;
      this.nextAt = now + this.config.gapSeconds;
    }
  }

  update(conditions: ReadonlySet<HintCondition>, now: number): string {
    if (!this.enabled) return '';
    if (this.current && now >= this.current.until) this.finish(this.current.hint.id, now);
    if (!this.current && now >= this.nextAt) {
      const next = this.config.hints.find((h) => !this.seen.has(h.id) && conditions.has(h.when) && h.after.every((a) => this.seen.has(a)));
      if (next) this.current = { hint: next, until: now + this.config.showSeconds };
    }
    return this.current?.hint.text ?? '';
  }

  did(action: HintAction, now: number): void {
    for (const h of this.config.hints) if (h.doneBy === action) this.finish(h.id, now);
  }

  dismiss(now: number): void {
    if (this.current) this.finish(this.current.hint.id, now);
  }

  reset(): void {
    this.seen = new Set();
    this.current = null;
    this.nextAt = 0;
    saveSeenHints(this.store, this.seen);
  }
}
