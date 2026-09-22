/**
 * T-2.09. Constants are declared here, not read from data/weapons.json, so
 * tuning a weapon can never change what this proves.
 */
import { describe, expect, it } from 'vitest';
import type { ProjectileDef, WeaponDef, WorldBox } from '@sandline/shared';
import { boxFrom } from '@sandline/shared';
import { DEFAULT_CAMERA_CONFIG } from './cameraConfig.ts';
import { createCameraSolve, solveCamera } from './cameraSolve.ts';
import {
  BLAST_SHAKE_POS_M,
  SHAKE_DECAY_RATE,
  addImpulse,
  addShake,
  blastShake,
  applyShake,
  createShake,
  decayShake,
  shakeOffset,
  shakeSettleSeconds,
} from './cameraShake.ts';

const RIFLE: WeaponDef = {
  id: 'fixture-rifle',
  name: 'Fixture',
  rpm: 600,
  damage: 20,
  pellets: 1,
  hipSpreadDeg: 2,
  adsSpreadDeg: 0.5,
  proneSpreadScale: 1,
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
  shakePosM: 0.02,
  shakeRollDeg: 0.4,
};

function ring(state: ReturnType<typeof createShake>, seconds: number, dt: number) {
  let s = state;
  for (let t = 0; t + dt <= seconds + 1e-9; t += dt) s = decayShake(s, dt);
  return s;
}

describe('camera shake impulses (T-2.09)', () => {
  it('a shot adds the weapon\'s impulse; aiming scales it', () => {
    const hip = addShake(createShake(), RIFLE, false);
    expect(hip.posAmp).toBeCloseTo(0.02, 12);
    expect(hip.rollAmp).toBeCloseTo((0.4 * Math.PI) / 180, 12);
    const ads = addShake(createShake(), RIFLE, true);
    expect(ads.posAmp).toBeCloseTo(0.01, 12);
  });

  it('two overlapping impulses sum rather than reset', () => {
    const one = addShake(createShake(), RIFLE, false);
    const rung = ring(one, 0.05, 1 / 60);
    const two = addShake(rung, RIFLE, false);
    expect(two.posAmp).toBeCloseTo(rung.posAmp + 0.02, 12);
    expect(two.posAmp).toBeGreaterThan(one.posAmp);
    // And the phase carries on rather than restarting.
    expect(two.time).toBe(rung.time);
  });

  it('converges under a held trigger instead of growing without bound', () => {
    let s = createShake();
    let peak = 0;
    // 600 rpm for five seconds: an impulse every 0.1 s.
    for (let i = 0; i < 50; i += 1) {
      s = addShake(s, RIFLE, false);
      // The peak is the moment the impulse lands, before the envelope decays.
      peak = Math.max(peak, s.posAmp);
      s = ring(s, 0.1, 1 / 60);
    }
    // Geometric series: 0.02 x (1 + k + k^2 + ...) with k = exp(-rate x 0.1).
    const bound = 0.02 / (1 - Math.exp(-SHAKE_DECAY_RATE * 0.1));
    expect(peak).toBeLessThanOrEqual(bound + 1e-9);
    // And it did build: a burst is heavier than a single shot.
    expect(peak).toBeGreaterThan(0.02);
  });
});

describe('camera shake decay (T-2.09)', () => {
  it('falls to under 1% within the bound derived from the rate, at 30 and at 120 fps', () => {
    const settle = shakeSettleSeconds();
    for (const fps of [30, 120]) {
      const start = addShake(createShake(), RIFLE, false);
      const done = ring(start, settle + 1 / fps, 1 / fps);
      expect(done.posAmp).toBeLessThan(start.posAmp * 0.01);
      expect(done.rollAmp).toBeLessThan(start.rollAmp * 0.01);
      // And not long before: halfway there, well over 1% remains.
      const half = ring(start, settle / 2, 1 / fps);
      expect(half.posAmp).toBeGreaterThan(start.posAmp * 0.05);
    }
  });

  it('traces the same envelope at 30 and 120 fps', () => {
    const start = addShake(createShake(), RIFLE, false);
    const at30 = ring(start, 0.2, 1 / 30);
    const at120 = ring(start, 0.2, 1 / 120);
    expect(Math.abs(at30.posAmp - at120.posAmp)).toBeLessThan(1e-6);
    expect(Math.abs(at30.time - at120.time)).toBeLessThan(1e-9);
  });

  it('comes to an exact rest', () => {
    const s = ring(addShake(createShake(), RIFLE, false), 3, 1 / 60);
    expect(s).toEqual({ posAmp: 0, rollAmp: 0, time: 0 });
    expect(shakeOffset(s, 1)).toEqual({ right: 0, up: 0, roll: 0 });
  });
});

describe('camera shake and the aim (T-2.09)', () => {
  const view = {
    x: 1,
    y: 0,
    z: 2,
    yawWire: 300,
    pitchWire: 40,
    pitchFraction: 0.1,
    ads: false,
    firstPerson: false,
    shoulderSide: 1 as const,
  };

  it('never changes direction, position, focus or distance — only the shake fields', () => {
    const quiet = solveCamera(view, DEFAULT_CAMERA_CONFIG, createCameraSolve(), 1 / 60);
    const shaken = solveCamera(view, DEFAULT_CAMERA_CONFIG, createCameraSolve(), 1 / 60);
    const s = ring(addShake(createShake(), RIFLE, false), 0.02, 1 / 60);
    applyShake(shaken, s, 1);

    expect(shaken.direction).toEqual(quiet.direction);
    expect(shaken.position).toEqual(quiet.position);
    expect(shaken.focus).toEqual(quiet.focus);
    expect(shaken.distance).toBe(quiet.distance);
    expect(Math.hypot(shaken.shake.x, shaken.shake.y, shaken.shake.z)).toBeGreaterThan(0);
    expect(Math.hypot(shaken.shake.x, shaken.shake.y, shaken.shake.z)).toBeLessThan(0.03);
  });

  it('is silenced entirely by a reduce setting of zero', () => {
    const out = solveCamera(view, DEFAULT_CAMERA_CONFIG, createCameraSolve(), 1 / 60);
    applyShake(out, addShake(createShake(), RIFLE, false), 0);
    expect(out.shake).toEqual({ x: 0, y: 0, z: 0, roll: 0 });
  });

  it('moves the camera across the view, not along it', () => {
    const out = solveCamera(view, DEFAULT_CAMERA_CONFIG, createCameraSolve(), 1 / 60);
    const s = ring(addShake(createShake(), RIFLE, false), 0.01, 1 / 60);
    applyShake(out, s, 1);
    const along = out.shake.x * out.direction.x + out.shake.y * out.direction.y + out.shake.z * out.direction.z;
    const total = Math.hypot(out.shake.x, out.shake.y, out.shake.z);
    // The offset is (nearly) perpendicular to the view: within the pitch's
    // share of the up component, which at 14 degrees is small.
    expect(Math.abs(along)).toBeLessThan(total * 0.3);
  });
});

/** T-2.33. Its own grenade, so tuning `projectiles.json` proves nothing here. */
const GRENADE: ProjectileDef = {
  id: 'fixture-grenade',
  name: 'Fixture Grenade',
  kind: 'thrown',
  speedMPerSec: 16,
  loftDeg: 0,
  gravity: 10,
  dragPerSec: 0,
  radiusM: 0.1,
  restitution: 0.3,
  friction: 0.5,
  rollDragPerSec: 3,
  fuseSeconds: 2,
  detonateOnImpact: false,
  maxLifeSeconds: 6,
  blastRadiusM: 6,
  blastDamage: 100,
  blastMinFraction: 0.1,
  blastCoverFraction: 0.25,
  carried: 3,
  cooldownSeconds: 1,
};

const HEIGHT_M = 1.8;
const NO_COVER: readonly WorldBox[] = [];

describe('a blast on the picture (T-2.33)', () => {
  const at = (distance: number, world: readonly WorldBox[] = NO_COVER) =>
    blastShake(GRENADE, { x: 0, y: 0.2, z: 0 }, { x: distance, y: 0, z: 0 }, HEIGHT_M, world);

  it('is hardest underfoot and falls off with distance', () => {
    const close = at(0.1);
    // Not quite the maximum: the distance is measured to the middle of the
    // body, so a blast at your feet is still most of a metre from it.
    expect(close.posM).toBeGreaterThan(BLAST_SHAKE_POS_M * 0.95);
    expect(close.posM).toBeLessThanOrEqual(BLAST_SHAKE_POS_M);
    let previous = close.posM;
    for (let d = 1; d < GRENADE.blastRadiusM; d += 1) {
      const here = at(d).posM;
      expect(here).toBeLessThan(previous);
      previous = here;
    }
  });

  it('is nothing at all past the radius', () => {
    expect(at(GRENADE.blastRadiusM + 0.5).posM).toBe(0);
    expect(at(GRENADE.blastRadiusM + 0.5).rollRad).toBe(0);
  });

  it('is cut by the same cover that cuts the damage', () => {
    const wall = boxFrom({ id: 'wall', x: 1.5, y: 0, z: 0, w: 0.4, h: 4, d: 8 }, 'cover');
    const open = at(3).posM;
    const behind = at(3, [wall]).posM;
    expect(behind).toBeGreaterThan(0);
    expect(behind).toBeCloseTo(open * GRENADE.blastCoverFraction, 6);
  });

  it('rings a camera that is already ringing rather than restarting it', () => {
    const one = addImpulse(createShake(), 0.05, 0.01);
    const two = addImpulse(one, 0.05, 0.01);
    expect(two.posAmp).toBeCloseTo(0.1, 6);
    expect(two.rollAmp).toBeCloseTo(0.02, 6);
  });
});
