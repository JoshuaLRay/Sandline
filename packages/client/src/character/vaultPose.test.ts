/**
 * T-2.23: the vault pose, its blends, and what it must never disturb.
 *
 * The sequences here are what main.ts feeds the driver: a walk, then the
 * classifier's 'vault' results with the authoritative progress advancing at
 * the frame rate over `vaultSeconds`, then a walk or an idle. The numbers
 * are pinned here, not read from movement config, so tuning a vault can
 * never change what this proves.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HUMANOID_BONES, type HumanoidRig, requireRig } from './humanoidRig.ts';
import { HUMANOID_ROOT_LIFT_M, createHumanoidPlaceholder } from './humanoidPlaceholder.ts';
import { createHumanoidSoldier } from './humanoidSoldier.ts';
import {
  LANDING_SECONDS,
  VAULT_EXIT_SECONDS,
  createLocomotionPoseDriver,
  type LocomotionPoseDriver,
} from './locomotionPose.ts';
import type { LocomotionResult } from './locomotionState.ts';

const VAULT_SECONDS = 0.55;
/** The fastest any joint may turn through a vault cycle, radians per second. */
const MAX_JOINT_RAD_PER_S = 14;

const WALK: LocomotionResult = {
  state: 'walk',
  direction: 'forward',
  speed: 4.2,
  normalizedSpeed: 1,
  gaitRate: 1,
  airborne: false,
  directionAngle: 0,
  vaultProgress: 0,
};
const IDLE: LocomotionResult = { ...WALK, state: 'idle', speed: 0, normalizedSpeed: 0, gaitRate: 0 };
const CROUCH_WALK: LocomotionResult = { ...WALK, state: 'crouch-walk', speed: 1.9, normalizedSpeed: 1 };

function vaultAt(p: number): LocomotionResult {
  return { ...WALK, state: 'vault', speed: 2.7, normalizedSpeed: 0.65, gaitRate: 0, airborne: true, vaultProgress: p };
}

/** The frames main.ts would feed: `before` frames of walking, the vault, `after` frames of `then`. */
function* cycle(dt: number, before: LocomotionResult, then: LocomotionResult, beforeFrames = 30, afterFrames = 60): Generator<LocomotionResult> {
  for (let i = 0; i < beforeFrames; i += 1) yield before;
  for (let t = dt; t < VAULT_SECONDS; t += dt) yield vaultAt(t / VAULT_SECONDS);
  for (let i = 0; i < afterFrames; i += 1) yield then;
}

function snapshot(rig: HumanoidRig) {
  const out: { name: string; p: number[]; q: number[] }[] = [];
  for (const name of HUMANOID_BONES) {
    const bone = rig.bone(name);
    if (bone) out.push({ name, p: bone.position.toArray(), q: bone.quaternion.toArray() });
  }
  return out;
}

function worldOf(rig: HumanoidRig, node: THREE.Object3D): THREE.Vector3 {
  rig.root.updateMatrixWorld(true);
  return new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
}

const factories = [
  ['skinned', createHumanoidSoldier],
  ['grey-box', createHumanoidPlaceholder],
] as const;

describe('vault pose entry and exit (T-2.23)', () => {
  for (const [kind, make] of factories) {
    it(`${kind}: restores the exact standing rest after a walk, a vault and a stop`, () => {
      const rig = requireRig(make('local'));
      const driver = createLocomotionPoseDriver(rig);
      const rest = snapshot(rig);
      let sawVault = false;
      for (const frame of cycle(1 / 60, WALK, IDLE)) {
        driver.update(frame, 1 / 60);
        if (frame.state === 'vault' && driver.vaultWeight === 1) sawVault = true;
      }
      expect(sawVault).toBe(true);
      expect(driver.vaultWeight).toBe(0);
      expect(snapshot(rig)).toEqual(rest);
      expect(snapshot(rig)).toEqual(snapshot(requireRig(make('local'))));
    });

    it(`${kind}: restores the exact crouched rest when the landing is into a crouch`, () => {
      const rig = requireRig(make('remote'));
      const driver = createLocomotionPoseDriver(rig);
      rig.setPose('crouched');
      const crouched = snapshot(rig);
      // Crouch-walk up to it; the server stands the soldier up for the vault
      // (main.ts sets the standing pose while `vault` is set), then crouches
      // again on landing and stops.
      const frames = [...cycle(1 / 60, CROUCH_WALK, { ...IDLE, state: 'idle' })];
      for (const frame of frames) {
        if (frame.state === 'vault') rig.setPose('standing');
        else rig.setPose('crouched');
        driver.update(frame, 1 / 60);
      }
      expect(rig.pose).toBe('crouched');
      expect(snapshot(rig)).toEqual(crouched);
    });
  }

  it('does not snap: no frame of the vault turns a bone faster than the walk it interrupts', () => {
    for (const [, make] of factories) {
      for (const fps of [30, 60]) {
        // The walk's own largest per-frame step, a knee through its swing.
        const walkRig = requireRig(make('local'));
        const walkDriver = createLocomotionPoseDriver(walkRig);
        for (let i = 0; i < 90; i += 1) walkDriver.update(WALK, 1 / fps);
        const walkPeak = walkDriver.peakStep;
        expect(walkPeak).toBeGreaterThan(0);

        const rig = requireRig(make('local'));
        const driver = createLocomotionPoseDriver(rig);
        for (const frame of cycle(1 / fps, WALK, WALK)) driver.update(frame, 1 / fps);
        // Entry, the traversal, the landing and the exit never turn a joint
        // faster than a fast joint turns: a walking knee peaks near 10 rad/s.
        // A snap (a whole pose in one frame) is a radian in a frame, thirty
        // or sixty radians a second.
        expect(driver.peakStep).toBeLessThan(MAX_JOINT_RAD_PER_S / fps);
        // And on the rig with knees, no more abrupt than the walk it interrupts.
        if (rig.kind === 'skinned') expect(driver.peakStep).toBeLessThan(walkPeak * 1.4);
      }
    }
  });

  it('is a curve of the authoritative progress: the same progress is the same pose on any driver', () => {
    // Local prediction and remote interpolation feed the same numbers; the
    // pose must not depend on which one it was.
    const a = requireRig(createHumanoidSoldier('local'));
    const b = requireRig(createHumanoidSoldier('remote'));
    const da = createLocomotionPoseDriver(a);
    const db = createLocomotionPoseDriver(b);
    for (const frame of cycle(1 / 60, WALK, WALK)) {
      da.update(frame, 1 / 60);
      db.update(frame, 1 / 60);
      for (const name of HUMANOID_BONES) {
        expect(a.bone(name)!.quaternion.toArray()).toEqual(b.bone(name)!.quaternion.toArray());
      }
    }
    expect(da.peakStep).toBeCloseTo(db.peakStep, 12);
  });

  it('actually vaults: the lead leg lifts and the chest leans mid-vault, and only then', () => {
    const rig = requireRig(createHumanoidSoldier('local'));
    const driver = createLocomotionPoseDriver(rig);
    const identity = new THREE.Quaternion();
    const thigh = (): number => new THREE.Euler().setFromQuaternion(rig.bone('upper-leg-left')!.quaternion, 'XYZ').x;
    const chestLean = (): number => new THREE.Euler().setFromQuaternion(rig.bone('chest')!.quaternion, 'XYZ').x;
    for (let i = 0; i < 20; i += 1) driver.update(IDLE, 1 / 60);
    expect(rig.bone('chest')!.quaternion.angleTo(identity)).toBe(0);
    let deepestThigh = 0;
    let steepestLean = 0;
    for (let t = 1 / 60; t < VAULT_SECONDS; t += 1 / 60) {
      driver.update(vaultAt(t / VAULT_SECONDS), 1 / 60);
      deepestThigh = Math.min(deepestThigh, thigh());
      steepestLean = Math.max(steepestLean, chestLean());
    }
    expect(deepestThigh).toBeLessThan(-0.9);
    expect(steepestLean).toBeGreaterThan(0.35);
    // Landing: a dip that is over within LANDING_SECONDS plus the exit blend.
    const settle = Math.ceil((LANDING_SECONDS + VAULT_EXIT_SECONDS) * 60) + 2;
    let dipped = false;
    for (let i = 0; i < settle; i += 1) {
      driver.update(IDLE, 1 / 60);
      if (rig.bone('hips')!.position.y < rig.base('hips')!.position[1] - 0.03) dipped = true;
    }
    expect(dipped).toBe(true);
    expect(rig.bone('hips')!.position.y).toBe(rig.base('hips')!.position[1]);
    expect(driver.vaultWeight).toBe(0);
  });
});

describe('the weapon through a vault (T-2.23)', () => {
  it('keeps the aim root valid and the hands on it every frame; the hit root never moves', () => {
    const root = createHumanoidSoldier('local');
    root.position.set(-9, HUMANOID_ROOT_LIFT_M, -2);
    const rig = requireRig(root);
    const driver = createLocomotionPoseDriver(rig);
    const rootBefore = { p: root.position.toArray(), q: root.quaternion.toArray(), s: root.scale.toArray() };
    const chest = rig.bone('chest')!;
    for (const frame of cycle(1 / 60, WALK, WALK)) {
      driver.update(frame, 1 / 60);
      expect(rig.aim.visible).toBe(true);
      expect(rig.aim.parent).toBe(chest);
      const at = worldOf(rig, rig.aim);
      expect(worldOf(rig, rig.bone('hand-right')!).distanceTo(at)).toBeLessThan(0.3);
      expect(worldOf(rig, rig.bone('hand-left')!).distanceTo(at)).toBeLessThan(0.5);
      // The rifle stays roughly at shoulder height above the feet: no pose
      // drags the weapon into the ground or over the head.
      expect(at.y - (root.position.y - HUMANOID_ROOT_LIFT_M)).toBeGreaterThan(1.0);
      expect(at.y - (root.position.y - HUMANOID_ROOT_LIFT_M)).toBeLessThan(1.6);
    }
    expect(root.position.toArray()).toEqual(rootBefore.p);
    expect(root.quaternion.toArray()).toEqual(rootBefore.q);
    expect(root.scale.toArray()).toEqual(rootBefore.s);
  });

  it('reset clears a vault in progress, back to the pose\'s base', () => {
    const rig = requireRig(createHumanoidSoldier('remote'));
    const driver: LocomotionPoseDriver = createLocomotionPoseDriver(rig);
    const rest = snapshot(rig);
    driver.update(vaultAt(0.3), 1 / 30);
    driver.update(vaultAt(0.5), 1 / 30);
    expect(snapshot(rig)).not.toEqual(rest);
    driver.reset();
    expect(snapshot(rig)).toEqual(rest);
    expect(driver.vaultWeight).toBe(0);
  });
});
