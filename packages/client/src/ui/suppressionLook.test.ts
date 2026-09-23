/**
 * Suppression on screen (T-3.17). Node-only: the look, the jolt and the
 * crosshair gap are pure; `SuppressionOverlay` only writes them to styles.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  ANGLE_UNITS,
  SUPPRESSION,
  createWeaponState,
  currentConeUnits,
  getWeapon,
  suppressionConeUnits,
  suppressionFromWire,
  suppressionToWire,
} from '@sandline/shared';
import {
  SUPPRESSION_DESATURATION_MAX,
  SUPPRESSION_VIGNETTE_MAX,
  desaturationFilter,
  isQuiet,
  suppressionLook,
} from './suppressionLook.ts';
import { crosshairGapPx } from './crosshair.ts';
import { NEAR_MISS_SHAKE_POS_M, addImpulse, createShake, decayShake, shakeOffset, suppressionJolt } from '../camera/cameraShake.ts';
import { CombatQA } from '../weapons/CombatQA.ts';

/** A level timeline like the server's: a near miss at 0.2 s, another at 0.5 s, then the hold and the line. */
function levelAt(t: number): number {
  const raises = [
    { at: 0.2, amount: SUPPRESSION.nearMiss },
    { at: 0.5, amount: SUPPRESSION.nearMiss },
  ];
  let level = 0;
  let since = 0;
  for (const r of raises) {
    if (t < r.at) break;
    const falling = r.at - since - SUPPRESSION.holdSeconds;
    level = Math.max(0, level - Math.max(0, falling) * SUPPRESSION.decayPerSec) + r.amount;
    since = r.at;
  }
  const falling = t - since - SUPPRESSION.holdSeconds;
  const now = level - Math.max(0, falling) * SUPPRESSION.decayPerSec;
  // As the page is told it: 30 Hz snapshots, 6-bit levels.
  return suppressionFromWire(suppressionToWire(Math.max(0, now)));
}

/** What the page draws at each sample time, running the frame loop at `fps`. */
function film(fps: number, samples: readonly number[]) {
  const dt = 1 / fps;
  let shake = createShake();
  let last = 0;
  const out: { vignette: number; saturation: number; right: number; up: number; roll: number }[] = [];
  let next = 0;
  for (let frame = 1; next < samples.length; frame++) {
    const t = frame * dt;
    // The level the page holds is the newest snapshot's: 30 Hz, whatever the frame rate.
    const level = levelAt(Math.floor(t * 30) / 30);
    shake = decayShake(shake, dt);
    const jolt = suppressionJolt(last, level);
    if (jolt.posM > 0) shake = addImpulse(shake, jolt.posM, jolt.rollRad);
    last = level;
    while (next < samples.length && Math.abs(t - samples[next]!) < 1e-9) {
      const look = suppressionLook(level);
      out.push({ vignette: look.vignette, saturation: look.saturation, ...shakeOffset(shake, 1) });
      next++;
    }
  }
  return out;
}

describe('suppression on screen (T-3.17)', () => {
  it('draws nothing at zero suppression', () => {
    const look = suppressionLook(0);
    expect(look.vignette).toBe(0);
    expect(look.saturation).toBe(1);
    expect(isQuiet(look)).toBe(true);
    expect(desaturationFilter(look)).toBe('none');
    expect(suppressionJolt(0, 0)).toEqual({ posM: 0, rollRad: 0 });
    expect(isQuiet(suppressionLook(-1))).toBe(true);
  });

  it('is monotonic in the level, and full at full', () => {
    let prev = suppressionLook(0);
    for (let i = 1; i <= 100; i++) {
      const look = suppressionLook(i / 100);
      expect(look.vignette).toBeGreaterThan(prev.vignette);
      expect(look.saturation).toBeLessThan(prev.saturation);
      expect(look.clearPercent).toBeLessThan(prev.clearPercent);
      prev = look;
    }
    expect(prev.vignette).toBeCloseTo(SUPPRESSION_VIGNETTE_MAX, 12);
    expect(prev.saturation).toBeCloseTo(1 - SUPPRESSION_DESATURATION_MAX, 12);
    expect(suppressionLook(5)).toEqual(prev);
    // One near miss already reads.
    expect(suppressionLook(SUPPRESSION.nearMiss).vignette).toBeGreaterThan(SUPPRESSION_VIGNETTE_MAX / 3);
  });

  it('jolts once per near miss, harder for more, and never on the decay', () => {
    const one = suppressionJolt(0, SUPPRESSION.nearMiss);
    expect(one.posM).toBeCloseTo(NEAR_MISS_SHAKE_POS_M, 12);
    expect(suppressionJolt(0.1, 0.1 + 2 * SUPPRESSION.nearMiss).posM).toBeCloseTo(2 * NEAR_MISS_SHAKE_POS_M, 12);
    expect(suppressionJolt(0.1, 0.1 + SUPPRESSION.impact).posM).toBeLessThan(one.posM);
    expect(suppressionJolt(0.5, 0.4)).toEqual({ posM: 0, rollRad: 0 });
    expect(suppressionJolt(0, 10).posM).toBeCloseTo(3 * NEAR_MISS_SHAKE_POS_M, 12);
  });

  it('renders the same picture at 30 and 120 fps at the same moments', () => {
    const samples = Array.from({ length: 60 }, (_, i) => (i + 1) / 30);
    const slow = film(30, samples);
    const fast = film(120, samples);
    expect(slow).toHaveLength(samples.length);
    let worst = 0;
    for (let i = 0; i < samples.length; i++) {
      expect(fast[i]!.vignette).toBe(slow[i]!.vignette);
      expect(fast[i]!.saturation).toBe(slow[i]!.saturation);
      worst = Math.max(worst, Math.abs(fast[i]!.right - slow[i]!.right), Math.abs(fast[i]!.up - slow[i]!.up), Math.abs(fast[i]!.roll - slow[i]!.roll));
    }
    console.log(`suppression look 30 vs 120 fps: peak shake divergence ${worst.toExponential(2)}`);
    expect(worst).toBeLessThan(1e-9);
    // And something was actually drawn: the near misses are in the film.
    expect(slow.some((f) => f.vignette > 0 && f.right !== 0)).toBe(true);
  });

  it("the crosshair's cone is the replicated spread", () => {
    const combat = new CombatQA(new THREE.Scene());
    const carbine = getWeapon('carbine');
    const fov = 70;
    const height = 1080;
    for (const wire of [0, 13, 32, 63]) {
      const level = suppressionFromWire(wire);
      // What the server fires with at the level it replicated, on screen.
      const serverDeg = (currentConeUnits(carbine, createWeaponState(carbine), true, false, suppressionConeUnits(level)) / ANGLE_UNITS) * 360;
      expect(crosshairGapPx(combat.coneDegrees(true, false, level), fov, height)).toBeCloseTo(crosshairGapPx(serverDeg, fov, height), 9);
    }
    // Wider under fire, by the data's amount of cone.
    const plain = crosshairGapPx(combat.coneDegrees(true), fov, height);
    const full = crosshairGapPx(combat.coneDegrees(true, false, 1), fov, height);
    expect(full).toBeGreaterThan(plain);
    const widenedDeg = (suppressionConeUnits(1) / ANGLE_UNITS) * 360;
    expect(widenedDeg).toBeCloseTo(SUPPRESSION.coneDeg, 1);
  });
});
