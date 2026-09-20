/**
 * T-2.25: the aim layer. The rifle points where the soldier looks, the hands
 * stay on it, and the layer leaves no trace when it is off or level.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HUMANOID_BONES, type HumanoidRig, requireRig } from './humanoidRig.ts';
import { HUMANOID_ROOT_LIFT_M, createHumanoidPlaceholder } from './humanoidPlaceholder.ts';
import { createHumanoidSoldier } from './humanoidSoldier.ts';
import { createLocomotionPoseDriver } from './locomotionPose.ts';
import type { LocomotionResult } from './locomotionState.ts';

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

const DEG = Math.PI / 180;
/** The camera's own range (T-1.11 limits): 89 degrees either way. */
const PITCHES = [-89, -60, -30, -10, 0, 10, 30, 60, 89].map((d) => d * DEG);

function snapshot(rig: HumanoidRig) {
  const out: { name: string; p: number[]; q: number[] }[] = [];
  for (const name of HUMANOID_BONES) {
    const bone = rig.bone(name);
    if (bone) out.push({ name, p: bone.position.toArray(), q: bone.quaternion.toArray() });
  }
  out.push({ name: 'aim', p: rig.aim.position.toArray(), q: rig.aim.quaternion.toArray() });
  return out;
}

function worldOf(rig: HumanoidRig, node: THREE.Object3D): THREE.Vector3 {
  rig.root.updateMatrixWorld(true);
  return new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
}

/** The pitch the aim attachment points at, radians, positive up, in the root's frame. */
function aimPitchOf(rig: HumanoidRig): number {
  rig.root.updateMatrixWorld(true);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(rig.aim.getWorldQuaternion(new THREE.Quaternion()));
  const rootInverse = rig.root.getWorldQuaternion(new THREE.Quaternion()).invert();
  forward.applyQuaternion(rootInverse);
  return Math.asin(Math.max(-1, Math.min(1, forward.y)));
}

describe('aim layer on the skinned soldier (T-2.25)', () => {
  it('points the rifle along the aim across the whole range, hands on it', () => {
    const root = createHumanoidSoldier('local');
    root.position.set(2, HUMANOID_ROOT_LIFT_M, -3);
    root.rotation.y = 0.9;
    const rig = requireRig(root);
    const gripRight = rig.aim.children[0]!;
    for (const pitch of PITCHES) {
      rig.aimAt(pitch, 1);
      expect(Math.abs(aimPitchOf(rig) - pitch)).toBeLessThan(1.5 * DEG);
      // The right hand holds the grip behind; the left the foregrip ahead.
      const at = worldOf(rig, rig.aim);
      const right = worldOf(rig, rig.bone('hand-right')!);
      const left = worldOf(rig, rig.bone('hand-left')!);
      expect(right.distanceTo(at)).toBeLessThan(0.3);
      expect(left.distanceTo(at)).toBeLessThan(0.55);
      expect(gripRight.name).toBe('rifle');
      // The head looks along the aim: up for up, down for down.
      const neckX = new THREE.Euler().setFromQuaternion(rig.bone('neck')!.quaternion, 'XYZ').x;
      if (pitch > 0.2) expect(neckX).toBeLessThan(0);
      if (pitch < -0.2) expect(neckX).toBeGreaterThan(0);
      // The spine leans, but only so far.
      const spineX = new THREE.Euler().setFromQuaternion(rig.bone('spine')!.quaternion, 'XYZ').x;
      expect(Math.abs(spineX)).toBeLessThanOrEqual(0.35 + 1e-9);
    }
  });

  it('leaves no trace: level or off is bit-identical to the pose, standing and crouched', () => {
    for (const pose of ['standing', 'crouched'] as const) {
      const rig = requireRig(createHumanoidSoldier('remote'));
      rig.setPose(pose);
      const rest = snapshot(rig);
      rig.aimAt(60 * DEG, 1);
      expect(snapshot(rig)).not.toEqual(rest);
      rig.aimAt(0, 1);
      expect(snapshot(rig)).toEqual(rest);
      rig.aimAt(-45 * DEG, 1);
      rig.aimAt(-45 * DEG, 0);
      expect(snapshot(rig)).toEqual(rest);
    }
  });

  it('is off while downed: the arms keep the downed pose, the rifle stays level', () => {
    const rig = requireRig(createHumanoidSoldier('local'));
    rig.aimAt(40 * DEG, 1);
    rig.setPose('downed');
    const downed = snapshot(rig);
    rig.aimAt(40 * DEG, 0);
    expect(snapshot(rig)).toEqual(downed);
    expect(rig.aim.quaternion.toArray()).toEqual([0, 0, 0, 1]);
  });

  it('fades with the weight, continuously', () => {
    const rig = requireRig(createHumanoidSoldier('local'));
    let previous = 0;
    for (let w = 0; w <= 1.0001; w += 0.1) {
      rig.aimAt(50 * DEG, w);
      const p = aimPitchOf(rig);
      expect(p).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = p;
    }
    expect(previous).toBeCloseTo(50 * DEG, 2);
  });

  it('never accumulates: a walk with the layer every frame equals a walk without it', () => {
    const a = requireRig(createHumanoidSoldier('local'));
    const b = requireRig(createHumanoidSoldier('local'));
    const da = createLocomotionPoseDriver(a);
    const db = createLocomotionPoseDriver(b);
    for (let i = 0; i < 90; i += 1) {
      da.update(WALK, 1 / 60);
      a.aimAt(35 * DEG, 1);
      // Applying twice in a frame is applying once.
      if (i % 7 === 0) a.aimAt(35 * DEG, 1);
      db.update(WALK, 1 / 60);
    }
    // Back to level: the two walks are the same walk.
    da.update(WALK, 1 / 60);
    a.aimAt(0, 1);
    db.update(WALK, 1 / 60);
    expect(snapshot(a)).toEqual(snapshot(b));
    // And a frame the driver skips (no time) does not stack the aim.
    a.aimAt(35 * DEG, 1);
    const once = aimPitchOf(a);
    da.update(WALK, 0);
    a.aimAt(35 * DEG, 1);
    expect(aimPitchOf(a)).toBeCloseTo(once, 12);
    // Idle afterwards restores the exact rest.
    da.update(IDLE, 1 / 60);
    a.aimAt(0, 1);
    db.update(IDLE, 1 / 60);
    expect(snapshot(a)).toEqual(snapshot(b));
    expect(snapshot(a)).toEqual(snapshot(requireRig(createHumanoidSoldier('local'))));
  });

  it('is the same pose for the same pitch on any soldier, and never moves the root', () => {
    const local = createHumanoidSoldier('local');
    const remote = createHumanoidSoldier('remote');
    local.position.set(1, HUMANOID_ROOT_LIFT_M, 1);
    const before = { p: local.position.toArray(), q: local.quaternion.toArray() };
    for (const pitch of PITCHES) {
      requireRig(local).aimAt(pitch, 1);
      requireRig(remote).aimAt(pitch, 1);
      expect(snapshot(requireRig(local))).toEqual(snapshot(requireRig(remote)));
    }
    expect(local.position.toArray()).toEqual(before.p);
    expect(local.quaternion.toArray()).toEqual(before.q);
  });
});

describe('aim layer on the grey box (T-2.25)', () => {
  it('turns only the rifle, and restores it exactly', () => {
    const rig = requireRig(createHumanoidPlaceholder('local'));
    const rest = snapshot(rig);
    const partsBefore = rig.root.children.filter((c) => c.name !== 'rifle').map((c) => c.quaternion.toArray());
    rig.aimAt(30 * DEG, 1);
    expect(Math.abs(aimPitchOf(rig) - 30 * DEG)).toBeLessThan(1e-6);
    expect(rig.root.children.filter((c) => c.name !== 'rifle').map((c) => c.quaternion.toArray())).toEqual(partsBefore);
    rig.aimAt(30 * DEG, 1);
    expect(Math.abs(aimPitchOf(rig) - 30 * DEG)).toBeLessThan(1e-6);
    rig.aimAt(0, 1);
    expect(snapshot(rig)).toEqual(rest);
    rig.aimAt(30 * DEG, 0);
    expect(snapshot(rig)).toEqual(rest);
  });
});
