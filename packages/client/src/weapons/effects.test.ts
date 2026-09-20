/**
 * T-2.10. The pool is the point: a held trigger must not grow the scene, and
 * everything must be gone within a bound derived from the numbers.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  FLASH_FORWARD_M,
  FLASH_LIGHT_INTENSITY,
  FLASH_POOL,
  FLASH_SECONDS,
  GRAVITY_M_S2,
  SHELL_FADE_SECONDS,
  SHELL_POOL,
  SHELL_REST_SECONDS,
  SHELL_SIZE_M,
  WeaponEffects,
  ejectVelocity,
  flightSeconds,
  shellLifetimeSeconds,
} from './effects.ts';

/** Facing +Z: forward = (0, 0, 1), so right = (-1, 0, 0) and back = (0, 0, -1). */
const FWD_X = 0;
const FWD_Z = 1;
const MUZZLE = new THREE.Vector3(2, 1.42, 3);
const FLOOR_Y = 0;

function setup() {
  const scene = new THREE.Scene();
  const fx = new WeaponEffects(scene);
  return { scene, fx };
}

/** The scene's live children: what a renderer would actually draw. */
function visibleCount(scene: THREE.Scene): number {
  return scene.children.filter((o) => o.visible).length;
}

describe('a held trigger cannot leak the scene (T-2.10)', () => {
  it('five seconds at 20 shots a second ends with the pool at its cap and no object beyond it', () => {
    const { scene, fx } = setup();
    const objectsAtStart = scene.children.length;
    const seen = new Set<THREE.Object3D>(scene.children);
    const dt = 1 / 60;
    let now = 0;
    let shot = 0;
    let nextShot = 0;
    while (now < 5) {
      if (now >= nextShot) {
        shot += 1;
        fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, shot, now);
        nextShot += 0.05;
      }
      fx.update(now);
      for (const o of scene.children) seen.add(o);
      expect(scene.children.length).toBe(objectsAtStart);
      expect(fx.liveShells).toBeLessThanOrEqual(SHELL_POOL);
      expect(fx.liveFlashes).toBeLessThanOrEqual(FLASH_POOL);
      now += dt;
    }
    expect(shot).toBe(100);
    // Saturated: a shell lives longer than the pool takes to fill at this rate.
    expect(fx.liveShells).toBe(SHELL_POOL);
    // Every object the scene ever held was there before the first shot.
    expect(seen.size).toBe(objectsAtStart);
  });

  it('returns to zero within the derived lifetime after release', () => {
    const { scene, fx } = setup();
    let now = 0;
    for (let shot = 1; shot <= 100; shot += 1) {
      fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, shot, now);
      fx.update(now);
      now += 0.05;
    }
    const released = now;
    const bound = shellLifetimeSeconds(MUZZLE.y - FLOOR_Y);
    // Halfway through the bound, shells are still lying there.
    while (now < released + bound / 2) {
      fx.update(now);
      now += 1 / 60;
    }
    expect(fx.liveShells).toBeGreaterThan(0);
    while (now <= released + bound + 1 / 60) {
      fx.update(now);
      now += 1 / 60;
    }
    expect(fx.liveShells).toBe(0);
    expect(fx.liveFlashes).toBe(0);
    expect(visibleCount(scene)).toBe(0);
  });

  it('a full pool recycles the oldest shell rather than dropping the new one', () => {
    const { fx } = setup();
    // Births half a second apart: further than any two lifetimes differ.
    for (let shot = 1; shot <= SHELL_POOL; shot += 1) fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, shot, shot * 0.5);
    expect(fx.liveShells).toBe(SHELL_POOL);
    fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, SHELL_POOL + 1, (SHELL_POOL + 1) * 0.5);
    expect(fx.liveShells).toBe(SHELL_POOL);
    // Past the first shell's longest possible life, before the second's
    // shortest: had the first survived it would retire here. It was recycled
    // instead, so the count holds at the cap.
    const longest = shellLifetimeSeconds(MUZZLE.y - FLOOR_Y);
    fx.update(0.5 + longest + 0.01);
    expect(fx.liveShells).toBe(SHELL_POOL);
    // And the second goes on schedule.
    fx.update(1.0 + longest + 0.01);
    expect(fx.liveShells).toBe(SHELL_POOL - 1);
  });
});

describe('muzzle flash (T-2.10)', () => {
  it('appears just ahead of the muzzle, lit, and is gone after two frames', () => {
    const { scene, fx } = setup();
    fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, 1, 1);
    fx.update(1);
    expect(fx.liveFlashes).toBe(1);
    const light = scene.children.find((o): o is THREE.PointLight => o instanceof THREE.PointLight && o.visible);
    const sprite = scene.children.find((o): o is THREE.Sprite => o instanceof THREE.Sprite && o.visible);
    expect(light).toBeDefined();
    expect(sprite).toBeDefined();
    if (!light || !sprite) return;
    expect(sprite.position.x).toBeCloseTo(MUZZLE.x, 12);
    expect(sprite.position.y).toBeCloseTo(MUZZLE.y, 12);
    expect(sprite.position.z).toBeCloseTo(MUZZLE.z + FLASH_FORWARD_M, 12);
    expect(light.intensity).toBe(FLASH_LIGHT_INTENSITY);

    fx.update(1 + FLASH_SECONDS / 2);
    expect(light.intensity).toBeCloseTo(FLASH_LIGHT_INTENSITY / 2, 9);
    fx.update(1 + FLASH_SECONDS);
    expect(fx.liveFlashes).toBe(0);
    expect(light.visible).toBe(false);
    expect(sprite.visible).toBe(false);
  });

  it('gives each shot its own flash rather than restarting one', () => {
    const { fx } = setup();
    fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, 1, 0);
    fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, 2, FLASH_SECONDS / 2);
    fx.update(FLASH_SECONDS / 2);
    expect(fx.liveFlashes).toBe(2);
  });
});

describe('shell ejection (T-2.10)', () => {
  it('throws the shell right and back of the muzzle, and upward', () => {
    for (let shot = 1; shot <= 40; shot += 1) {
      const v = ejectVelocity(FWD_X, FWD_Z, shot);
      // right is (-1, 0, 0); back is (0, 0, -1).
      expect(v.x).toBeLessThan(0);
      expect(v.z).toBeLessThan(0);
      expect(v.y).toBeGreaterThan(0);
    }
    // And it follows the facing: turned to +X, right is +Z.
    const turned = ejectVelocity(1, 0, 3);
    expect(turned.z).toBeGreaterThan(0);
    expect(turned.x).toBeLessThan(0);
  });

  it('is the same throw every time and not the same for every shot', () => {
    expect(ejectVelocity(FWD_X, FWD_Z, 7)).toEqual(ejectVelocity(FWD_X, FWD_Z, 7));
    expect(ejectVelocity(FWD_X, FWD_Z, 7)).not.toEqual(ejectVelocity(FWD_X, FWD_Z, 8));
  });

  it('follows the closed-form arc and lands exactly when the formula says', () => {
    const { scene, fx } = setup();
    fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, 1, 0);
    const v = ejectVelocity(FWD_X, FWD_Z, 1);
    const shell = scene.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.visible);
    expect(shell).toBeDefined();
    if (!shell) return;
    const restY = FLOOR_Y + SHELL_SIZE_M.y / 2;
    const flight = flightSeconds(v.y, MUZZLE.y - restY);

    const t = flight / 2;
    fx.update(t);
    expect(shell.position.x).toBeCloseTo(MUZZLE.x + v.x * t, 12);
    expect(shell.position.y).toBeCloseTo(MUZZLE.y + v.y * t - 0.5 * GRAVITY_M_S2 * t * t, 12);
    expect(shell.position.z).toBeCloseTo(MUZZLE.z + v.z * t, 12);
    expect(shell.position.y).toBeGreaterThan(restY);

    fx.update(flight + 1e-9);
    expect(shell.position.y).toBeCloseTo(restY, 12);
    // The arc's own height at the landing time is the floor: the two agree.
    expect(MUZZLE.y + v.y * flight - 0.5 * GRAVITY_M_S2 * flight * flight).toBeCloseTo(restY, 9);
    // Then it stays put through the rest.
    fx.update(flight + SHELL_REST_SECONDS / 2);
    expect(shell.position.y).toBeCloseTo(restY, 12);
    expect(shell.position.x).toBeCloseTo(MUZZLE.x + v.x * flight, 12);
    expect(shell.material).toHaveProperty('opacity', 1);
  });

  it('fades after resting and retires at the end of the fade, at any frame rate', () => {
    const v = ejectVelocity(FWD_X, FWD_Z, 1);
    const flight = flightSeconds(v.y, MUZZLE.y - SHELL_SIZE_M.y / 2);
    for (const fps of [30, 120]) {
      const { scene, fx } = setup();
      fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, 1, 0);
      const shell = scene.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.visible);
      if (!shell) throw new Error('no shell');
      const material = shell.material as THREE.MeshBasicMaterial;
      let now = 0;
      const midFade = flight + SHELL_REST_SECONDS + SHELL_FADE_SECONDS / 2;
      while (now < midFade) {
        now += 1 / fps;
        fx.update(now);
      }
      expect(material.opacity).toBeGreaterThan(0.3);
      expect(material.opacity).toBeLessThan(0.7);
      while (now < flight + SHELL_REST_SECONDS + SHELL_FADE_SECONDS) {
        now += 1 / fps;
        fx.update(now);
      }
      expect(fx.liveShells).toBe(0);
    }
  });

  it('places the shell identically at 30 and 120 fps because the arc is closed-form', () => {
    const at = (fps: number): THREE.Vector3 => {
      const { scene, fx } = setup();
      fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, 5, 0);
      const shell = scene.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.visible);
      if (!shell) throw new Error('no shell');
      let now = 0;
      for (let i = 0; i < fps * 0.3; i += 1) {
        now += 1 / fps;
        fx.update(now);
      }
      return shell.position.clone();
    };
    const a = at(30);
    const b = at(120);
    // Both end at t = 0.3 s within float error, so the positions agree.
    expect(a.distanceTo(b)).toBeLessThan(1e-9);
  });

  it('derives the lifetime bound from the throw, the rest and the fade', () => {
    const bound = shellLifetimeSeconds(1.42);
    expect(bound).toBeGreaterThan(SHELL_REST_SECONDS + SHELL_FADE_SECONDS);
    expect(bound).toBeLessThan(SHELL_REST_SECONDS + SHELL_FADE_SECONDS + 1);
    expect(flightSeconds(0, 0)).toBe(0);
    // Straight drop from 1 m: sqrt(2h/g).
    expect(flightSeconds(0, 1)).toBeCloseTo(Math.sqrt(2 / GRAVITY_M_S2), 12);
  });

  it('reset hides everything without freeing the pool', () => {
    const { scene, fx } = setup();
    const before = scene.children.length;
    for (let shot = 1; shot <= 5; shot += 1) fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, shot, 0);
    fx.reset();
    expect(fx.liveShells).toBe(0);
    expect(fx.liveFlashes).toBe(0);
    expect(visibleCount(scene)).toBe(0);
    expect(scene.children.length).toBe(before);
  });
});
