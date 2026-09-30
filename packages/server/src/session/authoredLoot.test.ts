/**
 * U-052: authored loot. A mission places a left-handed gun on the ground; only the
 * left-handed sniper (slot 4) takes it; it stays until taken; and a checkpoint
 * keeps what each soldier carried and what still lay on the ground.
 */
import { describe, expect, it } from 'vitest';
import { PICKUPS, WEAPON_IDS } from '@sandline/shared';
import { Session } from './Session.ts';

interface Internals {
  placePickupItem(weapon: number, ammo: number, at: { x: number; y: number; z: number }, yaw: number, authored?: boolean): void;
  placePickup(id: string, ammo: number, at: { x: number; y: number; z: number }, yaw: number): void;
  takePickupAt(slot: unknown): boolean;
  expirePickups(nowSeconds: number): void;
  captureMissionCheckpoint(): void;
  restoreCheckpointWorld(saved: unknown): void;
  missionCheckpointState: unknown;
  pickupList: unknown[];
}

const LEFT = WEAPON_IDS.indexOf('sniper-semi-left');

function room() {
  const session = new Session(undefined, '', 'range', { roomLobby: true });
  const x = session as unknown as Internals;
  const stand = (n: number) => {
    session.slots[n]!.state = { ...session.slots[n]!.state, x: 0, y: 0, z: 0 };
  };
  return { session, x, stand };
}

describe('authored loot (U-052)', () => {
  it('only the left-handed sniper takes an authored left-handed gun', () => {
    const { session, x, stand } = room();
    x.placePickupItem(LEFT, 7, { x: 0, y: 0, z: 0 }, 0, true);
    for (const n of [0, 1, 2, 3, 5]) {
      stand(n);
      expect(x.takePickupAt(session.slots[n]), `slot ${n}`).toBe(false);
    }
    expect(session.pickups).toHaveLength(1);
    stand(4);
    expect(x.takePickupAt(session.slots[4])).toBe(true);
    expect(session.loadoutOf(4)).toMatchObject({ primary: 'sniper-semi-left', weapon: 'sniper-semi-left', ammo: 7 });
    // The gun it replaces goes down where he stands, and is still his to take back.
    expect(session.pickups.map((p) => WEAPON_IDS[p.weapon])).toEqual(['sniper-bolt-left']);
    expect(x.takePickupAt(session.slots[4])).toBe(true);
    expect(session.loadoutOf(4).primary).toBe('sniper-bolt-left');
  });

  it('does not despawn, and does not count toward the enemy-drop cap', () => {
    const { session, x } = room();
    x.placePickupItem(LEFT, 10, { x: 40, y: 0, z: 40 }, 0, true);
    for (let i = 0; i < PICKUPS.max + 3; i++) x.placePickup('carbine', 5, { x: 40 + i, y: 0, z: 40 }, 0);
    expect(session.pickups.filter((p) => p.weapon !== LEFT)).toHaveLength(PICKUPS.max);
    expect(session.pickups.some((p) => p.weapon === LEFT)).toBe(true);
    x.expirePickups(PICKUPS.despawnSeconds * 10);
    expect(session.pickups.map((p) => p.weapon)).toEqual([LEFT]);
  });

  it('a checkpoint keeps the loot he took, and the loot still on the ground', () => {
    const { session, x, stand } = room();
    x.placePickupItem(LEFT, 6, { x: 0, y: 0, z: 0 }, 0, true);
    x.placePickupItem(LEFT, 9, { x: 30, y: 0, z: 30 }, 0, true);
    stand(4);
    expect(x.takePickupAt(session.slots[4])).toBe(true);
    session.slots[4]!.weaponState.ammo = 4;
    session.slots[1]!.pouch = session.slots[1]!.pouch.map(() => 0);
    x.captureMissionCheckpoint();
    // Later the squad fails: the sniper is back with his class gun, the ground is bare.
    x.pickupList.length = 0;
    session.slots[4]!.primary = 'sniper-bolt-left';
    x.restoreCheckpointWorld(x.missionCheckpointState);
    expect(session.loadoutOf(4)).toMatchObject({ primary: 'sniper-semi-left', weapon: 'sniper-semi-left', ammo: 4 });
    expect(session.slots[1]!.pouch.every((n) => n === 0)).toBe(true);
    const ground = session.pickups.map((p) => [WEAPON_IDS[p.weapon], p.ammo, p.x, p.z]);
    expect(ground).toContainEqual(['sniper-bolt-left', 5, 0, 0]);
    expect(ground).toContainEqual(['sniper-semi-left', 9, 30, 30]);
    // Restored authored loot is still authored: it does not despawn.
    x.expirePickups(PICKUPS.despawnSeconds * 10);
    expect(session.pickups.some((p) => p.weapon === LEFT)).toBe(true);
  });
});
