/**
 * Two primaries (U-022, owner 2026-09-27 and -29): only Preach and the
 * support carry two, only ARs, SMGs and shotguns qualify, and each gun keeps
 * its own magazine while it is away. The host decides all of it.
 */
import { describe, expect, it } from 'vitest';
import { PICKUPS, WEAPON_IDS, createWeaponState, getWeapon } from '@sandline/shared';
import { Session } from './Session.ts';

interface Internals {
  placePickup(id: string, ammo: number, at: { x: number; y: number; z: number }, yaw: number): void;
  takePickupAt(slot: unknown): boolean;
  drawGun(slot: unknown, gun: string): void;
  restorePrimary(slot: unknown): void;
  carries(slot: unknown, gun: string): boolean;
}

function room() {
  const session = new Session(undefined, '', 'range', { roomLobby: true });
  const x = session as unknown as Internals;
  const at = (n: number) => session.slots[n]!;
  /** Lay `gun` alone at the slot's feet and press: whether it was taken. (The ground is cleared first, so what lies there afterwards is only what this press left or dropped.) */
  const take = (n: number, gun: string, ammo = 5) => {
    (session as unknown as { pickupList: unknown[] }).pickupList.length = 0;
    session.slots[n]!.state = { ...session.slots[n]!.state, x: 0, y: 0, z: 0 };
    x.placePickup(gun, ammo, { x: 0, y: 0, z: 0 }, 0);
    return x.takePickupAt(session.slots[n]);
  };
  return { session, x, at, take };
}

const ground = (s: Session) => s.pickups.map((p) => WEAPON_IDS[p.weapon] as string);

describe('who carries two primaries (U-022)', () => {
  it('the support starts with an SMG and a shotgun, Preach with one primary, everyone else with one', () => {
    const { session } = room();
    expect(session.loadoutOf(2)).toMatchObject({ primary: 'smg', secondary: 'breacher' });
    for (const n of [0, 1, 3, 4, 5]) expect(session.loadoutOf(n).secondary, `slot ${n}`).toBeNull();
  });

  it('the support can draw either and neither carries a gun outside its two', () => {
    const { session, x, at } = room();
    const s = at(2);
    expect(x.carries(s, 'smg') && x.carries(s, 'breacher')).toBe(true);
    for (const gun of ['sidearm', 'carbine', 'lmg', 'marksman']) expect(x.carries(s, gun) && gun !== 'sidearm', gun).toBe(false);
    expect(session.loadoutOf(2).weapon).toBe('smg');
  });
});

describe('two primaries mean no pistol (U-022)', () => {
  it('Preach has the pistol with one primary and gives it up on taking a second', () => {
    const { session, x, at, take } = room();
    const s = at(0);
    expect(x.carries(s, 'sidearm')).toBe(true);
    expect(take(0, 'smg')).toBe(true);
    expect(session.loadoutOf(0)).toMatchObject({ primary: 'carbine', secondary: 'smg', weapon: 'smg' });
    expect(x.carries(s, 'sidearm')).toBe(false);
    expect(s.stowed.has('sidearm')).toBe(false);
    // A respawn gives the class back: one primary and the pistol again.
    x.restorePrimary(s);
    expect(session.loadoutOf(0).secondary).toBeNull();
    expect(x.carries(s, 'sidearm')).toBe(true);
  });
});

describe('each gun keeps its own magazine (U-022)', () => {
  it('rounds spent on one primary are still gone when it is drawn again, and the other is untouched', () => {
    const { x, at } = room();
    const s = at(2);
    s.weaponState.ammo = 7; // the SMG
    x.drawGun(s, 'breacher');
    expect(s.weapon.id).toBe('breacher');
    expect(s.weaponState.ammo).toBe(getWeapon('breacher').magSize);
    s.weaponState.ammo = 2;
    x.drawGun(s, 'smg');
    expect(s.weaponState.ammo).toBe(7);
    x.drawGun(s, 'breacher');
    expect(s.weaponState.ammo).toBe(2);
  });

  it('a reload in progress is cancelled by putting the gun away, not finished for free', () => {
    const { x, at } = room();
    const s = at(2);
    s.weaponState.ammo = 3;
    s.weaponState.reloadEndsAt = 1e9; // long after now
    x.drawGun(s, 'breacher');
    x.drawGun(s, 'smg');
    expect(s.weaponState.ammo).toBe(3);
    expect(s.weaponState.reloadEndsAt).toBe(0);
  });

  it('a respawn or retry gives every gun back fresh', () => {
    const { x, at } = room();
    const s = at(2);
    s.weaponState.ammo = 1;
    x.drawGun(s, 'breacher');
    s.weaponState.ammo = 1;
    expect(s.stowed.size).toBe(1);
    x.restorePrimary(s);
    expect(s.stowed.size).toBe(0);
  });
});

describe('taking a gun off the ground as a second primary (U-022)', () => {
  it('Preach adds an eligible gun as his second primary and holds it, keeping the carbine and its rounds', () => {
    const { session, at, take } = room();
    at(0).weaponState.ammo = 11;
    expect(take(0, 'smg', 9)).toBe(true);
    expect(session.loadoutOf(0)).toMatchObject({ primary: 'carbine', secondary: 'smg', weapon: 'smg', ammo: 9 });
    expect(ground(session)).toEqual([]);
    expect(at(0).stowed.get('carbine')?.ammo).toBe(11);
  });

  it('with both full, the next replaces the one in hand and puts it down; an LMG or sniper is left where it lies', () => {
    const { session, at, take } = room();
    take(0, 'smg');
    expect(take(0, 'lmg')).toBe(false);
    expect(ground(session)).toEqual(['lmg']);
    expect(take(0, 'sniper-semi')).toBe(false);
    expect(ground(session)).toEqual(['sniper-semi']);
    expect(session.loadoutOf(0)).toMatchObject({ primary: 'carbine', secondary: 'smg' });
    // In hand is the SMG: a shotgun replaces it, the SMG goes down, the carbine stays.
    expect(take(0, 'breacher')).toBe(true);
    expect(session.loadoutOf(0)).toMatchObject({ primary: 'carbine', secondary: 'breacher' });
    expect(ground(session)).toEqual(['smg']);
    // With the carbine in hand instead, the next replaces the carbine.
    at(0).weapon = getWeapon('carbine');
    at(0).weaponState = createWeaponState(at(0).weapon);
    expect(take(0, 'carbine-scoped')).toBe(true);
    expect(session.loadoutOf(0)).toMatchObject({ primary: 'carbine-scoped', secondary: 'breacher' });
  });

  it('Preach holding an LMG cannot add a second primary; a sniper takes nothing beside it either', () => {
    const { session, at, take } = room();
    expect(take(0, 'lmg')).toBe(true);
    expect(session.loadoutOf(0)).toMatchObject({ primary: 'lmg', secondary: null });
    expect(ground(session)).toEqual(['carbine']);
    expect(take(0, 'smg')).toBe(true);
    // The SMG replaced the LMG as the primary: still one gun, not two.
    expect(session.loadoutOf(0)).toMatchObject({ primary: 'smg', secondary: null });
    expect(ground(session)).toEqual(['lmg']);
    expect(at(0).stowed.size).toBe(0);
  });

  it('the support, full, replaces the primary in hand and refuses what would sit beside a second primary', () => {
    const { session, take } = room();
    expect(take(2, 'lmg')).toBe(false);
    expect(take(2, 'carbine')).toBe(true);
    expect(session.loadoutOf(2)).toMatchObject({ primary: 'carbine', secondary: 'breacher' });
    expect(ground(session)).toEqual(['smg']);
  });

  it('no one else ever gets a second primary: a pickup replaces their one', () => {
    const { session, take } = room();
    for (const n of [1, 3, 5]) {
      expect(take(n, 'smg'), `slot ${n}`).toBe(true);
      expect(session.loadoutOf(n), `slot ${n}`).toMatchObject({ primary: 'smg', secondary: null });
    }
  });

  it('a gun the soldier already carries swaps in place rather than being carried twice', () => {
    const { session, take } = room();
    take(0, 'smg');
    expect(take(0, 'smg', 3)).toBe(true);
    expect(session.loadoutOf(0)).toMatchObject({ primary: 'carbine', secondary: 'smg', ammo: 3 });
  });

  it('death gives the character its own guns back', () => {
    const { session, x, at, take } = room();
    take(0, 'smg');
    take(2, 'carbine');
    x.restorePrimary(at(0));
    x.restorePrimary(at(2));
    expect(session.loadoutOf(0)).toMatchObject({ primary: 'carbine', secondary: null, weapon: 'carbine' });
    expect(session.loadoutOf(2)).toMatchObject({ primary: 'smg', secondary: 'breacher' });
    expect(PICKUPS.max).toBeGreaterThan(0);
  });
});
