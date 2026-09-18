/**
 * Damage, death and respawn (T-1.19).
 *
 * Pure functions over an injected clock, like everything else in `sim`: the
 * respawn timer is a comparison against a time that is handed in, never read,
 * so a death-and-respawn sequence is exactly testable without waiting five
 * seconds for it.
 *
 * NOT predicted. §2.3 is explicit that damage is replicated and may diverge
 * freely, so this runs on the server only and the client learns the result. The
 * temptation is to predict a kill so the hit marker feels instant; resist it.
 * Hit markers already arrive on the server's schedule (T-1.18) and predicting a
 * death you then have to take back is far worse than a hit marker arriving
 * 80 ms late.
 *
 * Downed-and-revive is M2 (ADR-002). Death here is death.
 */
import RAW_DAMAGE from '../data/damage.json' with { type: 'json' };

/** Which part of a hitbox a shot landed on. */
export type HitZone = 'head' | 'torso' | 'limb';

export interface ZoneRule {
  /** Damage scale for this zone. */
  multiplier: number;
  /**
   * Lowest fraction of the hitbox's total height that counts as this zone.
   *
   * Fractions rather than metres so the zones survive a change of character
   * height: a 1.8 m soldier and a 2.4 m heavy should both be headshot at the
   * top of the head, not at 1.4 m.
   */
  minFraction: number;
}

export interface DamageConfig {
  maxHealth: number;
  respawnSeconds: number;
  zones: Record<HitZone, ZoneRule>;
}

class DamageDataError extends Error {}

function num(row: Record<string, unknown>, key: string, where: string, min: number, max: number): number {
  const v = row[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new DamageDataError(`${where}.${key} must be a finite number, got ${String(v)}`);
  }
  if (v < min || v > max) throw new DamageDataError(`${where}.${key} must be in [${min}, ${max}], got ${v}`);
  return v;
}

/** Validate the damage table. Hand-written for the reason weapons.ts gives. */
export function parseDamageConfig(raw: unknown): DamageConfig {
  if (typeof raw !== 'object' || raw === null) throw new DamageDataError('damage: expected an object');
  const row = raw as Record<string, unknown>;
  const rawZones = row['zones'];
  if (typeof rawZones !== 'object' || rawZones === null) throw new DamageDataError('damage.zones: expected an object');
  const zoneRows = rawZones as Record<string, unknown>;

  const zones = {} as Record<HitZone, ZoneRule>;
  for (const name of ['head', 'torso', 'limb'] as const) {
    const zoneRow = zoneRows[name];
    if (typeof zoneRow !== 'object' || zoneRow === null) {
      throw new DamageDataError(`damage.zones.${name}: expected an object`);
    }
    const r = zoneRow as Record<string, unknown>;
    zones[name] = {
      multiplier: num(r, 'multiplier', `damage.zones.${name}`, 0, 10),
      minFraction: num(r, 'minFraction', `damage.zones.${name}`, 0, 1),
    };
  }

  if (zones.limb.minFraction !== 0) {
    throw new DamageDataError('damage.zones.limb.minFraction must be 0: it is the fallback zone');
  }
  if (zones.head.minFraction <= zones.torso.minFraction) {
    throw new DamageDataError('damage.zones: head must start above torso');
  }

  return {
    maxHealth: num(row, 'maxHealth', 'damage', 1, 1000),
    respawnSeconds: num(row, 'respawnSeconds', 'damage', 0, 60),
    zones,
  };
}

export const DAMAGE: DamageConfig = Object.freeze(parseDamageConfig(RAW_DAMAGE));

/**
 * Which zone an impact landed in, from its height up the hitbox.
 *
 * `impactY` and `feetY` are world heights; `totalHeight` is the hitbox's full
 * extent. Anything outside [0, 1] clamps rather than throwing — a shot grazing
 * the very top of a capsule's cap can compute a fraction slightly above 1, and
 * that is a headshot, not an error.
 */
export function zoneAt(impactY: number, feetY: number, totalHeight: number, config: DamageConfig = DAMAGE): HitZone {
  if (totalHeight <= 0) return 'torso';
  const fraction = (impactY - feetY) / totalHeight;
  if (fraction >= config.zones.head.minFraction) return 'head';
  if (fraction >= config.zones.torso.minFraction) return 'torso';
  return 'limb';
}

/** Damage after the zone multiplier. Never negative. */
export function zoneDamage(base: number, zone: HitZone, config: DamageConfig = DAMAGE): number {
  if (!Number.isFinite(base) || base <= 0) return 0;
  return base * config.zones[zone].multiplier;
}

export interface HealthState {
  current: number;
  max: number;
  /** Server time of death, or null while alive. */
  diedAt: number | null;
}

export function createHealth(config: DamageConfig = DAMAGE): HealthState {
  return { current: config.maxHealth, max: config.maxHealth, diedAt: null };
}

export function isAlive(health: HealthState): boolean {
  return health.diedAt === null;
}

export interface DamageResult {
  /** Damage actually taken, after clamping to remaining health. */
  applied: number;
  /** True only on the shot that killed — never on subsequent shots. */
  killed: boolean;
  remaining: number;
}

/**
 * Apply damage. Mutates, and reports what happened.
 *
 * A dead target takes nothing further and cannot be killed twice. That matters
 * for more than tidiness: with lag compensation two players can both fire a
 * fatal shot at a target that was alive in each of their rewound worlds, and
 * awarding two kills for one death is the visible symptom.
 */
export function applyDamage(health: HealthState, amount: number, nowSeconds: number): DamageResult {
  if (!isAlive(health) || !Number.isFinite(amount) || amount <= 0) {
    return { applied: 0, killed: false, remaining: health.current };
  }
  const applied = Math.min(amount, health.current);
  health.current -= applied;
  const killed = health.current <= 0;
  if (killed) {
    health.current = 0;
    health.diedAt = nowSeconds;
  }
  return { applied, killed, remaining: health.current };
}

/** Whether a dead player's respawn timer has elapsed. */
export function readyToRespawn(health: HealthState, nowSeconds: number, config: DamageConfig = DAMAGE): boolean {
  return health.diedAt !== null && nowSeconds - health.diedAt >= config.respawnSeconds;
}

/** Seconds left on the respawn timer, or 0 when alive or already due. */
export function respawnRemaining(health: HealthState, nowSeconds: number, config: DamageConfig = DAMAGE): number {
  if (health.diedAt === null) return 0;
  const left = config.respawnSeconds - (nowSeconds - health.diedAt);
  return left > 0 ? left : 0;
}

/** Restore to full and clear the death state. */
export function respawn(health: HealthState, config: DamageConfig = DAMAGE): void {
  health.current = config.maxHealth;
  health.max = config.maxHealth;
  health.diedAt = null;
}

/**
 * Spawn points, in the order slots claim them.
 *
 * Six, one per slot (ADR-001), spread so a respawn does not drop a player on
 * top of a teammate, and set BEHIND the firing line rather than on it.
 *
 * They used to sit in a row at z = 0, 1.5 m apart, which put five teammates
 * directly in each other's field of fire — and since there is no collision yet
 * (T-1.12), strafing swept the muzzle straight through them. Every shot then
 * terminated on whichever body it happened to be inside.
 *
 * Shared because the server picks from them and the client draws them; a QA
 * range has no contested spawns to reason about yet, so "the slot's own point"
 * is the whole selection policy and a farthest-from-enemies rule is M2's.
 */
export const SPAWN_POINTS: readonly { x: number; y: number; z: number }[] = [
  { x: -3.75, y: 0, z: -6 },
  { x: -2.25, y: 0, z: -6 },
  { x: -0.75, y: 0, z: -6 },
  { x: 0.75, y: 0, z: -6 },
  { x: 2.25, y: 0, z: -6 },
  { x: 3.75, y: 0, z: -6 },
];

export function spawnFor(slotIndex: number): { x: number; y: number; z: number } {
  return SPAWN_POINTS[slotIndex % SPAWN_POINTS.length] as { x: number; y: number; z: number };
}
