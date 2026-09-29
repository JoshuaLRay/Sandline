import { describe, expect, it } from 'vitest';
import type { RosterEntry } from '@sandline/shared';
import { commandKey, commandRows, watchedStatus } from './commandModel.ts';

const roster: RosterEntry[] = [
  { name: 'kai', human: true, classId: 'team-leader', commander: -1 },
  { name: '', human: false, classId: 'marksman', commander: 0 },
  { name: 'rae', human: true, classId: 'marksman', commander: -1 },
  { name: '', human: false, classId: 'marksman', commander: 2 },
  { name: '', human: false, classId: 'marksman', commander: 0 },
  { name: '', human: false, classId: '', commander: 0 },
];

describe('the squad command rows (U-025)', () => {
  it('six rows: each bot with its commander and every seated human to hand it to, you marked', () => {
    const rows = commandRows(roster, 2);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual({ slot: 0, label: '1  kai · TL', human: true, commander: -1, options: [], switchable: false });
    expect(rows[2]).toMatchObject({ label: '3  rae (you) · MM', human: true, options: [] });
    expect(rows[3]).toEqual({
      slot: 3,
      label: '4  Bot · MM',
      human: false,
      commander: 2,
      options: [{ slot: 0, label: 'kai' }, { slot: 2, label: 'rae (you)' }],
      switchable: true,
    });
    expect(rows[5]?.label).toBe('6  Bot');
    // U-026: only the bots you command can be taken over — kai's cannot, from rae's screen.
    expect(rows.map((r) => r.switchable)).toEqual([false, false, false, true, false, false]);
    expect(commandRows(roster, 0).map((r) => r.switchable)).toEqual([false, true, false, false, true, true]);
    expect(rows.filter((r) => !r.human).map((r) => r.commander)).toEqual([0, 2, 0, 0]);
  });

  it('before a roster: six bots under nobody, with nobody to hand them to', () => {
    const rows = commandRows([], -1);
    expect(rows.map((r) => [r.human, r.commander, r.options.length])).toEqual(Array.from({ length: 6 }, () => [false, -1, 0]));
  });

  it('keys a redraw on what is drawn, not on every frame', () => {
    const a = commandKey(commandRows(roster, 2));
    expect(commandKey(commandRows(roster, 2))).toBe(a);
    const moved = roster.map((e, i) => (i === 3 ? { ...e, commander: 0 } : e));
    expect(commandKey(commandRows(moved, 2))).not.toBe(a);
    expect(commandKey(commandRows(roster, 0))).not.toBe(a);
  });

  it('describes the watched soldier’s control and command relationship', () => {
    const rows = commandRows(roster, 2);
    expect(watchedStatus(rows, 0, 2)).toContain('Human controlled');
    expect(watchedStatus(rows, 2, 2)).toContain('Your soldier');
    expect(watchedStatus(rows, 3, 2)).toContain('Under your command');
    expect(watchedStatus(rows, 4, 2)).toContain('another player’s command');
  });
});
