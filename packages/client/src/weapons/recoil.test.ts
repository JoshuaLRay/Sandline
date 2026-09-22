/**
 * T-2.08. Constants are declared here, not read from data/weapons.json, so
 * tuning a weapon can never change what this proves.
 */
import { describe, expect, it } from 'vitest';
import type { WeaponDef } from '@sandline/shared';
import {
  WIRE_UNITS_PER_DEGREE,
  applyKick,
  composePitch,
  createRecoil,
  kickFor,
  recoilSettleSeconds,
  recoverRecoil,
} from './recoil.ts';

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
  recoilKickDeg: 0.5,
  recoilDriftDeg: 0.25,
  recoilMaxDeg: 4,
  recoilRecoveryPerSec: 8,
  recoilAdsScale: 0.5,
  spreadProneScale: 0.7,
  recoilProneScale: 0.6,
  shakePosM: 0.02,
  shakeRollDeg: 0.4,
};

const U = WIRE_UNITS_PER_DEGREE;

describe('recoil kicks (T-2.08)', () => {
  it('kicks up by the weapon\'s kick and sideways by its drift, in wire units', () => {
    for (let shot = 1; shot <= 20; shot += 1) {
      const k = kickFor(RIFLE, shot, false);
      expect(k.pitch).toBeCloseTo(0.5 * U, 12);
      expect(Math.abs(k.yaw)).toBeCloseTo(0.25 * U, 12);
    }
  });

  it('walks a repeatable pattern: the same burst gives the same signs, and it is not all one way', () => {
    const signs = Array.from({ length: 30 }, (_, i) => Math.sign(kickFor(RIFLE, i + 1, false).yaw));
    const again = Array.from({ length: 30 }, (_, i) => Math.sign(kickFor(RIFLE, i + 1, false).yaw));
    expect(again).toEqual(signs);
    expect(signs.some((s) => s < 0)).toBe(true);
    expect(signs.some((s) => s > 0)).toBe(true);
  });

  it('gives each weapon its own pattern', () => {
    const other = { ...RIFLE, id: 'fixture-other' };
    const a = Array.from({ length: 40 }, (_, i) => Math.sign(kickFor(RIFLE, i + 1, false).yaw));
    const b = Array.from({ length: 40 }, (_, i) => Math.sign(kickFor(other, i + 1, false).yaw));
    expect(a).not.toEqual(b);
  });

  it('scales the kick down while aiming', () => {
    const hip = kickFor(RIFLE, 3, false);
    const ads = kickFor(RIFLE, 3, true);
    expect(ads.pitch).toBeCloseTo(hip.pitch * 0.5, 12);
    expect(ads.yaw).toBeCloseTo(hip.yaw * 0.5, 12);
  });

  it('scales the kick down while prone (T-2.42), composing with ADS rather than replacing it', () => {
    const hip = kickFor(RIFLE, 3, false);
    const prone = kickFor(RIFLE, 3, false, true);
    expect(prone.pitch).toBeCloseTo(hip.pitch * RIFLE.recoilProneScale, 12);
    expect(prone.yaw).toBeCloseTo(hip.yaw * RIFLE.recoilProneScale, 12);

    const adsProne = kickFor(RIFLE, 3, true, true);
    expect(adsProne.pitch).toBeCloseTo(hip.pitch * RIFLE.recoilAdsScale * RIFLE.recoilProneScale, 12);
    // Standing (the default) is untouched: prone is opt-in, not a silent rescale.
    expect(kickFor(RIFLE, 3, false).pitch).toBeCloseTo(hip.pitch, 12);
  });

  it('threads prone through applyKick, not only kickFor', () => {
    const s = applyKick(createRecoil(), RIFLE, 1, false, true);
    const expected = kickFor(RIFLE, 1, false, true);
    expect(s.pitch).toBeCloseTo(expected.pitch, 12);
  });

  it('accumulates a burst exactly, then caps at recoilMaxDeg', () => {
    let s = createRecoil();
    for (let shot = 1; shot <= 6; shot += 1) s = applyKick(s, RIFLE, shot, false);
    // Six shots at 0.5 degrees is 3 degrees, under the 4-degree cap.
    expect(s.pitch).toBeCloseTo(3 * U, 9);
    for (let shot = 7; shot <= 30; shot += 1) s = applyKick(s, RIFLE, shot, false);
    expect(s.pitch).toBeCloseTo(4 * U, 9);
    expect(Math.abs(s.yaw)).toBeLessThanOrEqual(4 * U + 1e-9);
  });
});

describe('recoil recovery (T-2.08)', () => {
  it('returns the offset to under 1% within the bound derived from the rate, and not much sooner', () => {
    const start = applyKick(createRecoil(), RIFLE, 1, false);
    const settle = recoilSettleSeconds(RIFLE);
    const dt = 1 / 60;
    let s = start;
    let t = 0;
    while (t + dt <= settle / 2) {
      s = recoverRecoil(s, RIFLE, dt);
      t += dt;
    }
    // Halfway there, well over 1% remains: the curve is exponential, not a snap.
    expect(s.pitch).toBeGreaterThan(start.pitch * 0.05);
    while (t + dt <= settle) {
      s = recoverRecoil(s, RIFLE, dt);
      t += dt;
    }
    s = recoverRecoil(s, RIFLE, dt);
    expect(s.pitch).toBeLessThan(start.pitch * 0.01);
    expect(Math.abs(s.yaw)).toBeLessThan(Math.abs(start.yaw) * 0.01);
  });

  it('follows the same curve at 30 and 120 fps', () => {
    const start = applyKick(applyKick(createRecoil(), RIFLE, 1, false), RIFLE, 2, false);
    let at30 = start;
    let at120 = start;
    for (let i = 0; i < 30; i += 1) at30 = recoverRecoil(at30, RIFLE, 1 / 30);
    for (let i = 0; i < 120; i += 1) at120 = recoverRecoil(at120, RIFLE, 1 / 120);
    expect(Math.abs(at30.pitch - at120.pitch)).toBeLessThan(1e-6);
    expect(Math.abs(at30.yaw - at120.yaw)).toBeLessThan(1e-6);
  });

  it('reaches exactly zero rather than an infinite tail', () => {
    let s = applyKick(createRecoil(), RIFLE, 1, false);
    for (let i = 0; i < 600; i += 1) s = recoverRecoil(s, RIFLE, 1 / 60);
    expect(s).toEqual({ pitch: 0, yaw: 0 });
  });

  it('is a no-op for a zero or negative frame time', () => {
    const s = applyKick(createRecoil(), RIFLE, 1, false);
    expect(recoverRecoil(s, RIFLE, 0)).toBe(s);
    expect(recoverRecoil(s, RIFLE, -1)).toBe(s);
  });
});

describe('recoil on top of the mouse (T-2.08)', () => {
  it('keeps the player\'s own movement: recovering the offset never moves the mouse value', () => {
    // The mouse pulls down 3 degrees during a burst; the recoil climbs 2.
    const mouse = -3 * U;
    let recoil = applyKick(applyKick(applyKick(createRecoil(), RIFLE, 1, false), RIFLE, 2, false), RIFLE, 3, false);
    const during = composePitch(mouse, recoil.pitch, -80 * U, 89 * U);
    expect(during).toBeCloseTo(mouse + 1.5 * U, 9);
    for (let i = 0; i < 600; i += 1) recoil = recoverRecoil(recoil, RIFLE, 1 / 60);
    // Once recovered the view is exactly where the player put it.
    expect(composePitch(mouse, recoil.pitch, -80 * U, 89 * U)).toBe(mouse);
  });

  it('limits only the sum, so recoil at the top of the range cannot push past it', () => {
    const max = 89 * U;
    expect(composePitch(max, 3 * U, -80 * U, max)).toBe(max);
    expect(composePitch(-80 * U, 0, -80 * U, max)).toBe(-80 * U);
    expect(composePitch(10 * U, 2 * U, -80 * U, max)).toBeCloseTo(12 * U, 12);
  });
});
