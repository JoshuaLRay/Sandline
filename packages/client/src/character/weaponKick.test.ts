/**
 * T-2.26: the fire layer's kick. Constants are declared here, not read from
 * data/weapons.json, so tuning a weapon can never change what this proves.
 */
import { describe, expect, it } from 'vitest';
import type { WeaponDef } from '@sandline/shared';
import {
  KICK_BACK_M_PER_DEG,
  KICK_DECAY_RATE,
  KICK_UP_RAD_PER_DEG,
  addKick,
  createKick,
  decayKick,
  kickSettleSeconds,
} from './weaponKick.ts';

const RIFLE: WeaponDef = {
  id: 'fixture-rifle',
  name: 'Fixture',
  rpm: 600,
  damage: 20,
  pellets: 1,
  hipSpreadDeg: 2,
  adsSpreadDeg: 0.5,
  bloomPerShotDeg: 0.4,
  maxSpreadDeg: 5,
  bloomDecayDegPerSec: 4,
  falloffStartM: 20,
  falloffEndM: 60,
  falloffMinFraction: 0.5,
  maxRangeM: 100,
  magSize: 30,
  reloadSeconds: 2,
  auto: true,
  recoilKickDeg: 1,
  recoilDriftDeg: 0.25,
  recoilMaxDeg: 4,
  recoilRecoveryPerSec: 8,
  recoilAdsScale: 0.5,
  spreadProneScale: 0.7,
  recoilProneScale: 0.6,
  shakePosM: 0.02,
  shakeRollDeg: 0.4,
};

function ring(state: ReturnType<typeof createKick>, seconds: number, dt: number) {
  let s = state;
  for (let t = 0; t + dt <= seconds + 1e-9; t += dt) s = decayKick(s, dt);
  return s;
}

describe('the fire layer\'s kick (T-2.26)', () => {
  it('a shot kicks by the weapon\'s data; aiming scales it', () => {
    const hip = addKick(createKick(), RIFLE, false);
    expect(hip.back).toBeCloseTo(KICK_BACK_M_PER_DEG, 12);
    expect(hip.up).toBeCloseTo(KICK_UP_RAD_PER_DEG, 12);
    const ads = addKick(createKick(), RIFLE, true);
    expect(ads.back).toBeCloseTo(KICK_BACK_M_PER_DEG * 0.5, 12);
    expect(ads.up).toBeCloseTo(KICK_UP_RAD_PER_DEG * 0.5, 12);
  });

  it('recovers to under 1% within the bound derived from the rate, at 30 and 120 fps', () => {
    const settle = kickSettleSeconds();
    for (const fps of [30, 120]) {
      const start = addKick(createKick(), RIFLE, false);
      const done = ring(start, settle + 1 / fps, 1 / fps);
      expect(done.back).toBeLessThan(start.back * 0.01);
      expect(done.up).toBeLessThan(start.up * 0.01);
      const half = ring(start, settle / 2, 1 / fps);
      expect(half.up).toBeGreaterThan(start.up * 0.05);
    }
  });

  it('traces the same envelope at 30 and 120 fps', () => {
    const start = addKick(createKick(), RIFLE, false);
    const at30 = ring(start, 0.2, 1 / 30);
    const at120 = ring(start, 0.2, 1 / 120);
    expect(Math.abs(at30.up - at120.up)).toBeLessThan(1e-6);
    expect(Math.abs(at30.back - at120.back)).toBeLessThan(1e-6);
  });

  it('builds under a held trigger and is bounded by the geometric series', () => {
    let s = createKick();
    let peak = 0;
    for (let i = 0; i < 50; i += 1) {
      s = addKick(s, RIFLE, false);
      peak = Math.max(peak, s.up);
      s = ring(s, 0.1, 1 / 60);
    }
    const bound = KICK_UP_RAD_PER_DEG / (1 - Math.exp(-KICK_DECAY_RATE * 0.1));
    expect(peak).toBeLessThanOrEqual(bound + 1e-9);
    expect(peak).toBeGreaterThan(KICK_UP_RAD_PER_DEG);
  });

  it('comes to an exact rest', () => {
    const s = ring(addKick(createKick(), RIFLE, false), 3, 1 / 60);
    expect(s).toEqual({ back: 0, up: 0 });
    expect(decayKick(s, 0)).toBe(s);
  });
});
