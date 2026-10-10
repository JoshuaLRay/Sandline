/**
 * U-158: an RPG gunner's launcher, carried low and brought up for the wind-up, with a glint of its own.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LAUNCHER_RAISE_SECONDS, LauncherFx, WIND_UP_CUE_SCREEN, applyWindUpCue, createWindUpCue } from './launcherLook.ts';

const FRAME = 1 / 60;

function run(fx: LauncherFx, input: { launcher: boolean; aiming: boolean; vitality?: 'alive' | 'downed' | 'dead' }, seconds: number) {
  let frame = fx.update({ vitality: 'alive', ...input }, 0);
  for (let t = 0; t < seconds - 1e-9; t += FRAME) frame = fx.update({ vitality: 'alive', ...input }, FRAME);
  return frame;
}

describe('the launcher in hand (U-158)', () => {
  it('is carried low, with no glint, until the wind-up', () => {
    const fx = new LauncherFx();
    const frame = run(fx, { launcher: true, aiming: false }, 2);
    expect(frame.lower).toBe(1);
    expect(frame.tell).toBe(0);
  });

  it('comes up onto the shoulder over the raise and glints while the wind-up lasts', () => {
    const fx = new LauncherFx();
    run(fx, { launcher: true, aiming: false }, 0.5);
    const partway = run(fx, { launcher: true, aiming: true }, LAUNCHER_RAISE_SECONDS / 2);
    expect(partway.lower).toBeGreaterThan(0.2);
    expect(partway.lower).toBeLessThan(0.8);
    const up = run(fx, { launcher: true, aiming: true }, LAUNCHER_RAISE_SECONDS);
    expect(up.lower).toBe(0);
    // A pulse, never off, while it winds up.
    const tells = Array.from({ length: 60 }, () => fx.update({ launcher: true, aiming: true, vitality: 'alive' }, FRAME).tell);
    expect(Math.min(...tells)).toBeGreaterThanOrEqual(0.6);
    expect(Math.max(...tells) - Math.min(...tells)).toBeGreaterThan(0.2);
  });

  it('goes back down after the wind-up ends, and the glint goes out at once', () => {
    const fx = new LauncherFx();
    run(fx, { launcher: true, aiming: true }, 1);
    const just = fx.update({ launcher: true, aiming: false, vitality: 'alive' }, FRAME);
    expect(just.tell).toBe(0);
    expect(just.lower).toBeLessThan(0.1);
    expect(run(fx, { launcher: true, aiming: false }, LAUNCHER_RAISE_SECONDS + 0.05).lower).toBe(1);
  });

  it('is nothing with the rifle out or on a body on the ground, and the next launcher starts low', () => {
    const fx = new LauncherFx();
    run(fx, { launcher: true, aiming: true }, 1);
    expect(run(fx, { launcher: false, aiming: false }, 0.2)).toEqual({ lower: 0, tell: 0 });
    expect(fx.update({ launcher: true, aiming: false, vitality: 'alive' }, FRAME).lower).toBe(1);
    run(fx, { launcher: true, aiming: true }, 1);
    // Killed in the wind-up: no glint, no carry.
    expect(fx.update({ launcher: true, aiming: true, vitality: 'dead' }, FRAME)).toEqual({ lower: 0, tell: 0 });
  });
});

describe('the wind-up glint (U-158)', () => {
  it('is hidden until a frame glints, and the same size on screen at any range', () => {
    const cue = createWindUpCue();
    expect(cue.visible).toBe(false);
    const material = cue.material as THREE.SpriteMaterial;
    expect(material.sizeAttenuation).toBe(false);
    expect(material.blending).toBe(THREE.AdditiveBlending);
    applyWindUpCue(cue, { lower: 0, tell: 1 });
    expect(cue.visible).toBe(true);
    expect(cue.scale.x).toBeCloseTo(WIND_UP_CUE_SCREEN, 6);
    applyWindUpCue(cue, { lower: 0, tell: 0.6 });
    expect(cue.scale.x).toBeLessThan(WIND_UP_CUE_SCREEN);
    applyWindUpCue(cue, { lower: 1, tell: 0 });
    expect(cue.visible).toBe(false);
  });
});
