/**
 * T-4.28: the scoreboard's rows and the after-action line, from the
 * host's numbers alone.
 */
import { describe, expect, it } from 'vitest';
import { TICK_SECONDS } from './Clock.ts';
import type { MissionView } from './mission.ts';
import { afterActionSummary, clockText, createMissionStats, createSlotStats, scoreboardRows } from './scoreboard.ts';

const view = (v: Partial<MissionView>): MissionView => ({
  state: 'progress', attempt: 1, objective: 0, objectives: 3, type: 'reach', label: 'the ford', satisfied: false, progress: 0, goal: 1, ...v,
});

describe('the scoreboard (T-4.28)', () => {
  it('reads a clock as m:ss', () => {
    expect(clockText(0)).toBe('0:00');
    expect(clockText(59.9)).toBe('0:59');
    expect(clockText(272)).toBe('4:32');
    expect(clockText(-3)).toBe('0:00');
  });

  it('is six rows always, named from the roster, with the host\'s numbers or zeros before any arrive', () => {
    const roster = [{ name: 'kai', human: true }, { name: '', human: false }, { name: 'rae', human: true }];
    const empty = scoreboardRows(null, roster, 2);
    expect(empty).toHaveLength(6);
    expect(empty[0]).toMatchObject({ slot: 0, label: 'kai', human: true, you: false, kills: 0, deaths: 0, revives: 0, ordersGiven: 0, ordersCarried: 0 });
    expect(empty[1]).toMatchObject({ label: 'Bot', human: false });
    expect(empty[2]).toMatchObject({ label: 'rae', you: true });
    expect(empty[5]).toMatchObject({ slot: 5, label: 'Bot' });
    const stats = createMissionStats();
    stats.slots[2] = { ...createSlotStats(2), kills: 4, deaths: 1, revives: 2, ordersGiven: 3, ordersCarried: 0 };
    const rows = scoreboardRows(stats, roster, 2);
    expect(rows[2]).toMatchObject({ label: 'rae', kills: 4, deaths: 1, revives: 2, ordersGiven: 3, ordersCarried: 0 });
  });

  it('sums up a finished mission: how it ended, in how long, and the objectives done', () => {
    const stats = { ...createMissionStats(), elapsedTicks: Math.round(272 / TICK_SECONDS), objectivesDone: 3, objectives: 3 };
    expect(afterActionSummary(null, stats)).toBe('');
    expect(afterActionSummary(view({}), stats)).toBe('');
    expect(afterActionSummary(view({ state: 'complete', objective: 2 }), stats)).toBe('Mission complete in 4:32  ·  3/3 objectives');
    expect(afterActionSummary(view({ state: 'failed', objective: 1 }), { ...stats, objectivesDone: 1 })).toBe('Mission failed in 4:32  ·  1/3 objectives');
    // Before the host's numbers arrive the mission's own view stands in.
    expect(afterActionSummary(view({ state: 'failed', objective: 1 }), null)).toBe('Mission failed in 0:00  ·  1/3 objectives');
  });
});
