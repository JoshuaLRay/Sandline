/**
 * U-017: the pickup rules parse and refuse what is wrong by name; the netId
 * bands stay apart (enemies, then pickups, then projectiles); and what a
 * pickup carries fits the bits the wire gives it.
 */
import { describe, expect, it } from 'vitest';
import RAW from '../data/pickups.json' with { type: 'json' };
import { COMPONENT_IDS } from '../ecs/components.ts';
import { SCHEMAS } from '../net/schema.ts';
import { FIRST_PROJECTILE_NET_ID } from './ballistics.ts';
import { ENEMY_NET_ID_LIMIT, FIRST_ENEMY_NET_ID, getEnemy, isEnemyNetId } from './enemies.ts';
import { FIRST_PICKUP_NET_ID, PICKUPS, PICKUP_AMMO_BITS, PICKUP_NET_ID_LIMIT, PICKUP_WEAPON_BITS, isPickupNetId, parsePickups } from './pickups.ts';
import { WEAPON_IDS, getWeapon } from './weapons.ts';

describe('pickup rules (U-017)', () => {
  it('ships the squad\'s primaries as droppable, and a bounded lifetime and count', () => {
    expect(PICKUPS.weapons).toEqual(['carbine', 'marksman', 'breacher']);
    expect(PICKUPS.despawnSeconds).toBeGreaterThan(0);
    expect(PICKUPS.max).toBeGreaterThan(0);
    // The documented no: the MG enemy's LMG is not a loadout weapon (yet), so it drops nothing.
    expect(getEnemy('mg').weapon).toBe('lmg');
    expect(PICKUPS.weapons).not.toContain('lmg');
    expect(PICKUPS.weapons).toContain(getEnemy('rifleman').weapon);
  });

  it('refuses what is wrong, each by name', () => {
    expect(() => parsePickups({ ...RAW, colour: 'red' })).toThrow("pickups: unknown key 'colour'");
    expect(() => parsePickups({ ...RAW, despawnSeconds: 0 })).toThrow('pickups.despawnSeconds');
    expect(() => parsePickups({ ...RAW, max: 0 })).toThrow('pickups.max');
    expect(() => parsePickups({ ...RAW, reachM: 5 })).toThrow('pickups.reachM must be in (0, 3]');
    expect(() => parsePickups({ ...RAW, weapons: ['ghost-gun'] })).toThrow("pickups.weapons[0]: 'ghost-gun' is not a loadout weapon");
  });

  it('keeps the netId bands apart: enemies, then pickups, then projectiles', () => {
    expect(FIRST_PICKUP_NET_ID).toBe(ENEMY_NET_ID_LIMIT);
    expect(PICKUP_NET_ID_LIMIT).toBe(FIRST_PROJECTILE_NET_ID);
    expect(PICKUP_NET_ID_LIMIT - FIRST_PICKUP_NET_ID).toBe(4096);
    expect(ENEMY_NET_ID_LIMIT - FIRST_ENEMY_NET_ID).toBeGreaterThan(10_000);
    expect(isPickupNetId(FIRST_PICKUP_NET_ID)).toBe(true);
    expect(isPickupNetId(PICKUP_NET_ID_LIMIT - 1)).toBe(true);
    expect(isPickupNetId(FIRST_PICKUP_NET_ID - 1)).toBe(false);
    expect(isPickupNetId(FIRST_PROJECTILE_NET_ID)).toBe(false);
    expect(isEnemyNetId(FIRST_PICKUP_NET_ID)).toBe(false);
  });

  it('fits the wire: every weapon index and every droppable magazine', () => {
    expect(WEAPON_IDS.length).toBeLessThanOrEqual(1 << PICKUP_WEAPON_BITS);
    for (const id of PICKUPS.weapons) expect(getWeapon(id).magSize, id).toBeLessThan(1 << PICKUP_AMMO_BITS);
    const schema = SCHEMAS.find((c) => c.id === COMPONENT_IDS.Pickup)!;
    expect(schema.fields.map((f) => f.name)).toEqual(['weapon', 'ammo']);
  });
});
