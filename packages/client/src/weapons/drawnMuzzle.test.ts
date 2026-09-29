/**
 * U-003: the picture of a shot leaves the gun you can see. Headless, on the
 * real pieces: `CombatQA`'s predicted streaks (how many, where they start and
 * end), the viewmodel's drawn barrel, and the carry from the viewmodel's
 * camera to the world's. What a flash LOOKS like is not a test's to judge.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MUZZLE_RIG, TICK_SECONDS, eyePosition, shotDirections } from '@sandline/shared';
import { CombatQA, WEAPON_ORDER } from './CombatQA.ts';
import { NEAREST_DRAWN_M, WALL_MARGIN_M, keepInFront, viewToWorld } from './drawnMuzzle.ts';
import { VIEWMODEL_FOV, ViewModel } from './viewModel.ts';

const lines = (scene: THREE.Scene): THREE.Line[] => scene.children.filter((c): c is THREE.Line => c instanceof THREE.Line);

/** A wall across the range, 20 m ahead (+Z), for streaks to stop on. */
function range(): { scene: THREE.Scene; combat: CombatQA } {
  const scene = new THREE.Scene();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(40, 10, 0.2), new THREE.MeshBasicMaterial());
  wall.position.set(0, 2, 20);
  wall.updateMatrixWorld();
  return { scene, combat: new CombatQA(scene, [wall]) };
}

/** Pull the trigger once on the weapon in hand; the shot's directions, as the page computes them. */
function pull(combat: CombatQA, tick: number, yaw = 0, pitch = 0) {
  const shot = combat.tick(tick, tick * TICK_SECONDS, {
    origin: new THREE.Vector3(),
    yaw,
    pitch,
    firing: true,
    triggerEdge: true,
    ads: true,
  });
  if (!shot) throw new Error('no shot');
  return shotDirections(combat.weapon, shot, 7, tick, yaw, pitch);
}

describe('predicted tracers (U-003)', () => {
  it('one AR round is one streak, drawn by the frame from the barrel, and the server\'s answer adds none', () => {
    const { scene, combat } = range();
    const eye = new THREE.Vector3(0, 1.15, 0); // crouched
    combat.predictShot(eye, pull(combat, 1), TICK_SECONDS);
    // Nothing until the frame knows where the barrel is drawn.
    expect(lines(scene)).toHaveLength(0);
    expect(combat.queuedTracers).toBe(1);
    const barrel = new THREE.Vector3(0.12, 1.02, 0.6);
    combat.drawPredicted(barrel);
    expect(lines(scene)).toHaveLength(1);
    expect(combat.queuedTracers).toBe(0);
    // A second frame draws nothing more.
    combat.drawPredicted(barrel);
    expect(lines(scene)).toHaveLength(1);
    expect(combat.tracing).toBe(true);
    // The server's confirmation lands the hit, not another line.
    combat.drawServerShot(eye, new THREE.Vector3(0, 1.15, 19.9), 0, 0, 2 * TICK_SECONDS);
    combat.drawServerShot(eye, new THREE.Vector3(0, 1.15, 19.9), 42, 30, 2 * TICK_SECONDS);
    expect(lines(scene)).toHaveLength(1);
  });

  it('starts at the barrel and ends where the round from the EYE stops: on the crosshair, not parallel to it', () => {
    const { combat } = range();
    const eye = new THREE.Vector3(0, 1.15, 0);
    combat.predictShot(eye, pull(combat, 1), TICK_SECONDS);
    // A hip barrel low and right of the eye.
    const barrel = new THREE.Vector3(-0.2, 0.9, 0.5);
    combat.drawPredicted(barrel);
    const [streak] = combat.ownTracers();
    expect(streak!.from.distanceTo(barrel)).toBeLessThan(1e-6);
    // The first round of a fresh carbine at ADS goes nearly straight: its end is on the wall at the eye's height.
    expect(streak!.to.z).toBeCloseTo(19.9, 1);
    expect(Math.abs(streak!.to.y - 1.15)).toBeLessThan(0.1);
    expect(Math.abs(streak!.to.x)).toBeLessThan(0.1);
  });

  it('keeps each live streak\'s start on the barrel as the barrel moves, and leaves its end where it was', () => {
    const { combat } = range();
    const eye = new THREE.Vector3(0, 1.55, 0);
    combat.predictShot(eye, pull(combat, 1), TICK_SECONDS);
    combat.drawPredicted(new THREE.Vector3(0, 1.4, 0.6));
    const end = combat.ownTracers()[0]!.to.clone();
    const moved = new THREE.Vector3(0.05, 1.42, 0.78);
    combat.drawPredicted(moved);
    const [streak] = combat.ownTracers();
    expect(streak!.from.distanceTo(moved)).toBeLessThan(1e-6);
    expect(streak!.to.distanceTo(end)).toBeLessThan(1e-6);
  });

  it('a shotgun still draws a streak per pellet, every one from the barrel', () => {
    const { scene, combat } = range();
    combat.selectWeapon(WEAPON_ORDER.indexOf('breacher'));
    const directions = pull(combat, 1);
    expect(directions.length).toBe(combat.weapon.pellets);
    expect(combat.weapon.pellets).toBeGreaterThan(1);
    combat.predictShot(new THREE.Vector3(0, 1.55, 0), directions, TICK_SECONDS);
    const barrel = new THREE.Vector3(0.1, 1.4, 0.7);
    combat.drawPredicted(barrel);
    expect(lines(scene)).toHaveLength(combat.weapon.pellets);
    for (const streak of combat.ownTracers()) expect(streak.from.distanceTo(barrel)).toBeLessThan(1e-6);
  });

  it('another soldier\'s shot is one streak along the server\'s segment, and never follows our barrel', () => {
    const { scene, combat } = range();
    combat.drawTracer(new THREE.Vector3(5, 1.55, 0), new THREE.Vector3(0, 1, 10), TICK_SECONDS);
    combat.drawPredicted(new THREE.Vector3(0, 1.4, 0.6));
    expect(lines(scene)).toHaveLength(1);
    expect(combat.ownTracers()).toHaveLength(0);
  });

  it('streaks fade out on their own clock, and a held trigger holds a bounded number', () => {
    const { scene, combat } = range();
    const eye = new THREE.Vector3(0, 1.55, 0);
    const barrel = new THREE.Vector3(0.1, 1.4, 0.6);
    let fired = 0;
    for (let tick = 1; tick <= 30; tick += 1) {
      const shot = combat.tick(tick, tick * TICK_SECONDS, { origin: eye, yaw: 0, pitch: 0, firing: true, triggerEdge: tick === 1, ads: true });
      if (shot) {
        fired += 1;
        combat.predictShot(eye, shotDirections(combat.weapon, shot, 7, tick, 0, 0), tick * TICK_SECONDS);
      }
      combat.fade(tick * TICK_SECONDS);
      combat.drawPredicted(barrel);
      // At the carbine's cadence no more than a couple are ever alive at once.
      expect(lines(scene).length).toBeLessThanOrEqual(2);
    }
    expect(fired).toBeGreaterThan(5);
    combat.fade(2);
    expect(lines(scene)).toHaveLength(0);
    // Nothing left to draw from the barrel: the frame stops looking for it.
    expect(combat.tracing).toBe(false);
  });
});

/** A world camera at an eye, looking along +Z, at a field of view. */
function worldCamera(eyeY: number, fov: number, yaw = 0, pitch = 0): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(fov, 16 / 9, 0.1, 500);
  camera.position.set(3, eyeY, -2);
  camera.rotation.set(pitch, yaw + Math.PI, 0, 'YXZ');
  camera.updateMatrixWorld();
  return camera;
}

/** The viewmodel as the page drives it, settled into hip or ADS. */
function settled(held: string, ads: boolean): ViewModel {
  const vm = new ViewModel();
  for (let i = 0; i < 120; i += 1) {
    vm.update({ visible: true, held, ads, winding: false, kickBack: 0, kickUp: 0, reload: 0, speed: 0, dt: 1 / 60, aspect: 16 / 9 });
  }
  return vm;
}

/** Normalized device coordinates of a world point through a camera. */
const ndc = (p: THREE.Vector3, camera: THREE.Camera) => p.clone().project(camera);

describe('the drawn barrel in first person (U-003)', () => {
  it('the viewmodel\'s barrel is ahead of the eye: at ADS just under the screen\'s centre, at the hip low and right', () => {
    for (const held of ['carbine', 'lmg', 'breacher', 'sidearm', 'marksman']) {
      const ads = settled(held, true).muzzle(new THREE.Vector3())!;
      const hip = settled(held, false).muzzle(new THREE.Vector3())!;
      expect(ads.z, held).toBeLessThan(-0.3);
      expect(hip.z, held).toBeLessThan(-0.3);
      // At ADS the bore runs under the sight line, centred.
      expect(Math.abs(ads.x), held).toBeLessThan(0.01);
      expect(ads.y, held).toBeLessThan(0);
      expect(ads.y, held).toBeGreaterThan(-0.12);
      // At the hip, right of and below the view axis.
      expect(hip.x, held).toBeGreaterThan(0.05);
      expect(hip.y, held).toBeLessThan(-0.05);
    }
  });

  it('a left-handed rifle rides the left of the screen at the hip and is centred at ADS (U-042)', () => {
    const hip = settled('sniper-bolt-left', false).muzzle(new THREE.Vector3())!;
    const ads = settled('sniper-bolt-left', true).muzzle(new THREE.Vector3())!;
    expect(hip.x).toBeLessThan(-0.05);
    expect(hip.y).toBeLessThan(-0.05);
    expect(Math.abs(ads.x)).toBeLessThan(0.01);
  });

  it('carried into the world, the barrel lands on the screen exactly where the viewmodel draws it — every stance, at the hip and zoomed at ADS', () => {
    const vmCamera = new THREE.PerspectiveCamera(VIEWMODEL_FOV, 16 / 9, 0.01, 5);
    vmCamera.updateMatrixWorld();
    for (const [ads, fov] of [[false, 75], [true, 50]] as const) {
      const tip = settled('carbine', ads).muzzle(new THREE.Vector3())!;
      const want = ndc(tip, vmCamera);
      for (const stance of ['standing', 'crouched', 'prone'] as const) {
        const eye = eyePosition(3, 0, -2, DEFAULT_MUZZLE_RIG, stance);
        for (const [yaw, pitch] of [[0, 0], [1.1, -0.3], [-2.4, 0.5]]) {
          const camera = worldCamera(eye.y, fov, yaw, pitch);
          const world = viewToWorld(tip, VIEWMODEL_FOV, camera, new THREE.Vector3());
          const got = ndc(world, camera);
          expect(got.x).toBeCloseTo(want.x, 5);
          expect(got.y).toBeCloseTo(want.y, 5);
          // At the barrel's own depth ahead of the eye: in front of the near plane, not at the eye.
          expect(world.clone().applyMatrix4(camera.matrixWorldInverse).z).toBeCloseTo(tip.z, 5);
        }
      }
    }
  });
});

describe('keeping the drawn barrel in front of a wall (U-003)', () => {
  const eye = new THREE.Vector3(0, 1.55, 0);
  it('leaves it be in the open', () => {
    const p = new THREE.Vector3(0.2, 1.4, 0.6);
    expect(keepInFront(eye, p.clone(), null)).toEqual(p);
    expect(keepInFront(eye, p.clone(), 5)).toEqual(p);
  });
  it('pulls it back along the eye\'s ray to just short of a nearer wall: the same spot on screen, still drawn', () => {
    const p = new THREE.Vector3(0.2, 1.4, 0.6);
    const kept = keepInFront(eye, p.clone(), 0.4);
    expect(kept.distanceTo(eye)).toBeCloseTo(0.4 - WALL_MARGIN_M, 6);
    const along = p.clone().sub(eye).normalize();
    expect(kept.clone().sub(eye).normalize().distanceTo(along)).toBeLessThan(1e-9);
  });
  it('never nearer than the near plane allows', () => {
    const kept = keepInFront(eye, new THREE.Vector3(0.2, 1.4, 0.6), 0.05);
    expect(kept.distanceTo(eye)).toBeCloseTo(NEAREST_DRAWN_M, 6);
  });
});
