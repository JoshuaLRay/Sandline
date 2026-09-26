/**
 * The player's settings (T-4.26): what the menu edits, what the page
 * applies, and what one browser remembers. Pure: parsing is tolerant (a
 * stored value from an older build, or a hand-edited one, falls back field
 * by field to the default and clamps into range), and storage is behind two
 * small functions that never throw — a private window or a blocked store
 * costs the settings, not the game.
 *
 * The graphics quality is a name for a row of ADR-013's budget knobs: the
 * render resolution (a cap on the device pixel ratio) and the sun's shadow
 * map. `medium` is the budget itself — 60 fps at 1080p on integrated
 * graphics; `low` is under it for a weaker machine; `high` spends a discrete
 * GPU's headroom on resolution and shadow detail, never on more geometry.
 */

export type QualityLevel = 'low' | 'medium' | 'high';
export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];

export interface QualityBudget {
  /** The most of the device's pixel ratio the renderer draws at. */
  pixelRatioMax: number;
  /** The sun's shadow map, pixels on a side. */
  shadowMapSize: number;
  /** Whether the sun casts shadows at all. */
  shadows: boolean;
}

export const QUALITY: Readonly<Record<QualityLevel, QualityBudget>> = {
  low: { pixelRatioMax: 1, shadowMapSize: 1024, shadows: true },
  medium: { pixelRatioMax: 1.5, shadowMapSize: 2048, shadows: true },
  high: { pixelRatioMax: 2, shadowMapSize: 4096, shadows: true },
};

export interface Volumes {
  master: number;
  effects: number;
  voice: number;
}

export interface Settings {
  /** Mouse look, turn per pixel: LocalInput's own scale. */
  sensitivity: number;
  invertY: boolean;
  /** Vertical field of view, degrees, unscoped. */
  fovDeg: number;
  /** 0..1 each; E-2.7's audio reads them when it lands. */
  volumes: Volumes;
  quality: QualityLevel;
  /** T-5.03: first-run hints on the HUD. */
  hints: boolean;
}

export const SETTINGS_RANGES = {
  sensitivity: { min: 0.1, max: 2, step: 0.05 },
  fovDeg: { min: 50, max: 100, step: 1 },
  volume: { min: 0, max: 1, step: 0.05 },
} as const;

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  sensitivity: 0.55,
  invertY: false,
  fovDeg: 60,
  volumes: Object.freeze({ master: 0.8, effects: 1, voice: 1 }),
  quality: 'medium',
  hints: true,
}) as Settings;

/** Where one browser keeps them. */
export const SETTINGS_KEY = 'sandline.settings';

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** A settings object from anything: unknown fields are dropped, missing or bad ones take the default, numbers are clamped. */
export function parseSettings(raw: unknown): Settings {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const volumesRaw = typeof o['volumes'] === 'object' && o['volumes'] !== null ? (o['volumes'] as Record<string, unknown>) : {};
  const quality = o['quality'];
  return {
    sensitivity: clampNumber(o['sensitivity'], SETTINGS_RANGES.sensitivity.min, SETTINGS_RANGES.sensitivity.max, DEFAULT_SETTINGS.sensitivity),
    invertY: typeof o['invertY'] === 'boolean' ? o['invertY'] : DEFAULT_SETTINGS.invertY,
    fovDeg: clampNumber(o['fovDeg'], SETTINGS_RANGES.fovDeg.min, SETTINGS_RANGES.fovDeg.max, DEFAULT_SETTINGS.fovDeg),
    volumes: {
      master: clampNumber(volumesRaw['master'], 0, 1, DEFAULT_SETTINGS.volumes.master),
      effects: clampNumber(volumesRaw['effects'], 0, 1, DEFAULT_SETTINGS.volumes.effects),
      voice: clampNumber(volumesRaw['voice'], 0, 1, DEFAULT_SETTINGS.volumes.voice),
    },
    quality: typeof quality === 'string' && (QUALITY_LEVELS as readonly string[]).includes(quality) ? (quality as QualityLevel) : DEFAULT_SETTINGS.quality,
    hints: typeof o['hints'] === 'boolean' ? o['hints'] : DEFAULT_SETTINGS.hints,
  };
}

/** The smallest thing a store needs to be: localStorage, or a test's stand-in. */
export interface SettingsStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadSettings(store: SettingsStore | null): Settings {
  if (!store) return parseSettings(null);
  try {
    const stored = store.getItem(SETTINGS_KEY);
    return parseSettings(stored === null ? null : JSON.parse(stored));
  } catch {
    return parseSettings(null);
  }
}

/** True when stored; false when the store refused, which is not an error. */
export function saveSettings(store: SettingsStore | null, settings: Settings): boolean {
  if (!store) return false;
  try {
    store.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

/** The page's own localStorage, or null where a browser refuses it. */
export function browserStore(): SettingsStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The bindings as the page has them, for the menu to show (display first; rebinding is later). */
export const KEY_BINDINGS: readonly { action: string; keys: string }[] = [
  { action: 'Move', keys: 'W A S D' },
  { action: 'Sprint', keys: 'Shift' },
  { action: 'Jump / vault', keys: 'Space' },
  { action: 'Crouch', keys: 'C  (Ctrl to hold)' },
  { action: 'Prone', keys: 'Z' },
  { action: 'Fire', keys: 'Left mouse' },
  { action: 'Aim', keys: 'Right mouse' },
  { action: 'Reload', keys: 'R' },
  { action: 'Weapons', keys: '1 – 4' },
  { action: 'Grenade / rocket', keys: '5 – 6  (G quick-throws)' },
  { action: 'Interact / revive', keys: 'E (hold)' },
  { action: 'Order wheel', keys: 'Q (hold)' },
  { action: 'Mark target', keys: 'F' },
  { action: 'Shoulder / exit first person', keys: 'V' },
  { action: 'Scoreboard', keys: 'Tab (hold)' },
  { action: 'Pause menu', keys: 'Esc' },
];
