/**
 * U-006: the first-person reload is a readable animation, not the gun
 * leaving the screen. The pose curve on its own (continuity, rest at both
 * ends, the beats on the sound stages), and the real `ViewModel` driven
 * through reloads: the gun and — while the hand is on it — the magazine on
 * screen, an interrupted reload settling instead of popping, and nothing
 * left half-drawn across a hide or a swap. Whether it LOOKS right is the
 * owner's to judge from the captures, not these tests.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WEAPON_SOUNDS } from '@sandline/shared';
import { MAG_OUT_M, REST_POSE, reloadPose, settle } from './reloadPose.ts';
import { VIEWMODEL_FOV, ViewModel, type ViewModelState } from './viewModel.ts';
import { createWeaponModel, weaponMagazine } from './weaponModels.ts';

const KEYS = Object.keys(REST_POSE) as (keyof typeof REST_POSE)[];
const STAGES = WEAPON_SOUNDS.stages;

describe('the reload pose (U-006)', () => {
  it('is the rest pose before and after a reload, and at both of its ends', () => {
    for (const p of [0, -1, 1, 1.5, Number.NaN]) expect(reloadPose(p)).toEqual(REST_POSE);
    for (const key of KEYS) {
      expect(Math.abs(reloadPose(1e-4)[key]), key).toBeLessThan(1e-3);
      expect(Math.abs(reloadPose(1 - 1e-4)[key]), key).toBeLessThan(1e-3);
    }
  });

  it('never jumps: every term moves by a small amount per hundredth of the reload', () => {
    let last = reloadPose(0);
    for (let i = 1; i <= 1000; i += 1) {
      const next = reloadPose(i / 1000);
      for (const key of KEYS) expect(Math.abs(next[key] - last[key]), `${key} at ${i / 1000}`).toBeLessThan(key === 'magOut' ? 0.01 : 0.03);
      last = next;
    }
  });

  it('lands its beats on the sound stages: the magazine seated at `in`, the hand on it until then, the bolt rocking the gun', () => {
    // Out of the well and out of view mid-reload, with the hand on it.
    const mid = reloadPose((0.34 + 0.4) / 2);
    expect(mid.magOut).toBeCloseTo(MAG_OUT_M, 6);
    expect(mid.handOnMag).toBeCloseTo(1, 6);
    // Going back in just before the seat; seated exactly at `in`.
    expect(reloadPose(STAGES.in - 0.03).magOut).toBeGreaterThan(0);
    expect(reloadPose(STAGES.in).magOut).toBeCloseTo(0, 9);
    expect(reloadPose(STAGES.in + 0.1).magOut).toBe(0);
    // The seat and the bolt each move the gun, at their own stage.
    expect(reloadPose(STAGES.in + 0.03).pitch).toBeGreaterThan(reloadPose(STAGES.in).pitch);
    expect(reloadPose(STAGES.bolt + 0.04).z).toBeGreaterThan(reloadPose(STAGES.bolt).z);
    // The hand is home again after the seat.
    expect(reloadPose(STAGES.in + 0.15).handOnMag).toBeCloseTo(0, 6);
  });

  it('an interrupted pose settles to rest within a quarter second, never snapping', () => {
    const pose = reloadPose(0.3);
    let dt = 0;
    const start = Math.abs(pose.roll);
    expect(start).toBeGreaterThan(0.3);
    for (let i = 0; i < 15; i += 1) {
      const before = Math.abs(pose.roll);
      settle(pose, 1 / 60);
      dt += 1 / 60;
      expect(before - Math.abs(pose.roll)).toBeLessThan(start * 0.25);
    }
    expect(dt).toBeCloseTo(0.25, 6);
    for (const key of KEYS) expect(Math.abs(pose[key]), key).toBeLessThan(0.06 * Math.max(1, Math.abs(reloadPose(0.3)[key])));
  });
});

const BASE: ViewModelState = { visible: true, held: 'carbine', ads: false, winding: false, kickBack: 0, kickUp: 0, reload: 0, speed: 0, dt: 1 / 60, aspect: 16 / 9 };

function settled(state: Partial<ViewModelState> = {}): ViewModel {
  const vm = new ViewModel();
  for (let i = 0; i < 120; i += 1) vm.update({ ...BASE, ...state });
  return vm;
}

/** The viewmodel camera, as the page draws it. */
function camera(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(VIEWMODEL_FOV, 16 / 9, 0.01, 5);
  c.updateMatrixWorld();
  return c;
}

/** Where on screen (NDC) an object's world position lands, and whether it is in front and inside the frame. */
function onScreen(object: THREE.Object3D, margin = 0.95): boolean {
  object.updateWorldMatrix(true, false);
  const p = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld).project(camera());
  return p.z < 1 && Math.abs(p.x) < margin && Math.abs(p.y) < margin;
}

/** Every mesh of the held gun: is any of it on screen? */
function gunOnScreen(vm: ViewModel): boolean {
  const scene = vm.scene;
  scene.updateMatrixWorld(true);
  let seen = false;
  const box = new THREE.Box3();
  scene.traverseVisible((o) => {
    if (!(o instanceof THREE.Mesh) || seen) return;
    box.setFromObject(o);
    const c = box.getCenter(new THREE.Vector3()).project(camera());
    if (c.z < 1 && Math.abs(c.x) < 1 && Math.abs(c.y) < 1) seen = true;
  });
  return seen;
}

describe('the first-person reload on the viewmodel (U-006)', () => {
  it('keeps the gun on screen through the whole reload, from the hip and from ADS', () => {
    for (const ads of [false, true]) {
      const vm = settled({ ads });
      for (let i = 1; i < 100; i += 1) {
        vm.update({ ...BASE, ads, reload: i / 100 });
        expect(gunOnScreen(vm), `${ads ? 'ADS' : 'hip'} at ${i / 100}`).toBe(true);
      }
    }
  });

  it('brings the magazine into view while the hand is on it — at the pull and at the seat', () => {
    const vm = settled();
    // The model the viewmodel holds: its magazine is the named child.
    let magazine: THREE.Object3D | null = null;
    vm.scene.traverse((o) => {
      if (o.name === 'magazine' && o.visible && o.parent?.visible) magazine = o;
    });
    expect(magazine).not.toBeNull();
    for (const p of [0.16, 0.2, STAGES.in - 0.05, STAGES.in]) {
      vm.update({ ...BASE, reload: p });
      expect(onScreen(magazine!), `magazine at ${p}`).toBe(true);
    }
  });

  it('comes off the sight for the reload and goes back to it after', () => {
    const vm = settled({ ads: true });
    expect(vm.adsAmount).toBeGreaterThan(0.99);
    for (let i = 1; i < 60; i += 1) vm.update({ ...BASE, ads: true, reload: i / 60 });
    expect(vm.adsAmount).toBeLessThan(0.05);
    for (let i = 0; i < 60; i += 1) vm.update({ ...BASE, ads: true, reload: 0 });
    expect(vm.adsAmount).toBeGreaterThan(0.99);
  });

  it('an interrupted reload settles back to the hold instead of popping, and its magazine goes home', () => {
    const vm = settled();
    vm.update({ ...BASE, reload: 0.3 });
    const roll = Math.abs(vm.reloadPose.roll);
    expect(roll).toBeGreaterThan(0.3);
    vm.update({ ...BASE, reload: 0 });
    // One frame later: partly back, not snapped.
    expect(Math.abs(vm.reloadPose.roll)).toBeGreaterThan(roll * 0.5);
    for (let i = 0; i < 30; i += 1) vm.update({ ...BASE, reload: 0 });
    expect(Math.abs(vm.reloadPose.roll)).toBeLessThan(0.01);
    expect(vm.reloadPose.magOut).toBeLessThan(0.005);
  });

  it('hidden (down, dead, a vault, third person) drops any reload pose, so it never comes back half-drawn', () => {
    const vm = settled();
    vm.update({ ...BASE, reload: 0.3 });
    vm.update({ ...BASE, visible: false });
    for (const key of KEYS) expect(vm.reloadPose[key]).toBe(0);
  });

  it('a swap mid-reload puts the old gun\'s magazine back in its well', () => {
    const vm = settled();
    let magazine: THREE.Object3D | null = null;
    vm.scene.traverse((o) => {
      if (o.name === 'magazine' && o.parent?.visible) magazine = o;
    });
    const rest = magazine!.position.clone();
    vm.update({ ...BASE, reload: 0.3 });
    expect(magazine!.position.distanceTo(rest)).toBeGreaterThan(0.1);
    // The pistol comes up; the carbine goes away whole.
    for (let i = 0; i < 60; i += 1) vm.update({ ...BASE, held: 'sidearm', reload: 0 });
    expect(magazine!.position.distanceTo(rest)).toBeLessThan(1e-9);
  });
});

describe('the magazine as a part (U-006)', () => {
  it('the carbine and the marksman rifle have one; the shotgun and pistol reload with their hands alone', () => {
    expect(weaponMagazine(createWeaponModel('carbine'))).not.toBeNull();
    expect(weaponMagazine(createWeaponModel('marksman'))).not.toBeNull();
    expect(weaponMagazine(createWeaponModel('breacher'))).toBeNull();
    expect(weaponMagazine(createWeaponModel('sidearm'))).toBeNull();
  });
});
