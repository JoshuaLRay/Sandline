/**
 * T-4.27, U-021: the squad's characters as data, which slot plays which, and
 * how far an order reaches.
 */
import { describe, expect, it } from 'vitest';
import { CLASSES, ClassDataError, assignClasses, classById, orderReach, parseClassConfig } from './classes.ts';
import { PROJECTILE_IDS } from './ballistics.ts';
import { getWeapon } from './weapons.ts';
import { SQUAD } from './squad.ts';
import RAW from '../data/classes.json' with { type: 'json' };

const ORDER = ['preach', 'brennan', 'holloway', 'ortiz', 'marsh', 'vance'];

describe('classes.json: the six characters (U-021)', () => {
  it('has exactly the roster, one per slot, in slot order', () => {
    expect(CLASSES.ids).toEqual(ORDER);
    expect(CLASSES.slotDefaults).toEqual(ORDER);
    expect(new Set(CLASSES.slotDefaults).size).toBe(6);
    expect(assignClasses()).toEqual(ORDER);
  });

  it('gives each their roster loadout: the two snipers, the LMG, the AR, the scoped AR and the support', () => {
    const guns = (id: string) => classById(id)!.guns;
    expect(guns('preach')[0]).toBe('carbine');
    expect(guns('brennan')[0]).toBe('lmg');
    expect(guns('ortiz')[0]).toBe('carbine-scoped');
    // Slot 4 starts with the left-handed bolt-action sniper, slot 5 with the semi-automatic one (owner, 2026-09-27).
    expect(getWeapon(guns('marsh')[0]!)).toMatchObject({ action: 'bolt', handedness: 'left' });
    expect(getWeapon(guns('vance')[0]!)).toMatchObject({ action: 'semi', handedness: 'right' });
    // The support carries an SMG and a shotgun, and no pistol (owner, 2026-09-29).
    expect(guns('holloway')).toEqual(['smg', 'breacher']);
    for (const id of ORDER.filter((c) => c !== 'holloway')) expect(guns(id), id).toContain('sidearm');
    // The role counts: two snipers (bolt and semi), one of the rest.
    const primaries = ORDER.map((id) => guns(id)[0]);
    expect(new Set(primaries).size).toBe(6);
  });

  it('the support alone may not aim down the sight or play in first person', () => {
    for (const id of ORDER) {
      const c = classById(id)!;
      expect(c.ads, id).toBe(id !== 'holloway');
      expect(c.firstPerson, id).toBe(id !== 'holloway');
    }
  });

  it('names and short codes are unique and shown in a row', () => {
    const defs = ORDER.map((id) => classById(id)!);
    expect(new Set(defs.map((d) => d.name)).size).toBe(6);
    expect(new Set(defs.map((d) => d.short)).size).toBe(6);
    expect(defs[0]!.name).toBe('Preach');
    for (const d of defs) expect(d.pouch).toHaveLength(PROJECTILE_IDS.length);
    expect(classById('team-leader')).toBeNull();
    expect(classById('')).toBeNull();
  });

  it('refuses a loadout the weapons or projectiles do not have, a bad flag, and defaults that are not six distinct characters', () => {
    const edit = (f: (o: Record<string, unknown>) => void) => {
      const o = JSON.parse(JSON.stringify(RAW)) as Record<string, unknown>;
      f(o);
      return () => parseClassConfig(o);
    };
    const row = (o: Record<string, unknown>, id: string) => (o['classes'] as Record<string, Record<string, unknown>>)[id]!;
    expect(edit((o) => { row(o, 'vance')['guns'] = ['lasgun']; })).toThrow(ClassDataError);
    expect(edit((o) => { row(o, 'vance')['pouch'] = { mine: 1 }; })).toThrow(ClassDataError);
    expect(edit((o) => { row(o, 'vance')['orders'] = 'platoon'; })).toThrow(ClassDataError);
    expect(edit((o) => { row(o, 'holloway')['ads'] = 'no'; })).toThrow(ClassDataError);
    expect(edit((o) => { o['slotDefaults'] = ['preach']; })).toThrow(ClassDataError);
    expect(edit((o) => { o['slotDefaults'] = ['preach', 'preach', 'holloway', 'ortiz', 'marsh', 'vance']; })).toThrow('only one slot');
  });
});

describe('how far an order reaches (T-4.27)', () => {
  const all = [0, 1, 2, 3, 4, 5];
  it('the assault team (slots 0-2) orders the whole squad, as its Team Leaders did; the overwatch team only its own fireteam', () => {
    for (const [id, slot] of [['preach', 0], ['brennan', 1], ['holloway', 2]] as const) expect(orderReach(id, slot, all, SQUAD.fireteams), id).toEqual(all);
    expect(orderReach('ortiz', 3, all, SQUAD.fireteams)).toEqual([3, 4, 5]);
    expect(orderReach('marsh', 4, [0, 5], SQUAD.fireteams)).toEqual([5]);
    expect(orderReach('vance', 5, [1], SQUAD.fireteams)).toEqual([]);
    expect(orderReach('', 0, all, SQUAD.fireteams)).toEqual([]);
    expect(orderReach('vance', 9, all, SQUAD.fireteams)).toEqual([]);
  });

  it('every character carries 3 health kits unless the data says otherwise, and no more than the wire holds (U-047)', () => {
    for (const id of CLASSES.ids) expect(classById(id)?.healthKits, id).toBe(3);
    const raw = JSON.parse(JSON.stringify(RAW)) as { classes: Record<string, Record<string, unknown>> };
    raw.classes[CLASSES.ids[0]!]!['healthKits'] = 5;
    expect(parseClassConfig(raw).classes[CLASSES.ids[0]!]?.healthKits).toBe(5);
    raw.classes[CLASSES.ids[0]!]!['healthKits'] = 8;
    expect(() => parseClassConfig(raw)).toThrow(ClassDataError);
  });
});
