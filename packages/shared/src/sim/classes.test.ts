/**
 * T-4.27: the classes as data, who plays which, and how far an order reaches.
 */
import { describe, expect, it } from 'vitest';
import { CLASSES, ClassDataError, assignClasses, classById, orderReach, parseClassConfig } from './classes.ts';
import { PROJECTILE_IDS } from './ballistics.ts';
import { SQUAD } from './squad.ts';
import RAW from '../data/classes.json' with { type: 'json' };

const ALL_BOTS = [true, true, true, true, true, true];
const NO_PICKS = ['', '', '', '', '', ''];

describe('classes.json (T-4.27)', () => {
  it('ships the slice\'s two classes with real loadouts', () => {
    expect(CLASSES.ids).toEqual(['team-leader', 'marksman']);
    const tl = classById('team-leader')!;
    expect(tl.guns[0]).toBe('carbine');
    expect(tl.orders).toBe('squad');
    const mm = classById('marksman')!;
    expect(mm.guns[0]).toBe('marksman');
    expect(mm.orders).toBe('fireteam');
    expect(mm.health).toBeLessThan(tl.health);
    // The pouch is indexed like PROJECTILE_IDS; an id left out is none.
    expect(tl.pouch).toHaveLength(PROJECTILE_IDS.length);
    expect(mm.pouch[PROJECTILE_IDS.indexOf('rocket')]).toBe(0);
    expect(classById('medic')).toBeNull();
    expect(classById('')).toBeNull();
  });

  it('refuses a loadout the weapons or projectiles do not have, and defaults that name no class', () => {
    const edit = (f: (o: Record<string, unknown>) => void) => {
      const o = JSON.parse(JSON.stringify(RAW)) as Record<string, unknown>;
      f(o);
      return () => parseClassConfig(o);
    };
    expect(edit((o) => { (o['classes'] as Record<string, Record<string, unknown>>)['marksman']!['guns'] = ['lasgun']; })).toThrow(ClassDataError);
    expect(edit((o) => { (o['classes'] as Record<string, Record<string, unknown>>)['marksman']!['pouch'] = { mine: 1 }; })).toThrow(ClassDataError);
    expect(edit((o) => { (o['classes'] as Record<string, Record<string, unknown>>)['marksman']!['orders'] = 'platoon'; })).toThrow(ClassDataError);
    expect(edit((o) => { o['slotDefaults'] = ['team-leader']; })).toThrow(ClassDataError);
    expect(edit((o) => { o['required'] = { medic: 1 }; })).toThrow(ClassDataError);
  });
});

describe('who plays which class (T-4.27)', () => {
  it('bots take the slot defaults: the assault fireteam leads, the overwatch fireteam watches', () => {
    expect(assignClasses(ALL_BOTS, NO_PICKS)).toEqual(['team-leader', 'team-leader', 'team-leader', 'marksman', 'marksman', 'marksman']);
  });

  it('a human\'s pick stands; without one they take the slot\'s default', () => {
    const isBot = [false, true, true, false, true, true];
    expect(assignClasses(isBot, ['marksman', '', '', '', '', ''])).toEqual(['marksman', 'team-leader', 'team-leader', 'marksman', 'marksman', 'marksman']);
    expect(assignClasses(isBot, ['', '', '', 'team-leader', '', ''])).toEqual(['team-leader', 'team-leader', 'team-leader', 'team-leader', 'marksman', 'marksman']);
    // A pick the data does not know is no pick.
    expect(assignClasses(isBot, ['medic', '', '', '', '', ''])[0]).toBe('team-leader');
    // A bot's "pick" is ignored: only a human chooses.
    expect(assignClasses(isBot, ['', 'marksman', '', '', '', ''])[1]).toBe('team-leader');
  });

  it('a bot fills the class the squad is required to have when the humans leave it short', () => {
    // Three humans in the assault fireteam all pick marksman: the first bot, in overwatch, leads.
    const isBot = [false, false, false, true, true, true];
    expect(assignClasses(isBot, ['marksman', 'marksman', 'marksman', '', '', ''])).toEqual(['marksman', 'marksman', 'marksman', 'team-leader', 'marksman', 'marksman']);
    // One of them switches back to leader: the bot returns to its own default.
    expect(assignClasses(isBot, ['team-leader', 'marksman', 'marksman', '', '', ''])).toEqual(['team-leader', 'marksman', 'marksman', 'marksman', 'marksman', 'marksman']);
    // Six humans, none a leader: nobody to fill it, and their picks stand.
    const humans = [false, false, false, false, false, false];
    expect(assignClasses(humans, ['marksman', 'marksman', 'marksman', 'marksman', 'marksman', 'marksman'])).toEqual(Array(6).fill('marksman'));
  });
});

describe('how far an order reaches (T-4.27)', () => {
  const all = [0, 1, 2, 3, 4, 5];
  it('a Team Leader orders the whole squad; a Marksman only their own fireteam', () => {
    expect(orderReach('team-leader', 4, all, SQUAD.fireteams)).toEqual(all);
    expect(orderReach('marksman', 4, all, SQUAD.fireteams)).toEqual([3, 4, 5]);
    expect(orderReach('marksman', 0, [1, 5], SQUAD.fireteams)).toEqual([1]);
    expect(orderReach('marksman', 0, [3], SQUAD.fireteams)).toEqual([]);
    expect(orderReach('', 0, all, SQUAD.fireteams)).toEqual([]);
    expect(orderReach('marksman', 9, all, SQUAD.fireteams)).toEqual([]);
  });
});
