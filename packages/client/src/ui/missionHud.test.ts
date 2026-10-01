/**
 * The mission HUD line (T-3.34; every objective type since T-4.14): read from
 * the host's message, round-tripped through the wire as a client receives it.
 */
import { describe, expect, it } from 'vitest';
import { type Message, type MissionDef, type MissionView, TICK_SECONDS, decodeMessage, encodeMessage } from '@sandline/shared';
import { afterActionXp, missionLine, uploadPrompt } from './missionHud.ts';

const T = (s: number) => Math.round(s / TICK_SECONDS);
const view = (v: Partial<MissionView>): MissionView => {
  const msg = decodeMessage(
    encodeMessage({ kind: 'Mission', state: 'progress', attempt: 1, objective: 0, objectives: 1, type: 'clear-and-hold', phase: 'active', label: 'the compound', satisfied: false, progress: 0, goal: T(30), ...v }),
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

  it('says what a rescue wants: hold E beside the prisoner, and how far along the hold is (U-063)', () => {
    const rescue = (v: Partial<MissionView>) => view({ type: 'rescue', label: 'Vance', goal: T(5), ...v });
    expect(missionLine(rescue({}))).toBe('Objective: free Vance  ·  hold E beside them  ·  5 s');
    expect(missionLine(rescue({ satisfied: true, progress: T(2) }))).toBe('Objective: freeing Vance  ·  2/5 s  ·  keep holding E');
  });

  it('says what an upload wants in each of its phases: start it, it runs without you, restart it (U-009)', () => {
    const upload = (v: Partial<MissionView>) => view({ type: 'upload', label: 'the relay', goal: T(60), ...v });
    expect(missionLine(upload({ phase: 'idle' }))).toBe('Objective: start the upload at the relay  ·  E at the terminal');
    expect(missionLine(upload({ phase: 'active', satisfied: true, progress: T(15) }))).toBe('Objective: uploading from the relay  ·  25%  ·  45 s left  ·  no need to stay');
    expect(missionLine(upload({ phase: 'interrupted', progress: T(30) }))).toBe('Objective: upload interrupted at 50%  ·  E at the relay to restart it');
    expect(missionLine(upload({ phase: 'interrupted', progress: 0 }))).toBe('Objective: upload interrupted at 0%  ·  E at the relay to restart it');
    // U-010: an enemy pulling the lever, from the host's snapshot — only while the upload runs.
    expect(missionLine(upload({ phase: 'active', satisfied: true, progress: T(15) }), 40)).toBe('Objective: uploading from the relay  ·  25%  ·  45 s left  ·  no need to stay  ·  ENEMY AT THE LEVER 40% — stop them');
    expect(missionLine(upload({ phase: 'interrupted', progress: T(30) }), 40)).not.toContain('LEVER');
    expect(missionLine(view({}), 40)).not.toContain('LEVER');
    // Complete, it is the mission's (or the next objective's) line.
    expect(missionLine(upload({ state: 'complete', phase: 'active', progress: T(60) }))).toMatch(/^Mission complete/);
  });

  it('prompts E at the terminal only within its reach, and only while the upload waits for a hand (U-009)', () => {
    const def: MissionDef = {
      id: 'x', world: 'greybox-01', respawn: false,
      objectives: [{ type: 'upload', label: 'the relay', terminal: { x: 10, y: 1.2, z: 12.5 }, reachM: 2, seconds: 60, onInterrupt: 'keep-progress' }],
    };
    const at = { x: 10, y: 1.6, z: 11.6 };
    const idle = view({ type: 'upload', label: 'the relay', phase: 'idle', goal: T(60) });
    expect(uploadPrompt(idle, def, at)).toBe('E  START THE UPLOAD');
    expect(uploadPrompt({ ...idle, phase: 'interrupted' }, def, at)).toBe('E  RESTART THE UPLOAD');
    expect(uploadPrompt({ ...idle, phase: 'active' }, def, at)).toBe('');
    expect(uploadPrompt(idle, def, { x: 10, y: 1.6, z: 8 })).toBe('');
    expect(uploadPrompt({ ...idle, state: 'failed' }, def, at)).toBe('');
    expect(uploadPrompt(idle, undefined, at)).toBe('');
    expect(uploadPrompt({ ...idle, label: 'another' }, def, at)).toBe('');
    expect(uploadPrompt(null, def, at)).toBe('');
  });

  it('numbers the objective in a sequence, and says how the mission ended', () => {
    expect(missionLine(view({ objective: 1, objectives: 3, type: 'survive', label: 'the night', goal: T(90) }))).toBe('Objective 2/3: survive the night  ·  0/90 s');
    expect(missionLine(view({ state: 'complete', objective: 2, objectives: 3 }))).toMatch(/^Mission complete .*P to play again/);
    expect(missionLine(view({ state: 'failed', attempt: 3, failureReason: 'soldier-dead' }))).toMatch(/^Mission failed: A soldier died .*attempt 3 .*P: last checkpoint .*O: restart mission/);
    expect(missionLine(view({ state: 'failed', failureReason: 'all-downed' }))).toContain('All six soldiers are down');
    expect(missionLine(view({ state: 'failed', type: 'defend', label: 'the compound', failureReason: 'area-overrun' }))).toContain('the compound overrun');
  });
});

describe('a stage of several objectives on the HUD (U-074)', () => {
  const open = () =>
    view({
      objective: 0,
      objectives: 3,
      type: 'reach',
      label: 'the road',
      goal: 1,
      open: [
        { index: 0, type: 'reach', label: 'the road', phase: 'active', satisfied: false, progress: 0, goal: 1, done: false, optional: false },
        { index: 1, type: 'destroy', label: 'the post', phase: 'active', satisfied: true, progress: 1, goal: 3, done: false, optional: false },
        { index: 2, type: 'survive', label: 'extra time', phase: 'active', satisfied: true, progress: T(2), goal: T(10), done: false, optional: true },
      ],
    });

  it('lists every objective of the stage, ticks the done ones and names the optional ones', () => {
    const v = open();
    expect(missionLine(v)).toBe('Objectives: reach the road  ·  0/1 there   |   destroy the post  ·  1/3 down   |   survive extra time  ·  2/10 s (optional)');
    const done = { ...v, open: v.open!.map((o) => (o.index === 1 ? { ...o, done: true, progress: 3 } : o)) };
    expect(missionLine(done)).toContain('✓ destroy the post  ·  3/3 down');
  });

  it('a stage of one reads as a single objective, as before', () => {
    expect(missionLine(view({ objective: 1, objectives: 3, type: 'survive', label: 'the night', goal: T(90) }))).toBe('Objective 2/3: survive the night  ·  0/90 s');
  });

  it('prompts for an upload that is one of a stage, from the stage\'s own entry', () => {
    const terminal = { x: 0, y: 1, z: 0 };
    const def: MissionDef = {
      id: 'm', world: 'w', respawn: false,
      objectives: [
        { type: 'reach', label: 'the road', area: 'start', who: 'any', stage: 0 },
        { type: 'upload', label: 'the relay', terminal, reachM: 2, seconds: 10, onInterrupt: 'keep-progress', stage: 0 },
      ],
    };
    const v = view({
      objective: 0, objectives: 2, type: 'reach', label: 'the road', goal: 1,
      open: [
        { index: 0, type: 'reach', label: 'the road', phase: 'active', satisfied: false, progress: 0, goal: 1, done: false, optional: false },
        { index: 1, type: 'upload', label: 'the relay', phase: 'idle', satisfied: false, progress: 0, goal: T(10), done: false, optional: false },
      ],
    });
    expect(uploadPrompt(v, def, { x: 0, y: 1, z: 1 })).toBe('E  START THE UPLOAD');
    expect(uploadPrompt(v, def, { x: 0, y: 1, z: 9 })).toBe('');
    // Once it is done the stage lists it as done and nothing prompts.
    const done = { ...v, open: v.open!.map((o) => (o.index === 1 ? { ...o, done: true } : o)) };
    expect(uploadPrompt(done, def, { x: 0, y: 1, z: 1 })).toBe('');
  });
});
