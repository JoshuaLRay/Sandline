import { describe, expect, it } from 'vitest';
import {
  DAMAGE,
  type DamageConfig,
  SPAWN_POINTS,
  applyDamage,
  createHealth,
  isAlive,
  parseDamageConfig,
  readyToRespawn,
  respawn,
  respawnRemaining,
  spawnFor,
  zoneAt,
  zoneDamage,
} from './damage.ts';

/**
 * Own constants, per §2.3: retuning data/damage.json must never change what
 * these prove.
 */
const CONFIG: DamageConfig = {
  maxHealth: 100,
  respawnSeconds: 5,
  zones: {
    head: { multiplier: 2, minFraction: 0.8 },
    torso: { multiplier: 1, minFraction: 0.4 },
    limb: { multiplier: 0.5, minFraction: 0 },
  },
};

/** A 1.8 m figure standing on the ground. */
const FEET = 0;
const HEIGHT = 1.8;

describe('hit zones', () => {
  it('reads the zone from height up the hitbox', () => {
    expect(zoneAt(1.7, FEET, HEIGHT, CONFIG)).toBe('head');
    expect(zoneAt(1.2, FEET, HEIGHT, CONFIG)).toBe('torso');
    expect(zoneAt(0.4, FEET, HEIGHT, CONFIG)).toBe('limb');
  });

  it('is measured relative to the feet, not to the world', () => {
    // The same shot height is a headshot on someone standing in a trench and a
    // leg shot on someone on a crate. Fractions, not metres.
    expect(zoneAt(1.7, FEET, HEIGHT, CONFIG)).toBe('head');
    expect(zoneAt(1.7, 1, HEIGHT, CONFIG)).toBe('limb');
  });

  it('scales with the figure rather than assuming 1.8 m', () => {
    expect(zoneAt(2.2, FEET, 2.4, CONFIG)).toBe('head');
    // The same absolute height on a taller figure is a torso hit.
    expect(zoneAt(1.7, FEET, 2.4, CONFIG)).toBe('torso');
  });

  it('treats a graze above the top of the capsule as a headshot', () => {
    // A shot clipping the very top of a capsule's cap can compute a fraction
    // slightly over 1. That is a headshot, not an error.
    expect(zoneAt(1.9, FEET, HEIGHT, CONFIG)).toBe('head');
  });

  it('applies the multiplier, and never returns negative damage', () => {
    expect(zoneDamage(20, 'head', CONFIG)).toBe(40);
    expect(zoneDamage(20, 'torso', CONFIG)).toBe(20);
    expect(zoneDamage(20, 'limb', CONFIG)).toBe(10);
    expect(zoneDamage(-5, 'head', CONFIG)).toBe(0);
    expect(zoneDamage(NaN, 'head', CONFIG)).toBe(0);
  });
});

describe('cumulative damage', () => {
  it('kills at the correct threshold, not before', () => {
    const h = createHealth(CONFIG);
    // Four 22-damage carbine torso hits is 88: still standing.
    for (let i = 0; i < 4; i += 1) {
      const r = applyDamage(h, 22, 0);
      expect(r.killed).toBe(false);
    }
    expect(h.current).toBe(100 - 88);
    expect(isAlive(h)).toBe(true);

    // The fifth crosses it.
    const fatal = applyDamage(h, 22, 1);
    expect(fatal.killed).toBe(true);
    expect(fatal.applied).toBe(12); // clamped to what was left, not 22
    expect(h.current).toBe(0);
    expect(isAlive(h)).toBe(false);
  });

  it('takes fewer headshots than torso shots, by exactly the multiplier', () => {
    // Counts DERIVED from the fixture rather than written in: change a
    // multiplier and this still tests the property instead of a stale number.
    const perHead = zoneDamage(22, 'head', CONFIG);
    const perTorso = zoneDamage(22, 'torso', CONFIG);
    const headshotsToKill = Math.ceil(CONFIG.maxHealth / perHead);
    const torsoShotsToKill = Math.ceil(CONFIG.maxHealth / perTorso);
    expect(headshotsToKill).toBeLessThan(torsoShotsToKill);

    const h = createHealth(CONFIG);
    for (let i = 1; i < headshotsToKill; i += 1) {
      expect(applyDamage(h, perHead, 0).killed).toBe(false);
    }
    expect(applyDamage(h, perHead, 0).killed).toBe(true);
  });

  it('cannot kill the same target twice', () => {
    /**
     * Not tidiness. Under lag compensation two players can each fire a fatal
     * shot at a target that was alive in their own rewound world, and awarding
     * two kills for one death is how that shows up.
     */
    const h = createHealth(CONFIG);
    applyDamage(h, 500, 0);
    const second = applyDamage(h, 500, 0);
    expect(second.killed).toBe(false);
    expect(second.applied).toBe(0);
    expect(h.diedAt).toBe(0);
  });

  it('ignores nonsense amounts', () => {
    const h = createHealth(CONFIG);
    expect(applyDamage(h, 0, 0).applied).toBe(0);
    expect(applyDamage(h, -10, 0).applied).toBe(0);
    expect(applyDamage(h, NaN, 0).applied).toBe(0);
    expect(h.current).toBe(100);
  });
});

describe('death and respawn', () => {
  it('waits the full delay, then restores full health', () => {
    const h = createHealth(CONFIG);
    applyDamage(h, 500, 10);

    expect(readyToRespawn(h, 10, CONFIG)).toBe(false);
    expect(readyToRespawn(h, 14.9, CONFIG)).toBe(false);
    expect(readyToRespawn(h, 15, CONFIG)).toBe(true);

    respawn(h, CONFIG);
    expect(h.current).toBe(CONFIG.maxHealth);
    expect(isAlive(h)).toBe(true);
    expect(readyToRespawn(h, 100, CONFIG)).toBe(false);
  });

  it('counts the timer down for the HUD, and floors at zero', () => {
    const h = createHealth(CONFIG);
    expect(respawnRemaining(h, 0, CONFIG)).toBe(0); // alive
    applyDamage(h, 500, 10);
    expect(respawnRemaining(h, 10, CONFIG)).toBe(5);
    expect(respawnRemaining(h, 12.5, CONFIG)).toBe(2.5);
    expect(respawnRemaining(h, 99, CONFIG)).toBe(0);
  });

  it('gives every slot its own spawn point', () => {
    // ADR-001: six slots, always. A respawn must not drop a player on top of a
    // teammate.
    expect(SPAWN_POINTS.length).toBe(6);
    const seen = new Set(SPAWN_POINTS.map((p) => `${p.x},${p.y},${p.z}`));
    expect(seen.size).toBe(6);
    expect(spawnFor(0)).toEqual(SPAWN_POINTS[0]);
    expect(spawnFor(5)).toEqual(SPAWN_POINTS[5]);
    // Never undefined, whatever index arrives.
    expect(spawnFor(11)).toEqual(SPAWN_POINTS[5]);
  });
});

describe('damage data', () => {
  it('ships a table that validates', () => {
    expect(DAMAGE.maxHealth).toBeGreaterThan(0);
    expect(DAMAGE.zones.head.multiplier).toBeGreaterThan(DAMAGE.zones.torso.multiplier);
    expect(DAMAGE.zones.limb.multiplier).toBeLessThan(DAMAGE.zones.torso.multiplier);
  });

  it('rejects zones that do not stack up', () => {
    const base = JSON.parse(JSON.stringify(DAMAGE)) as DamageConfig;
    expect(() => parseDamageConfig(base)).not.toThrow();

    const headBelowTorso = JSON.parse(JSON.stringify(DAMAGE)) as DamageConfig;
    headBelowTorso.zones.head.minFraction = 0.1;
    expect(() => parseDamageConfig(headBelowTorso)).toThrow(/head must start above torso/);

    const floatingLimb = JSON.parse(JSON.stringify(DAMAGE)) as DamageConfig;
    floatingLimb.zones.limb.minFraction = 0.2;
    expect(() => parseDamageConfig(floatingLimb)).toThrow(/fallback zone/);
  });

  it('rejects a missing or malformed field', () => {
    expect(() => parseDamageConfig({})).toThrow(/zones/);
    expect(() => parseDamageConfig({ ...DAMAGE, maxHealth: 'lots' })).toThrow(/maxHealth/);
  });
});
