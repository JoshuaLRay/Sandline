/**
 * The scoreboard and the after-action summary (T-4.28), as data the host
 * sends and pure functions of it.
 *
 * The numbers are the server's: it counts each slot's kills, deaths,
 * revives, orders given and orders carried as they happen, and sends the
 * six rows whole whenever one changes, with the mission's clock and how
 * many objectives are done. Nothing here counts anything; a client shows
 * what it was sent. The rows stay six (ADR-001), a bot's beside a human's.
 */
import { MAX_SLOTS } from '../net/Connection.ts';
import type { MissionView } from './mission.ts';
import { TICK_SECONDS } from './Clock.ts';

export interface SlotStats {
  slot: number;
  /** Enemies this slot killed, by a round or a blast. */
  kills: number;
  /** Times this slot died: a finishing shot, a blast, or bleeding out. */
  deaths: number;
  /** Squadmates this slot revived. */
  revives: number;
  /** Orders this slot gave that a bot took. */
  ordersGiven: number;
  /** Orders this slot carried out. */
  ordersCarried: number;
}

export interface MissionStats {
  slots: SlotStats[];
  /** The mission's clock, ticks, across the attempt. */
  elapsedTicks: number;
  /** Objectives completed, of `objectives`. */
  objectivesDone: number;
  objectives: number;
}

export function createSlotStats(slot: number): SlotStats {
  return { slot, kills: 0, deaths: 0, revives: 0, ordersGiven: 0, ordersCarried: 0 };
}

export function createMissionStats(): MissionStats {
  return { slots: Array.from({ length: MAX_SLOTS }, (_, slot) => createSlotStats(slot)), elapsedTicks: 0, objectivesDone: 0, objectives: 0 };
}

/** Seconds as m:ss, so a mission clock reads as one. */
export function clockText(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export interface ScoreboardRow extends SlotStats {
  /** The player's name, or Bot. */
  label: string;
  human: boolean;
  you: boolean;
}

/** The six rows a Tab scoreboard shows, in slot order. */
export function scoreboardRows(
  stats: MissionStats | null,
  roster: readonly { name: string; human: boolean }[],
  mySlot: number,
): ScoreboardRow[] {
  const rows: ScoreboardRow[] = [];
  for (let slot = 0; slot < MAX_SLOTS; slot += 1) {
    const entry = roster[slot];
    const human = entry?.human ?? false;
    const s = stats?.slots[slot] ?? createSlotStats(slot);
    rows.push({ ...s, slot, label: human && entry?.name ? entry.name : 'Bot', human, you: slot === mySlot });
  }
  return rows;
}

/**
 * The after-action summary's line: how the mission ended, in how long, and
 * how many objectives were done. Empty while the mission is in progress or
 * there is none.
 */
export function afterActionSummary(mission: MissionView | null, stats: MissionStats | null): string {
  if (!mission || mission.state === 'progress') return '';
  const outcome = mission.state === 'complete' ? 'Mission complete' : 'Mission failed';
  const elapsed = clockText((stats?.elapsedTicks ?? 0) * TICK_SECONDS);
  const done = stats?.objectivesDone ?? (mission.state === 'complete' ? mission.objectives : mission.objective);
  const total = stats?.objectives ?? mission.objectives;
  return `${outcome} in ${elapsed}  ·  ${done}/${total} objectives`;
}
