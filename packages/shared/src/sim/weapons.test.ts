import { describe, expect, it } from 'vitest';
import { ANGLE_UNITS } from '../math/angles.ts';
import { cos } from '../math/trig.ts';
import {
  WEAPONS,
  WEAPON_IDS,
  allowsFire,
  type WeaponDef,
  createWeaponState,
  currentConeUnits,
  damageAtDistance,
  decayBloom,
  degToAngle,
  dirFromYawPitch,
  getWeapon,
  parseWeaponTable,
  pelletDirection,
  pelletSeed,
  shotDirections,
  shotIntervalSeconds,
  startReload,
  tryFire,
} from './weapons.ts';

/**
 * Parity fixture. §2.3 requires parity tests to own their constants so that
 * tuning `data/weapons.json` can never break them. Nothing in this block reads
 * the shipped table.
 */
const FIXTURE: WeaponDef = {
  id: 'fixture',
  name: 'Fixture',
  rpm: 600,
  damage: 20,
  pellets: 8,
  hipSpreadDeg: 3,
  adsSpreadDeg: 1,
  proneSpreadScale: 0.5,
  bloomPerShotDeg: 0.5,
  maxSpreadDeg: 6,
  bloomDecayDegPerSec: 4,
  falloffStartM: 20,
  falloffEndM: 60,
  falloffMinFraction: 0.5,
  maxRangeM: 100,
  magSize: 5,
  reloadSeconds: 2,
  auto: true,
  recoilKickDeg: 1,
  recoilDriftDeg: 0.5,
  recoilMaxDeg: 5,
  recoilRecoveryPerSec: 8,
  recoilAdsScale: 0.5,
  shakePosM: 0.02,
  shakeRollDeg: 0.4,
};

const SEMI: WeaponDef = { ...FIXTURE, id: 'semi', name: 'Semi', auto: false };

const YAW = 700;
const PITCH = 120;

function dot(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

describe('spread determinism', () => {
  it('is a pure function of the seed: same inputs, identical bits', () => {
    const cone = degToAngle(FIXTURE.hipSpreadDeg);
    for (let i = 0; i < 8; i += 1) {
      const seed = pelletSeed(4271, 3, 17, i);
      const a = pelletDirection(YAW, PITCH, cone, seed);
      const b = pelletDirection(YAW, PITCH, cone, seed);
      expect(a).toEqual(b);
    }
  });

  it('seeds from the integer tuple only, so client and server agree with nothing on the wire', () => {
    // Exact equality is correct here: the seed path is integer-only (ADR-014).
    expect(pelletSeed(4271, 3, 17, 0)).toBe(pelletSeed(4271, 3, 17, 0));
    expect(Number.isInteger(pelletSeed(4271, 3, 17, 0))).toBe(true);
  });

  it('decorrelates across tick, entity, shot and pellet', () => {
    const cone = degToAngle(FIXTURE.hipSpreadDeg);
    const seen = new Set<string>();
    for (const tick of [4271, 4272]) {
      for (const entity of [3, 4]) {
        for (let shot = 0; shot < 3; shot += 1) {
          for (let pellet = 0; pellet < FIXTURE.pellets; pellet += 1) {
            const d = pelletDirection(YAW, PITCH, cone, pelletSeed(tick, entity, shot, pellet));
            seen.add(`${d.x},${d.y},${d.z}`);
          }
        }
      }
    }
    // 2 * 2 * 3 * 8 = 96 draws; allow a few angle-quantum collisions.
    expect(seen.size).toBeGreaterThan(90);
  });

  it('stays inside the cone and on the unit sphere', () => {
    const cone = degToAngle(FIXTURE.hipSpreadDeg);
    const aim = dirFromYawPitch(YAW, PITCH);
    // Two whole angle quanta of slack for the integer rounding of the offset.
    const minDot = cos(cone + 2);
    let worstDot = 1;
    let worstLen = 0;
    for (let i = 0; i < 2000; i += 1) {
      const d = pelletDirection(YAW, PITCH, cone, pelletSeed(i, 9, i % 7, i % 8));
      expect(Number.isFinite(d.x) && Number.isFinite(d.y) && Number.isFinite(d.z)).toBe(true);
      const len = Math.sqrt(dot(d, d));
      worstLen = Math.max(worstLen, Math.abs(len - 1));
      worstDot = Math.min(worstDot, dot(d, aim) / len);
    }
    // Bounded, not bit-exact (§2.3): assert under a threshold and log the number.
    console.log(`spread: worst cone dot ${worstDot} (min ${minDot}), worst |len-1| ${worstLen}`);
    expect(worstDot).toBeGreaterThanOrEqual(minDot);
    expect(worstLen).toBeLessThan(1e-3);
  });

  it('fires dead centre when the cone rounds to zero', () => {
    const aim = dirFromYawPitch(YAW, PITCH);
    expect(pelletDirection(YAW, PITCH, 0, pelletSeed(1, 1, 1, 1))).toEqual(aim);
  });
});

describe('damage falloff', () => {
  it('is full inside the start and floors beyond the end', () => {
    expect(damageAtDistance(FIXTURE, 0)).toBe(20);
    expect(damageAtDistance(FIXTURE, 20)).toBe(20);
    expect(damageAtDistance(FIXTURE, 60)).toBeCloseTo(10, 10);
    expect(damageAtDistance(FIXTURE, 99)).toBeCloseTo(10, 10);
  });

  it('ramps linearly and monotonically between them', () => {
    expect(damageAtDistance(FIXTURE, 40)).toBeCloseTo(15, 10);
    let previous = Infinity;
    for (let m = 0; m <= 60; m += 1) {
      const d = damageAtDistance(FIXTURE, m);
      expect(d).toBeLessThanOrEqual(previous);
      previous = d;
    }
  });

  it('cannot hit beyond max range, and rejects nonsense distances', () => {
    expect(damageAtDistance(FIXTURE, 100)).toBeCloseTo(10, 10);
    expect(damageAtDistance(FIXTURE, 100.5)).toBe(0);
    expect(damageAtDistance(FIXTURE, -1)).toBe(0);
    expect(damageAtDistance(FIXTURE, NaN)).toBe(0);
  });
});

describe('firing state machine', () => {
  it('honours the RPM cadence exactly', () => {
    const state = createWeaponState(FIXTURE);
    expect(shotIntervalSeconds(FIXTURE)).toBeCloseTo(0.1, 12);
    expect(tryFire(FIXTURE, state, 0, false)).not.toBeNull();
    expect(tryFire(FIXTURE, state, 0.09, false)).toBeNull();
    expect(tryFire(FIXTURE, state, 0.1, false)).not.toBeNull();
    expect(state.ammo).toBe(3);
  });

  it('empties the magazine and blocks firing until a reload completes', () => {
    const state = createWeaponState(FIXTURE);
    let t = 0;
    for (let i = 0; i < FIXTURE.magSize; i += 1) {
      expect(tryFire(FIXTURE, state, t, false)).not.toBeNull();
      t += 0.1;
    }
    expect(state.ammo).toBe(0);
    expect(tryFire(FIXTURE, state, t, false)).toBeNull();

    expect(startReload(FIXTURE, state, t)).toBe(true);
    expect(tryFire(FIXTURE, state, t + 1.9, false)).toBeNull();
    expect(tryFire(FIXTURE, state, t + 2, false)).not.toBeNull();
    expect(state.ammo).toBe(FIXTURE.magSize - 1);
  });

  it('refuses a redundant reload on a full magazine', () => {
    const state = createWeaponState(FIXTURE);
    expect(startReload(FIXTURE, state, 0)).toBe(false);
  });

  it('increments the shot index so consecutive shots never share a seed', () => {
    const state = createWeaponState(FIXTURE);
    const first = tryFire(FIXTURE, state, 0, false);
    const second = tryFire(FIXTURE, state, 0.1, false);
    expect(first?.shotIndex).toBe(0);
    expect(second?.shotIndex).toBe(1);
  });

  it('produces one direction per pellet', () => {
    const state = createWeaponState(FIXTURE);
    const shot = tryFire(FIXTURE, state, 0, false);
    expect(shot).not.toBeNull();
    expect(shotDirections(FIXTURE, shot!, 3, 4271, YAW, PITCH)).toHaveLength(FIXTURE.pellets);
  });
});

describe('auto vs semi', () => {
  it('lets a held trigger keep firing on an automatic weapon', () => {
    expect(allowsFire(FIXTURE, true, false)).toBe(true);
    expect(allowsFire(FIXTURE, true, true)).toBe(true);
  });

  it('requires a fresh pull on a semi-automatic weapon', () => {
    // The whole point: holding the trigger down must NOT keep firing.
    expect(allowsFire(SEMI, true, false)).toBe(false);
    expect(allowsFire(SEMI, true, true)).toBe(true);
  });

  it('never fires on a released trigger either way', () => {
    expect(allowsFire(FIXTURE, false, false)).toBe(false);
    expect(allowsFire(SEMI, false, false)).toBe(false);
  });

  it('ships exactly one automatic weapon in the players\' loadout, and the MG\'s LMG outside it', () => {
    const autos = Object.values(WEAPONS).filter((w) => w.auto).map((w) => w.id);
    expect(autos.filter((id) => (WEAPON_IDS as readonly string[]).includes(id))).toEqual(['carbine']);
    // T-3.23: a row for an enemy's gun, not in the wire order a player selects from.
    expect(autos).toContain('lmg');
    expect(WEAPON_IDS as readonly string[]).not.toContain('lmg');
  });
});

describe('bloom', () => {
  it('grows per shot, clamps at the maximum, and decays back to the base cone', () => {
    const state = createWeaponState(FIXTURE);
    const base = degToAngle(FIXTURE.hipSpreadDeg);
    expect(currentConeUnits(FIXTURE, state, false)).toBe(base);
    expect(currentConeUnits(FIXTURE, state, true)).toBe(degToAngle(FIXTURE.adsSpreadDeg));

    let t = 0;
    for (let i = 0; i < FIXTURE.magSize; i += 1) {
      tryFire(FIXTURE, state, t, false);
      t += 0.1;
    }
    // 3 deg base + 5 shots x 0.5 deg = 5.5 deg, still under the 6 deg ceiling.
    expect(currentConeUnits(FIXTURE, state, false)).toBe(
      degToAngle(FIXTURE.hipSpreadDeg) + FIXTURE.magSize * degToAngle(FIXTURE.bloomPerShotDeg),
    );

    // Past the ceiling it clamps rather than growing without bound.
    state.bloomUnits += degToAngle(FIXTURE.maxSpreadDeg);
    expect(currentConeUnits(FIXTURE, state, false)).toBe(degToAngle(FIXTURE.maxSpreadDeg));

    for (let i = 0; i < 120; i += 1) decayBloom(FIXTURE, state, 1 / 30);
    expect(state.bloomUnits).toBe(0);
    expect(currentConeUnits(FIXTURE, state, false)).toBe(base);
  });
});

describe('prone cone (T-2.42)', () => {
  it('scales the whole cone by the weapon row, and only while prone', () => {
    const state = createWeaponState(FIXTURE);
    for (const ads of [false, true]) {
      const upright = currentConeUnits(FIXTURE, state, ads);
      expect(currentConeUnits(FIXTURE, state, ads, false)).toBe(upright);
      expect(currentConeUnits(FIXTURE, state, ads, true)).toBe(upright * FIXTURE.proneSpreadScale);
    }
    // Bloom and the ceiling are scaled too: prone is steadier at every point
    // of a burst, not only on the first round.
    state.bloomUnits += degToAngle(FIXTURE.maxSpreadDeg);
    expect(currentConeUnits(FIXTURE, state, false, true)).toBe(degToAngle(FIXTURE.maxSpreadDeg) * FIXTURE.proneSpreadScale);
  });

  it('reads the tuning from the row: a scale of 1 changes nothing, a different one changes it', () => {
    // Two defs that differ ONLY in the data field. If prone were a hardcoded
    // branch, both would answer alike.
    const flat: WeaponDef = { ...FIXTURE, proneSpreadScale: 1 };
    const steady: WeaponDef = { ...FIXTURE, proneSpreadScale: 0.25 };
    const a = createWeaponState(flat);
    const b = createWeaponState(steady);
    expect(currentConeUnits(flat, a, false, true)).toBe(currentConeUnits(flat, a, false, false));
    expect(currentConeUnits(steady, b, false, true)).toBe(currentConeUnits(steady, b, false, false) * 0.25);
  });

  it('fires the shot with the prone cone, and the stance changes nothing else about the shot', () => {
    const upright = createWeaponState(FIXTURE);
    const prone = createWeaponState(FIXTURE);
    const u = tryFire(FIXTURE, upright, 0, false);
    const p = tryFire(FIXTURE, prone, 0, false, true);
    expect(p?.coneUnits).toBe((u?.coneUnits ?? 0) * FIXTURE.proneSpreadScale);
    expect(p?.shotIndex).toBe(u?.shotIndex);
    expect(prone).toEqual(upright); // Same ammo, cadence and bloom afterwards.
  });

  it('ships every weapon at least as steady prone as upright', () => {
    for (const def of Object.values(WEAPONS)) {
      expect(def.proneSpreadScale).toBeGreaterThan(0);
      expect(def.proneSpreadScale).toBeLessThanOrEqual(1);
    }
  });
});

describe('weapon data', () => {
  it('scopes the marksman only, and refuses a scope wider than the view', () => {
    expect(Object.values(WEAPONS).filter((w) => w.scopeFovDeg !== undefined).map((w) => w.id)).toEqual(['marksman']);
    const row = { ...WEAPONS['carbine'], scopeFovDeg: 90 };
    expect(() => parseWeaponTable({ carbine: row })).toThrow(/scopeFovDeg/);
    expect(parseWeaponTable({ carbine: { ...row, scopeFovDeg: 20 } })['carbine']!.scopeFovDeg).toBe(20);
    expect(parseWeaponTable({ carbine: WEAPONS['carbine'] })['carbine']!.scopeFovDeg).toBeUndefined();
  });

  it('ships a table that validates', () => {
    expect(Object.keys(WEAPONS).length).toBeGreaterThanOrEqual(3);
    for (const [key, def] of Object.entries(WEAPONS)) {
      expect(def.id).toBe(key);
      expect(degToAngle(def.maxSpreadDeg)).toBeLessThan(ANGLE_UNITS / 4);
      expect(def.falloffEndM).toBeGreaterThanOrEqual(def.falloffStartM);
      expect(def.maxRangeM).toBeGreaterThan(0);
    }
    expect(getWeapon('carbine').pellets).toBe(1);
    expect(() => getWeapon('nope')).toThrow(/unknown weapon/);
  });

  it('rejects bad rows, naming the weapon and the field', () => {
    const good = { a: { ...FIXTURE, id: 'a' } };
    expect(() => parseWeaponTable(good)).not.toThrow();
    expect(() => parseWeaponTable({ a: { ...FIXTURE, id: 'a', rpm: 0 } })).toThrow(/"a": rpm/);
    expect(() => parseWeaponTable({ a: { ...FIXTURE, id: 'b' } })).toThrow(/id field says/);
    expect(() => parseWeaponTable({ a: { ...FIXTURE, id: 'a', pellets: 1.5 } })).toThrow(/pellets must be an integer/);
    expect(() => parseWeaponTable({ a: { ...FIXTURE, id: 'a', falloffEndM: 1 } })).toThrow(/falloffEndM/);
    expect(() => parseWeaponTable({ a: { ...FIXTURE, id: 'a', adsSpreadDeg: 99 } })).toThrow(/adsSpreadDeg/);
    // T-2.42: a prone scale above 1 would make lying down LESS accurate.
    expect(() => parseWeaponTable({ a: { ...FIXTURE, id: 'a', proneSpreadScale: 1.5 } })).toThrow(/proneSpreadScale/);
    // T-2.08: recoil fields are validated like the rest, and a cap below one
    // kick is refused rather than clamping every shot.
    expect(() => parseWeaponTable({ a: { ...FIXTURE, id: 'a', recoilRecoveryPerSec: 0 } })).toThrow(/recoilRecoveryPerSec/);
    expect(() => parseWeaponTable({ a: { ...FIXTURE, id: 'a', recoilAdsScale: 2 } })).toThrow(/recoilAdsScale/);
    expect(() => parseWeaponTable({ a: { ...FIXTURE, id: 'a', recoilMaxDeg: 0.5 } })).toThrow(/recoilMaxDeg/);
    const { recoilKickDeg: _k, ...missing } = { ...FIXTURE, id: 'a' };
    void _k;
    expect(() => parseWeaponTable({ a: missing })).toThrow(/recoilKickDeg/);
    // T-2.09: shake is validated the same way.
    expect(() => parseWeaponTable({ a: { ...FIXTURE, id: 'a', shakePosM: -1 } })).toThrow(/shakePosM/);
    expect(() => parseWeaponTable({ a: { ...FIXTURE, id: 'a', shakeRollDeg: 45 } })).toThrow(/shakeRollDeg/);
    expect(() => parseWeaponTable({ a: { ...FIXTURE, id: 'a', auto: 'yes' } })).toThrow(/auto must be a boolean/);
    expect(() => parseWeaponTable({})).toThrow(/empty/);
    expect(() => parseWeaponTable([])).toThrow(/keyed by weapon id/);
  });
});

describe('reload progress (T-2.26)', () => {
  it('is a curve of the weapon\'s own clock: 0 outside a reload, 0..1 through it', async () => {
    const { createWeaponState, getWeapon, reloadProgress, startReload, finishReload } = await import('./weapons.ts');
    const def = getWeapon('carbine');
    const state = createWeaponState(def);
    expect(reloadProgress(def, state, 5)).toBe(0);
    state.ammo = 0;
    expect(startReload(def, state, 10)).toBe(true);
    expect(reloadProgress(def, state, 10)).toBe(0);
    expect(reloadProgress(def, state, 10 + def.reloadSeconds / 2)).toBeCloseTo(0.5, 9);
    expect(reloadProgress(def, state, 10 + def.reloadSeconds * 0.9)).toBeCloseTo(0.9, 9);
    // Past the end it reads 0 whether or not the reload has been settled.
    expect(reloadProgress(def, state, 10 + def.reloadSeconds)).toBe(0);
    finishReload(def, state, 10 + def.reloadSeconds);
    expect(reloadProgress(def, state, 10 + def.reloadSeconds + 1)).toBe(0);
    expect(state.ammo).toBe(def.magSize);
  });
});
