/**
 * U-029: the left-handed sniper (slot 4) takes no gun a squadmate or an enemy
 * left — every one is right-handed — but does take a left-handed gun, his own
 * put down included. Everyone else takes any right-handed gun, and no left-handed one.
 */
import { describe, expect, it } from 'vitest';
import { WEAPON_IDS } from '@sandline/shared';
import { Session } from './Session.ts';

interface Internals {
  placePickup(id: string, ammo: number, at: { x: number; y: number; z: number }, yaw: number): void;
  takePickupAt(slot: unknown): boolean;
  dropHeld(slot: unknown): boolean;
  carries(slot: unknown, gun: string): boolean;
}

function room() {
  const session = new Session(undefined, '', 'range', { roomLobby: true });
  const x = session as unknown as Internals;
  const lay = (n: number, gun: string, ammo = 5) => {
    (session as unknown as { pickupList: unknown[] }).pickupList.length = 0;
    session.slots[n]!.state = { ...session.slots[n]!.state, x: 0, y: 0, z: 0 };
    x.placePickup(gun, ammo, { x: 0, y: 0, z: 0 }, 0);
  };
  return { session, x, lay };
}

describe('the left-handed sniper and the ground (U-029)', () => {
  it('starts with the left-handed bolt-action and takes no right-handed gun off the ground', () => {
    const { session, x, lay } = room();
    expect(session.loadoutOf(4)).toMatchObject({ weapon: 'sniper-bolt-left', primary: 'sniper-bolt-left' });
    for (const gun of ['carbine', 'marksman', 'breacher', 'smg']) {
      lay(4, gun);
      expect(x.takePickupAt(session.slots[4]), gun).toBe(false);
      expect(session.pickups.map((p) => WEAPON_IDS[p.weapon]), gun).toEqual([gun]);
      expect(session.loadoutOf(4).primary, gun).toBe('sniper-bolt-left');
    }
  });

  it('may put his own gun down and take it back (a left-handed gun), with its rounds', () => {
    const { session, x } = room();
    session.slots[4]!.weaponState.ammo = 3;
    expect(x.dropHeld(session.slots[4])).toBe(true);
    expect(session.loadoutOf(4)).toMatchObject({ primary: null, weapon: 'sidearm' });
    expect(session.pickups.map((p) => [WEAPON_IDS[p.weapon], p.ammo])).toEqual([['sniper-bolt-left', 3]]);
    // Nothing right-handed stands in for it, but his own does come back.
    expect(x.takePickupAt(session.slots[4])).toBe(true);
    expect(session.loadoutOf(4)).toMatchObject({ primary: 'sniper-bolt-left', weapon: 'sniper-bolt-left', ammo: 3 });
    expect(session.pickups).toHaveLength(0);
  });

  it('with his hands empty he still takes no right-handed gun', () => {
    const { session, x, lay } = room();
    x.dropHeld(session.slots[4]);
    lay(4, 'carbine');
    expect(x.takePickupAt(session.slots[4])).toBe(false);
    expect(x.carries(session.slots[4], 'carbine')).toBe(false);
    expect(session.loadoutOf(4).primary).toBeNull();
  });

  it('nobody else can pick up a left-handed gun, his own put down included (owner, 2026-09-30)', () => {
    const { session, x } = room();
    x.dropHeld(session.slots[4]);
    session.slots[1]!.state = { ...session.slots[4]!.state };
    const before = session.loadoutOf(1).primary;
    expect(x.takePickupAt(session.slots[1])).toBe(false);
    expect(session.loadoutOf(1).primary).toBe(before);
    expect(session.pickups).toHaveLength(1);
  });
});
