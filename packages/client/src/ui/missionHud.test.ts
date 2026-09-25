/**
 * The mission HUD line (T-3.34; every objective type since T-4.14): read from
 * the host's message, round-tripped through the wire as a client receives it.
 */
import { describe, expect, it } from 'vitest';
import { type Message, type MissionView, TICK_SECONDS, decodeMessage, encodeMessage } from '@sandline/shared';
import { afterActionXp, missionLine } from './missionHud.ts';

const T = (s: number) => Math.round(s / TICK_SECONDS);
const view = (v: Partial<MissionView>): MissionView => {
  const msg = decodeMessage(
    encodeMessage({ kind: 'Mission', state: 'progress', attempt: 1, objective: 0, objectives: 1, type: 'clear-and-hold', label: 'the compound', satisfied: false, progress: 0, goal: T(30), ...v }),
  ) as Extract<Message, { kind: 'Mission' }>;
  const { kind: _kind, ...rest } = msg;
  return rest;
};

describe('the mission HUD line (T-3.34, T-4.14)', () => {
  it('shows your mission credit, the soldier’s rank and total only after success or failure', () => {
    const soldiers = [{ slot: 0, xp: 525, rank: 1, earned: 25 }, { slot: 1, xp: 50, rank: 0, earned: 0 }];
    expect(afterActionXp(null, soldiers, 0)).toBe('');
    expect(afterActionXp(view({}), soldiers, 0)).toBe('');
    for (const state of ['complete', 'failed'] as const) {
      expect(afterActionXp(view({ state }), soldiers, 0)).toBe('Soldier 1: you earned 25 XP · Private First Class · 525 XP total');
      expect(afterActionXp(view({ state }), soldiers, 1)).toContain('Soldier 2: you earned 0 XP');
    }
  });
  it('reads each type from the message as it arrives', () => {
    expect(missionLine(null)).toBe('');
    expect(missionLine(view({}))).toBe('Objective: clear the compound  ·  held 0/30 s');
    expect(missionLine(view({ satisfied: true, progress: T(12.5) }))).toBe('Objective: hold the compound  ·  held 12/30 s');
    expect(missionLine(view({ type: 'reach', label: 'the ford', goal: 4, progress: 3 }))).toBe('Objective: reach the ford  ·  3/4 there');
    expect(missionLine(view({ type: 'destroy', label: 'the garrison', goal: 5, progress: 2, satisfied: true }))).toBe('Objective: destroy the garrison  ·  2/5 down');
    expect(missionLine(view({ type: 'defend', label: 'the compound', goal: T(60), progress: T(20), satisfied: true }))).toBe('Objective: defend the compound  ·  20/60 s');
    expect(missionLine(view({ type: 'defend', label: 'the compound', goal: T(60), progress: T(21), satisfied: false }))).toBe('Objective: defend the compound  ·  21/60 s  ·  overrun!');
    expect(missionLine(view({ type: 'survive', label: 'the night', goal: T(90), progress: T(45), satisfied: true }))).toBe('Objective: survive the night  ·  45/90 s');
  });

  it('numbers the objective in a sequence, and says how the mission ended', () => {
    expect(missionLine(view({ objective: 1, objectives: 3, type: 'survive', label: 'the night', goal: T(90) }))).toBe('Objective 2/3: survive the night  ·  0/90 s');
    expect(missionLine(view({ state: 'complete', objective: 2, objectives: 3 }))).toMatch(/^Mission complete .*P to play again/);
    expect(missionLine(view({ state: 'failed', attempt: 3 }))).toMatch(/^Squad wiped — mission failed .*attempt 3 .*P to try again/);
    expect(missionLine(view({ state: 'failed', type: 'defend', label: 'the compound', satisfied: false }))).toMatch(/^The compound overrun — mission failed/);
  });
});
