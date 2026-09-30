/**
 * World pickups (U-017): a dead enemy's firearm, lying where it fell, for a
 * soldier to take (U-018 equips it). The rules as data
 * (`data/pickups.json`, validated by hand, unknown keys refused, as every
 * data file is) and the netId band pickups are given.
 *
 * The session makes and clears them (`server/src/session/Session.ts`) — no
 * client message can — and replicates each as an entity: its place on
 * `Transform`, what it is on `Pickup` (`ecs/components.ts`).
 */
import RAW from '../data/pickups.json' with { type: 'json' };
import { ENEMY_NET_ID_LIMIT } from './enemies.ts';
import { FIRST_PROJECTILE_NET_ID } from './ballistics.ts';
import { WEAPON_IDS } from './weapons.ts';

export interface PickupRules {
  /** How long a pickup lies before it goes, seconds. */
  despawnSeconds: number;
  /** The most that lie in a session at once; the oldest goes first. */
  max: number;
  /** U-018: how near a soldier's eye must be to take one, metres. */
  reachM: number;
  /** The weapons a dead enemy drops (WEAPON_IDS entries); anything else drops nothing. */
  weapons: readonly string[];
}

export class PickupDataError extends Error {}

export function parsePickups(raw: unknown): PickupRules {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new PickupDataError('pickups: expected an object');
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!['despawnSeconds', 'max', 'reachM', 'weapons', '$comment'].includes(k)) throw new PickupDataError(`pickups: unknown key '${k}'`);
  const despawnSeconds = o['despawnSeconds'];
  if (typeof despawnSeconds !== 'number' || !Number.isFinite(despawnSeconds) || despawnSeconds <= 0 || despawnSeconds > 3600) {
    throw new PickupDataError(`pickups.despawnSeconds must be in (0, 3600], got ${JSON.stringify(despawnSeconds)}`);
  }
  const max = o['max'];
  if (typeof max !== 'number' || !Number.isInteger(max) || max < 1 || max > 64) throw new PickupDataError(`pickups.max must be a whole number in [1, 64], got ${JSON.stringify(max)}`);
  const reachM = o['reachM'];
  if (typeof reachM !== 'number' || !Number.isFinite(reachM) || reachM <= 0 || reachM > 3) throw new PickupDataError(`pickups.reachM must be in (0, 3], got ${JSON.stringify(reachM)}`);
  const weapons = o['weapons'];
  if (!Array.isArray(weapons)) throw new PickupDataError('pickups.weapons must be a list of weapon ids');
  for (const [i, w] of weapons.entries()) {
    if (typeof w !== 'string' || !(WEAPON_IDS as readonly string[]).includes(w)) throw new PickupDataError(`pickups.weapons[${i}]: '${String(w)}' is not a loadout weapon (${WEAPON_IDS.join(', ')})`);
  }
  return { despawnSeconds, max, reachM, weapons: weapons as string[] };
}

export const PICKUPS: PickupRules = parsePickups(RAW);

/**
 * Where pickup netIds start, and the first one past them: the top of what
 * was the enemy band (`ENEMY_NET_ID_LIMIT` moved down to make room), under
 * projectiles, so a pickup costs the two-byte varuint an enemy does. Never
 * reused within a session (NetId's rule: a reused id is a pickup that
 * teleports on a client still holding the old one), so a session that has
 * dropped 4,096 drops no more — a rail no mission comes near.
 */
export const FIRST_PICKUP_NET_ID = ENEMY_NET_ID_LIMIT;
export const PICKUP_NET_ID_LIMIT = FIRST_PROJECTILE_NET_ID;

/** True for a netId in the pickup band. */
export function isPickupNetId(netId: number): boolean {
  return netId >= FIRST_PICKUP_NET_ID && netId < PICKUP_NET_ID_LIMIT;
}

/**
 * Bits a pickup's item and its rounds (or count) take on the wire. The item is a WEAPON_IDS index, or, from
 * WEAPON_IDS.length up, a dropped piece of equipment (U-048): `PROJECTILE_IDS` index plus WEAPON_IDS.length, its
 * amount the count it carries.
 */
export const PICKUP_WEAPON_BITS = 5;
export const PICKUP_AMMO_BITS = 7;

/** The `PROJECTILE_IDS` index a pickup's item stands for, or -1 when it is a gun (U-048). */
export function pickupProjectile(item: number): number {
  return item >= WEAPON_IDS.length ? item - WEAPON_IDS.length : -1;
}
