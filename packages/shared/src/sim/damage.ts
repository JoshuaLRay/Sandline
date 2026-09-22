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
 * DOWNED BEFORE DEAD (T-2.13, E-2.6). Health reaching zero no longer kills:
 * the soldier is DOWNED — on the ground, immobile, unable to fire (B-05) —
 * with a bleed-out timer running. A teammate can revive them (T-2.15); nobody does,
 * and the timer expires into death, which then respawns as before. Damage to
 * a downed soldier does not touch health (there is none) but CUTS the timer,
 * so a squad can finish someone rather than wait, and a downed player under
 * fire is not safe. Three states, one order: alive -> downed -> dead ->
 * (respawn) -> alive, with revive the only way back from downed to alive.
 *
 * The whole thing stays a pure function of an injected clock, so a full
 * down, bleed-out, death and respawn sequence is testable in microseconds.
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

export interface DownedConfig {
  /** Seconds from being downed to dying, with nobody reviving. */
  bleedOutSeconds: number;
  /** Seconds a teammate must hold the revive to complete it (T-2.15). */
  reviveSeconds: number;
  /** How close the reviver must be, metres (T-2.15). */
  reviveRangeM: number;
  /** Health a revived soldier gets back, as a fraction of max. */
  reviveHealthFraction: number;
}

export interface DamageConfig {
  maxHealth: number;
  respawnSeconds: number;
  downed: DownedConfig;
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

  const rawDowned = row['downed'];
  if (typeof rawDowned !== 'object' || rawDowned === null) throw new DamageDataError('damage.downed: expected an object');
  const d = rawDowned as Record<string, unknown>;
  const downed: DownedConfig = {
    bleedOutSeconds: num(d, 'bleedOutSeconds', 'damage.downed', 1, 300),
    reviveSeconds: num(d, 'reviveSeconds', 'damage.downed', 0, 30),
    reviveRangeM: num(d, 'reviveRangeM', 'damage.downed', 0.1, 10),
    reviveHealthFraction: num(d, 'reviveHealthFraction', 'damage.downed', 0.01, 1),
  };

  return {
    maxHealth: num(row, 'maxHealth', 'damage', 1, 1000),
    respawnSeconds: num(row, 'respawnSeconds', 'damage', 0, 60),
    downed,
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
  /**
   * Server time the soldier went down, or null. Damage taken while downed
   * moves this EARLIER, which is how it shortens the bleed-out without a
   * second timer.
   */
  downedAt: number | null;
  /** Server time of death, or null while alive or downed. */
  diedAt: number | null;
}

export type Vitality = 'alive' | 'downed' | 'dead';

export function createHealth(config: DamageConfig = DAMAGE): HealthState {
  return { current: config.maxHealth, max: config.maxHealth, downedAt: null, diedAt: null };
}

export function vitality(health: HealthState): Vitality {
  if (health.diedAt !== null) return 'dead';
  if (health.downedAt !== null) return 'downed';
  return 'alive';
}

/** On their feet: moving freely, shooting, able to revive. */
export function isAlive(health: HealthState): boolean {
  return vitality(health) === 'alive';
}

export function isDowned(health: HealthState): boolean {
  return vitality(health) === 'downed';
}

export function isDead(health: HealthState): boolean {
  return vitality(health) === 'dead';
}

/** Wire code for a vitality, 2 bits. Part of the protocol: append only. */
export function vitalityCode(v: Vitality): number {
  return v === 'alive' ? 0 : v === 'downed' ? 1 : 2;
}

export function vitalityFromCode(code: number): Vitality {
  return code === 1 ? 'downed' : code === 2 ? 'dead' : 'alive';
}

export interface DamageResult {
  /** Health actually removed, after clamping to what was left. Zero once downed. */
  applied: number;
  /** True only on the shot that put them down — never on later shots. */
  downed: boolean;
  /**
   * True only on the shot that killed. Since T-2.13 that is a shot that
   * exhausts a downed soldier's bleed-out, never a shot that empties health.
   */
  killed: boolean;
  /** Seconds taken off the bleed-out by a shot on a downed soldier. */
  bleedOutCutSeconds: number;
  remaining: number;
}

const NOTHING = (health: HealthState): DamageResult => ({
  applied: 0,
  downed: false,
  killed: false,
  bleedOutCutSeconds: 0,
  remaining: health.current,
});

/**
 * Apply damage. Mutates, and reports what happened.
 *
 * Alive: health comes off, and reaching zero DOWNS rather than kills.
 *
 * Downed: health is already zero, so the damage is taken off the bleed-out
 * instead, scaled so that one health bar's worth of damage finishes the
 * timer: `bleedOutSeconds x amount / maxHealth`. Exhausting it kills, and
 * that is the only way a shot kills.
 *
 * Dead: nothing, and never a second kill. That matters for more than
 * tidiness: with lag compensation two players can both land the finishing
 * shot on a target that was downed in each of their rewound worlds, and
 * awarding two kills for one death is the visible symptom.
 */
export function applyDamage(
  health: HealthState,
  amount: number,
  nowSeconds: number,
  config: DamageConfig = DAMAGE,
): DamageResult {
  if (!Number.isFinite(amount) || amount <= 0) return NOTHING(health);
  const state = vitality(health);
  if (state === 'dead') return NOTHING(health);

  if (state === 'downed') {
    const cut = (config.downed.bleedOutSeconds * Math.min(amount, health.max)) / health.max;
    health.downedAt = (health.downedAt as number) - cut;
    const killed = bleedOutRemaining(health, nowSeconds, config) <= 0;
    if (killed) health.diedAt = nowSeconds;
    return { applied: 0, downed: false, killed, bleedOutCutSeconds: cut, remaining: 0 };
  }

  const applied = Math.min(amount, health.current);
  health.current -= applied;
  const downed = health.current <= 0;
  if (downed) {
    health.current = 0;
    health.downedAt = nowSeconds;
  }
  return { applied, downed, killed: false, bleedOutCutSeconds: 0, remaining: health.current };
}

/** Seconds of bleed-out left, or 0 when not downed or already due. */
export function bleedOutRemaining(health: HealthState, nowSeconds: number, config: DamageConfig = DAMAGE): number {
  if (health.downedAt === null || health.diedAt !== null) return 0;
  const left = config.downed.bleedOutSeconds - (nowSeconds - health.downedAt);
  return left > 0 ? left : 0;
}

/**
 * Let a downed soldier's timer run out. Returns true on the tick it does,
 * once: the caller stops their movement then, exactly as a killing shot
 * would.
 */
export function expireBleedOut(health: HealthState, nowSeconds: number, config: DamageConfig = DAMAGE): boolean {
  if (!isDowned(health) || bleedOutRemaining(health, nowSeconds, config) > 0) return false;
  health.diedAt = nowSeconds;
  return true;
}

/**
 * Back on their feet with a fraction of their health. Only a downed soldier
 * can be revived; the interaction that calls this is T-2.15's.
 */
export function revive(health: HealthState, config: DamageConfig = DAMAGE): boolean {
  if (!isDowned(health)) return false;
  health.current = Math.max(1, Math.round(health.max * config.downed.reviveHealthFraction));
  health.downedAt = null;
  return true;
}

/**
 * Seconds left in whatever phase the soldier is in: the bleed-out while
 * downed, the respawn while dead, zero while alive. Replicated so the HUD can
 * count down honestly rather than timing from when it first saw a zero.
 */
export function vitalTimer(health: HealthState, nowSeconds: number, config: DamageConfig = DAMAGE): number {
  switch (vitality(health)) {
    case 'downed':
      return bleedOutRemaining(health, nowSeconds, config);
    case 'dead':
      return respawnRemaining(health, nowSeconds, config);
    default:
      return 0;
  }
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

/** Restore to full and clear both the downed and the death state. */
export function respawn(health: HealthState, config: DamageConfig = DAMAGE): void {
  health.current = config.maxHealth;
  health.max = config.maxHealth;
  health.downedAt = null;
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
