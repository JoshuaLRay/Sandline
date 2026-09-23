/**
 * What a fighting brain's leaves read (T-3.20).
 *
 * A brain's context is its body — for an enemy, the session's `EnemyEntity`
 * itself (T-3.10) — and a leaf that fights needs more of it than a walker's:
 * what it knows (memory, target), what it carries (weapon state), how it is
 * doing (suppression, when it was last hurt), and a view of the world beyond
 * itself (`CombatWorld`: cover, geometry, the time, where soldiers are). The
 * session hands every enemy the same `CombatWorld`; a body without one (a bot
 * slot, a test's bare body) is simply not a fighter, and the fighting leaves
 * fail on it rather than throw.
 */
import { DEFAULT_MUZZLE_RIG, type SuppressionState, type TargetMemory, type WeaponDef, type WeaponState, type WorldBox } from '@sandline/shared';
import type { BrainBody } from '../Brain.ts';
import type { CoverSystem } from '../cover.ts';

export type Vec3 = { x: number; y: number; z: number };

/** The world as a fighting brain may see it: the session's, shared by every enemy. */
export interface CombatWorld {
  /** Cover on this world (T-3.19), or null for a world with no bake. */
  readonly cover: CoverSystem | null;
  readonly boxes: readonly WorldBox[];
  /** Session time, seconds. */
  now(): number;
  /** A living soldier's eye where it is now, or null. What a brain aims its cover against once it has seen it. */
  eyeOf(netId: number): Vec3 | null;
  /** Feet of the other living soldiers on `faction`'s side, for crowding. */
  friendsOf(netId: number, faction: number): Vec3[];
}

/** A body that can fight: an enemy, as the session builds it. */
export interface CombatBody extends BrainBody {
  readonly faction: number;
  readonly target: number | null;
  readonly memory: TargetMemory;
  readonly weapon: WeaponDef;
  readonly weaponState: WeaponState;
  readonly suppression: SuppressionState;
  /** When it was last hurt, seconds, or −Infinity. */
  readonly lastDamagedAt: number;
  readonly combat: CombatWorld;
}

export function isCombatBody(body: BrainBody): body is CombatBody {
  return 'combat' in body && (body as { combat?: unknown }).combat != null;
}

/**
 * Where a brain believes its target's eye is. Seen on its latest think: the
 * soldier's eye as it stands. Otherwise the remembered position — a shot is
 * remembered at the shooter's eye, a sighting at its feet, so a position near
 * the ground is lifted to eye height — which is what cover is chosen against
 * when the brain has only heard it.
 */
export function threatEye(body: CombatBody): Vec3 | null {
  if (body.target === null) return null;
  const entry = body.memory.entries.get(body.target);
  if (!entry) return null;
  if (entry.visible) {
    const live = body.combat.eyeOf(body.target);
    if (live) return live;
  }
  const lift = entry.y - body.state.y < DEFAULT_MUZZLE_RIG.eyeHeight * 0.5 ? DEFAULT_MUZZLE_RIG.eyeHeight : 0;
  return { x: entry.x, y: entry.y + lift, z: entry.z };
}

/** Horizontal distance. */
export function across(a: Vec3, b: Vec3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
}
