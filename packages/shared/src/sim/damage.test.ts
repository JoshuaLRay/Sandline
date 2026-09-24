import { describe, expect, it } from 'vitest';
import {
  DAMAGE,
  type DamageConfig,
  SPAWN_POINTS,
  applyDamage,
  bleedOutRemaining,
  createHealth,
  expireBleedOut,
  isAlive,
  isImmune,
  isDead,
  isDowned,
  parseDamageConfig,
  readyToRespawn,
  respawn,
  respawnRemaining,
  revive,
  spawnFor,
  vitalTimer,
  vitality,
  vitalityCode,
  vitalityFromCode,
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
  respawnImmunitySeconds: 2,
  downed: { bleedOutSeconds: 20, reviveSeconds: 3, reviveRangeM: 1.5, reviveHealthFraction: 0.4 },
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
  it('downs at the correct threshold, not before (T-2.13: zero health downs, it does not kill)', () => {
    const h = createHealth(CONFIG);
    // Four 22-damage carbine torso hits is 88: still standing.
    for (let i = 0; i < 4; i += 1) {
      const r = applyDamage(h, 22, 0, CONFIG);
      expect(r.downed).toBe(false);
      expect(r.killed).toBe(false);
    }
    expect(h.current).toBe(100 - 88);
    expect(isAlive(h)).toBe(true);

    // The fifth crosses it.
    const drop = applyDamage(h, 22, 1, CONFIG);
    expect(drop.downed).toBe(true);
    expect(drop.killed).toBe(false);
    expect(drop.applied).toBe(12); // clamped to what was left, not 22
    expect(h.current).toBe(0);
    expect(isAlive(h)).toBe(false);
    expect(isDowned(h)).toBe(true);
    expect(isDead(h)).toBe(false);
    expect(h.downedAt).toBe(1);
  });

  it('takes fewer headshots than torso shots, by exactly the multiplier', () => {
    // Counts DERIVED from the fixture rather than written in: change a
    // multiplier and this still tests the property instead of a stale number.
    const perHead = zoneDamage(22, 'head', CONFIG);
    const perTorso = zoneDamage(22, 'torso', CONFIG);
    const headshotsToDown = Math.ceil(CONFIG.maxHealth / perHead);
    const torsoShotsToDown = Math.ceil(CONFIG.maxHealth / perTorso);
    expect(headshotsToDown).toBeLessThan(torsoShotsToDown);

    const h = createHealth(CONFIG);
    for (let i = 1; i < headshotsToDown; i += 1) {
      expect(applyDamage(h, perHead, 0, CONFIG).downed).toBe(false);
    }
    expect(applyDamage(h, perHead, 0, CONFIG).downed).toBe(true);
  });

  it('cannot down the same target twice, and a corpse takes nothing', () => {
    /**
     * Not tidiness. Under lag compensation two players can each land the
     * decisive shot on a target that was standing in their own rewound
     * world; two downs for one drop, or two kills for one death, is how
     * that shows up.
     */
    const h = createHealth(CONFIG);
    expect(applyDamage(h, 500, 0, CONFIG).downed).toBe(true);
    expect(h.downedAt).toBe(0);
    const second = applyDamage(h, 500, 0, CONFIG);
    expect(second.downed).toBe(false);
    expect(second.applied).toBe(0);
    // That second shot was a full health bar's worth on a downed soldier: it
    // finishes them, once.
    expect(second.killed).toBe(true);
    expect(isDead(h)).toBe(true);
    const third = applyDamage(h, 500, 0, CONFIG);
    expect(third).toMatchObject({ applied: 0, downed: false, killed: false, bleedOutCutSeconds: 0 });
  });

  it('ignores nonsense amounts', () => {
    const h = createHealth(CONFIG);
    expect(applyDamage(h, 0, 0).applied).toBe(0);
    expect(applyDamage(h, -10, 0).applied).toBe(0);
    expect(applyDamage(h, NaN, 0).applied).toBe(0);
    expect(h.current).toBe(100);
  });
});

describe('downed and bleed-out (T-2.13)', () => {
  it('bleeds out into death after the configured time, and not before', () => {
    const h = createHealth(CONFIG);
    applyDamage(h, 500, 10, CONFIG);
    expect(vitality(h)).toBe('downed');
    expect(bleedOutRemaining(h, 10, CONFIG)).toBe(20);
    expect(bleedOutRemaining(h, 25, CONFIG)).toBe(5);
    expect(expireBleedOut(h, 29.9, CONFIG)).toBe(false);
    expect(vitality(h)).toBe('downed');
    expect(expireBleedOut(h, 30, CONFIG)).toBe(true);
    expect(vitality(h)).toBe('dead');
    expect(h.diedAt).toBe(30);
    // Once, not every tick after.
    expect(expireBleedOut(h, 31, CONFIG)).toBe(false);
    // And the respawn clock starts at death, not at the drop.
    expect(readyToRespawn(h, 34.9, CONFIG)).toBe(false);
    expect(readyToRespawn(h, 35, CONFIG)).toBe(true);
  });

  it('damage while downed cuts the bleed-out in proportion, and can finish them', () => {
    const h = createHealth(CONFIG);
    applyDamage(h, 500, 0, CONFIG);
    // A quarter of a health bar takes a quarter of the timer.
    const r = applyDamage(h, 25, 1, CONFIG);
    expect(r.applied).toBe(0);
    expect(r.bleedOutCutSeconds).toBeCloseTo(5, 12);
    expect(r.killed).toBe(false);
    expect(bleedOutRemaining(h, 1, CONFIG)).toBeCloseTo(20 - 1 - 5, 12);
    // Overkill counts as one bar, never more.
    expect(applyDamage(h, 5000, 1, CONFIG)).toMatchObject({ killed: true, bleedOutCutSeconds: 20 });
    expect(vitality(h)).toBe('dead');
    expect(h.diedAt).toBe(1);
  });

  it('revive stands them up with a fraction of their health; only the downed can be revived', () => {
    const h = createHealth(CONFIG);
    expect(revive(h, CONFIG)).toBe(false); // alive
    applyDamage(h, 500, 0, CONFIG);
    expect(revive(h, CONFIG)).toBe(true);
    expect(vitality(h)).toBe('alive');
    expect(h.current).toBe(40);
    expect(h.downedAt).toBeNull();
    // Down again from 40, bleed out, and a corpse cannot be revived.
    applyDamage(h, 40, 5, CONFIG);
    expect(vitality(h)).toBe('downed');
    expireBleedOut(h, 100, CONFIG);
    expect(revive(h, CONFIG)).toBe(false);
    expect(vitality(h)).toBe('dead');
  });

  it('reports the seconds left in whichever phase, for the wire', () => {
    const h = createHealth(CONFIG);
    expect(vitalTimer(h, 0, CONFIG)).toBe(0);
    applyDamage(h, 500, 10, CONFIG);
    expect(vitalTimer(h, 12, CONFIG)).toBe(18);
    expireBleedOut(h, 30, CONFIG);
    expect(vitalTimer(h, 31, CONFIG)).toBe(4);
    respawn(h, CONFIG);
    expect(vitalTimer(h, 99, CONFIG)).toBe(0);
    expect(h.downedAt).toBeNull();
    expect(h.diedAt).toBeNull();
  });

  it('round-trips the vitality codes', () => {
    for (const v of ['alive', 'downed', 'dead'] as const) expect(vitalityFromCode(vitalityCode(v))).toBe(v);
    expect(vitalityCode('alive')).toBe(0);
    expect(vitalityFromCode(3)).toBe('alive');
  });
});

describe('death and respawn', () => {
  it('waits the full delay, then restores full health', () => {
    const h = createHealth(CONFIG);
    applyDamage(h, 500, 10, CONFIG);
    expireBleedOut(h, 10 + CONFIG.downed.bleedOutSeconds, CONFIG);
    // Downed at 10, dead at 30: the respawn counts from 30.
    expect(readyToRespawn(h, 30, CONFIG)).toBe(false);
    expect(readyToRespawn(h, 34.9, CONFIG)).toBe(false);
    expect(readyToRespawn(h, 35, CONFIG)).toBe(true);
    respawn(h, CONFIG);
    expect(h.current).toBe(CONFIG.maxHealth);
    expect(isAlive(h)).toBe(true);
    expect(readyToRespawn(h, 100, CONFIG)).toBe(false);
  });

  it('makes a respawned soldier immune for respawnImmunitySeconds, then takes damage again', () => {
    const h = createHealth(CONFIG);
    applyDamage(h, 500, 10, CONFIG);
    expireBleedOut(h, 30, CONFIG);
    respawn(h, CONFIG, 35);
    expect(isImmune(h, 35)).toBe(true);
    // A burst on the spawn point in the first two seconds does nothing.
    expect(applyDamage(h, 500, 35, CONFIG).applied).toBe(0);
    expect(applyDamage(h, 500, 36.9, CONFIG).applied).toBe(0);
    expect(h.current).toBe(CONFIG.maxHealth);
    expect(isAlive(h)).toBe(true);
    expect(isImmune(h, 37)).toBe(false);
    expect(applyDamage(h, 30, 37, CONFIG).applied).toBe(30);
  });

  it('gives no immunity to a soldier who has never respawned, or a respawn with no clock', () => {
    const h = createHealth(CONFIG);
    expect(applyDamage(h, 30, 0, CONFIG).applied).toBe(30);
    respawn(h, CONFIG, 10);
    respawn(h, CONFIG); // a mission restart
    expect(applyDamage(h, 30, 10, CONFIG).applied).toBe(30);
  });

  it('counts the timer down for the HUD, and floors at zero', () => {
    const h = createHealth(CONFIG);
    expect(respawnRemaining(h, 0, CONFIG)).toBe(0); // alive
    applyDamage(h, 500, 10, CONFIG);
    expect(respawnRemaining(h, 10, CONFIG)).toBe(0); // downed, not dead
    h.diedAt = 10;
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

  it('rejects a downed block that is missing or out of range', () => {
    const { downed: _drop, ...noDowned } = CONFIG;
    expect(() => parseDamageConfig(noDowned)).toThrow(/damage\.downed/);
    expect(() => parseDamageConfig({ ...CONFIG, downed: { ...CONFIG.downed, reviveHealthFraction: 0 } })).toThrow(/reviveHealthFraction/);
    expect(() => parseDamageConfig({ ...CONFIG, downed: { ...CONFIG.downed, bleedOutSeconds: 0 } })).toThrow(/bleedOutSeconds/);
  });

  it('rejects a missing or malformed field', () => {
    expect(() => parseDamageConfig({})).toThrow(/zones/);
    expect(() => parseDamageConfig({ ...DAMAGE, maxHealth: 'lots' })).toThrow(/maxHealth/);
  });
});

describe('not downable (T-3.10)', () => {
  it('kills outright at zero health: no downed phase, no bleed-out, nothing to revive', () => {
    const h = createHealth(CONFIG);
    const first = applyDamage(h, 60, 10, CONFIG, false);
    expect(first).toMatchObject({ applied: 60, downed: false, killed: false, remaining: 40 });
    expect(isAlive(h)).toBe(true);

    const last = applyDamage(h, 90, 11, CONFIG, false);
    expect(last).toMatchObject({ applied: 40, downed: false, killed: true, remaining: 0 });
    expect(vitality(h)).toBe('dead');
    expect(h.downedAt).toBeNull();
    expect(h.diedAt).toBe(11);
    expect(revive(h, CONFIG)).toBe(false);
    expect(expireBleedOut(h, 100, CONFIG)).toBe(false);
  });

  it('never kills twice', () => {
    const h = createHealth(CONFIG);
    applyDamage(h, 200, 1, CONFIG, false);
    expect(applyDamage(h, 50, 2, CONFIG, false)).toMatchObject({ applied: 0, killed: false });
    expect(h.diedAt).toBe(1);
  });

  it('leaves the downable default exactly as it was', () => {
    const h = createHealth(CONFIG);
    expect(applyDamage(h, 200, 1, CONFIG)).toMatchObject({ downed: true, killed: false });
    expect(isDowned(h)).toBe(true);
  });
});
