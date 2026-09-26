/**
 * Onboarding (T-5.03): the briefing lists the mission's objectives from its
 * data, and each first-run hint shows once — at the moment it applies, one
 * at a time — and never again once done, dismissed, or shown out.
 */
import { describe, expect, it } from 'vitest';
import { missionFor } from '@sandline/shared';
import { briefingFor, objectiveText } from './briefingModel.ts';
import { HINTS, HintTracker, type HintCondition, parseHints } from './hints.ts';

function memoryStore() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}
const conds = (...c: HintCondition[]) => new Set<HintCondition>(c);

describe('the briefing (T-5.03)', () => {
  it('lists the mission’s objectives in order, its routes, the squad and the keys', () => {
    const b = briefingFor('mission-01', ['team-leader', 'team-leader', 'team-leader', 'marksman', 'marksman', 'marksman'])!;
    const mission = missionFor('mission-01')!;
    expect(b.objectives).toEqual(mission.objectives.map(objectiveText));
    expect(b.objectives.length).toBe(mission.objectives.length);
    expect(b.title).toBe('Mission 01');
    expect(b.routes).toMatch(/^Two ways in: the overwatch route up the west, and the assault route up the east/);
    expect(b.squad).toBe('3 Team Leader, 3 Marksman');
    expect(b.controls.map((c) => c.action)).toContain('Order wheel');
    expect(briefingFor('range')).toBeNull();
  });

  it('says each kind of objective plainly', () => {
    expect(objectiveText({ type: 'clear-and-hold', label: 'the compound', area: 'objective', holdSeconds: 30 })).toBe('Clear the compound and hold it for 30 s');
    expect(objectiveText({ type: 'defend', label: 'the gate', area: 'objective', seconds: 120, breachSeconds: 5 })).toBe('Defend the gate for 2 min');
    expect(objectiveText({ type: 'defend', label: 'the gate', area: 'objective', seconds: 330, breachSeconds: 5 })).toBe('Defend the gate for 5 min 30 s');
    expect(objectiveText({ type: 'reach', label: 'extraction', area: 'start', who: 'all' })).toBe('Get everyone to extraction');
    expect(objectiveText({ type: 'destroy', label: 'the patrol', group: 'p' })).toBe('Destroy the patrol');
  });
});

describe('first-run hints (T-5.03)', () => {
  it('shows each hint when it first applies, one at a time, and never again once done', () => {
    const store = memoryStore();
    const t = new HintTracker(store);
    expect(t.update(conds('start'), 0)).toMatch(/W A S D/);
    // Another applies meanwhile: it waits its turn.
    expect(t.update(conds('start', 'enemy-seen'), 1)).toMatch(/W A S D/);
    t.did('move', 2);
    expect(t.update(conds('start', 'enemy-seen'), 3)).toBe('');
    expect(t.update(conds('start', 'enemy-seen'), 2 + HINTS.gapSeconds)).toMatch(/Left mouse fires/);
    t.did('fire', 7);
    // A new tracker on the same store remembers both.
    const again = new HintTracker(store);
    expect(again.done.has('move') && again.done.has('fire')).toBe(true);
    expect(again.update(conds('start'), 0)).toBe('');
  });

  it('finishes a hint shown out or dismissed, skips one already done before it showed, and honours after', () => {
    const t = new HintTracker(memoryStore());
    t.did('mark', 0);
    expect(t.update(conds('under-fire'), 0)).toMatch(/crouches/);
    expect(t.update(conds('under-fire'), HINTS.showSeconds + 0.1)).toBe('');
    expect(t.done.has('crouch')).toBe(true);
    const at = HINTS.showSeconds + 0.1 + HINTS.gapSeconds;
    expect(t.update(conds('squad'), at)).toMatch(/order wheel/);
    t.dismiss(at + 1);
    expect(t.done.has('orders')).toBe(true);
    // 'mark' was done before it ever showed; 'throw' waits for 'fire'.
    expect(t.update(conds('enemy-seen'), at + 1 + HINTS.gapSeconds)).toMatch(/Left mouse fires/);
    expect(t.done.has('mark')).toBe(true);
  });

  it('is silent when switched off, shows again after a reset, and refuses a malformed list', () => {
    const t = new HintTracker(memoryStore(), HINTS, false);
    expect(t.update(conds('start'), 0)).toBe('');
    t.enabled = true;
    t.did('move', 0);
    t.reset();
    expect(t.update(conds('start'), 100)).toMatch(/W A S D/);
    expect(() => parseHints({ ...HINTS, hints: [{ id: 'x', text: 'y', when: 'noon', doneBy: 'move' }] })).toThrow(/when must be one of/);
    expect(() => parseHints({ ...HINTS, hints: [{ id: 'x', text: 'y', when: 'start', doneBy: 'move', after: ['z'] }] })).toThrow(/after must name hints listed before/);
  });
});
