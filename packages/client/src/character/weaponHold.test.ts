/**
 * T-2.26: the fire and reload layers on the rig, through `hold`. A kick
 * moves the rifle and the hands follow; a reload sends the left hand to the
 * magazine well and back; with nothing to show, the hold is the aim's own
 * bits.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HUMANOID_BONES, type HumanoidRig, requireRig } from './humanoidRig.ts';
import { HUMANOID_ROOT_LIFT_M, createHumanoidPlaceholder } from './humanoidPlaceholder.ts';
import { AIM_IN_CHEST, createHumanoidSoldier } from './humanoidSoldier.ts';
import { createLocomotionPoseDriver } from './locomotionPose.ts';
import type { LocomotionResult } from './locomotionState.ts';

const DEG = Math.PI / 180;
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

/** The rifle's pitch in the root's frame, positive up. */
function riflePitch(rig: HumanoidRig): number {
  rig.root.updateMatrixWorld(true);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(rig.aim.getWorldQuaternion(new THREE.Quaternion()));
  forward.applyQuaternion(rig.root.getWorldQuaternion(new THREE.Quaternion()).invert());
  return Math.asin(Math.max(-1, Math.min(1, forward.y)));
}

describe('the fire layer on the skinned soldier (T-2.26)', () => {
  it('a kick drives the rifle back and up with the hands on it; nothing is the aim\'s own bits', () => {
    const rig = requireRig(createHumanoidSoldier('local'));
    rig.aimAt(10 * DEG, 1);
    const aimed = snapshot(rig);
    const rifleBefore = worldOf(rig, rig.aim);
    const pitchBefore = riflePitch(rig);

    rig.hold({ pitch: 10 * DEG, weight: 1, kickBack: 0.03, kickUp: 0.08 });
    const rifleAfter = worldOf(rig, rig.aim);
    // Up by the kick (the spine takes a share and the rifle the rest, so the
    // total is the whole kick), and back along the rifle: nearer the body.
    expect(riflePitch(rig) - pitchBefore).toBeCloseTo(0.08, 3);
    expect(rifleAfter.z).toBeLessThan(rifleBefore.z);
    // At least the kick's travel; a little more, since the spine leans too.
    expect(rifleBefore.distanceTo(rifleAfter)).toBeGreaterThan(0.025);
    expect(rifleBefore.distanceTo(rifleAfter)).toBeLessThan(0.07);
    // The hands went with it.
    expect(worldOf(rig, rig.bone('hand-right')!).distanceTo(rifleAfter)).toBeLessThan(0.3);
    expect(worldOf(rig, rig.bone('hand-left')!).distanceTo(rifleAfter)).toBeLessThan(0.55);

    // Explicit zeros are the aim's own bits, as is leaving them out.
    rig.hold({ pitch: 10 * DEG, weight: 1, kickBack: 0, kickUp: 0, reload: 0 });
    expect(snapshot(rig)).toEqual(aimed);
    rig.hold({ pitch: 10 * DEG, weight: 1 });
    expect(snapshot(rig)).toEqual(aimed);
  });

  it('is off with the weight, kick and all, and the attachment is back in place', () => {
    const rig = requireRig(createHumanoidSoldier('remote'));
    const rest = snapshot(rig);
    rig.hold({ pitch: 20 * DEG, weight: 1, kickBack: 0.05, kickUp: 0.1, reload: 0.5 });
    expect(snapshot(rig)).not.toEqual(rest);
    rig.hold({ pitch: 20 * DEG, weight: 0, kickBack: 0.05, kickUp: 0.1, reload: 0.5 });
    expect(snapshot(rig)).toEqual(rest);
    expect(rig.aim.position.toArray()).toEqual(AIM_IN_CHEST);
  });
});

describe('the reload layer on the skinned soldier (T-2.26)', () => {
  it('sends the left hand to the magazine well and back, the right hand staying on the grip', () => {
    const rig = requireRig(createHumanoidSoldier('local'));
    rig.aimAt(0, 1);
    const leftAtGrip = worldOf(rig, rig.bone('hand-left')!);
    const rightAtGrip = worldOf(rig, rig.bone('hand-right')!);
    const rifleLevel = riflePitch(rig);

    rig.hold({ pitch: 0, weight: 1, reload: 0.5 });
    const leftMid = worldOf(rig, rig.bone('hand-left')!);
    const rightMid = worldOf(rig, rig.bone('hand-right')!);
    // The left hand has left the foregrip and gone under the rifle.
    expect(leftMid.distanceTo(leftAtGrip)).toBeGreaterThan(0.12);
    expect(leftMid.y).toBeLessThan(leftAtGrip.y);
    // The right hand is where it was, up to the dip the rifle takes.
    expect(rightMid.distanceTo(rightAtGrip)).toBeLessThan(0.1);
    // The muzzle dips while the magazine is out.
    expect(riflePitch(rig)).toBeLessThan(rifleLevel - 0.2);

    // A curve of the progress: continuous, and bit-exact at both ends.
    rig.hold({ pitch: 0, weight: 1, reload: 0 });
    const fresh = requireRig(createHumanoidSoldier('local'));
    fresh.aimAt(0, 1);
    expect(snapshot(rig)).toEqual(snapshot(fresh));
    let previous = worldOf(rig, rig.bone('hand-left')!);
    for (let p = 0.02; p <= 1.0001; p += 0.02) {
      rig.hold({ pitch: 0, weight: 1, reload: Math.min(1, p) });
      const now = worldOf(rig, rig.bone('hand-left')!);
      // Two percent of a reload is forty milliseconds of a two-second one.
      expect(now.distanceTo(previous)).toBeLessThan(0.05);
      previous = now;
    }
    rig.hold({ pitch: 0, weight: 1, reload: 1 });
    expect(worldOf(rig, rig.bone('hand-left')!).distanceTo(leftAtGrip)).toBeLessThan(1e-9);
    rig.hold({ pitch: 0, weight: 1, reload: 0 });
    expect(worldOf(rig, rig.bone('hand-left')!).toArray()).toEqual(leftAtGrip.toArray());
  });

  it('is the same pose for the same progress on any soldier, under any aim, and never moves the root', () => {
    const a = createHumanoidSoldier('local');
    const b = createHumanoidSoldier('remote');
    a.position.set(-2, HUMANOID_ROOT_LIFT_M, 4);
    const before = { p: a.position.toArray(), q: a.quaternion.toArray() };
    for (const pitch of [-40 * DEG, 0, 40 * DEG]) {
      for (const reload of [0, 0.25, 0.5, 0.8, 1]) {
        requireRig(a).hold({ pitch, weight: 1, reload, kickUp: 0.02, kickBack: 0.01 });
        requireRig(b).hold({ pitch, weight: 1, reload, kickUp: 0.02, kickBack: 0.01 });
        expect(snapshot(requireRig(a))).toEqual(snapshot(requireRig(b)));
      }
    }
    expect(a.position.toArray()).toEqual(before.p);
    expect(a.quaternion.toArray()).toEqual(before.q);
  });

  it('never accumulates through a walk, kicked and reloading every frame', () => {
    const a = requireRig(createHumanoidSoldier('local'));
    const b = requireRig(createHumanoidSoldier('local'));
    const da = createLocomotionPoseDriver(a);
    const db = createLocomotionPoseDriver(b);
    for (let i = 0; i < 60; i += 1) {
      da.update(WALK, 1 / 60);
      a.hold({ pitch: 15 * DEG, weight: 1, kickUp: 0.05, kickBack: 0.02, reload: (i % 30) / 30 });
      db.update(WALK, 1 / 60);
    }
    da.update(WALK, 1 / 60);
    a.hold({ pitch: 0, weight: 1 });
    db.update(WALK, 1 / 60);
    expect(snapshot(a)).toEqual(snapshot(b));
  });
});

describe('the fire and reload layers on the grey box (T-2.26)', () => {
  it('turns only the rifle: up for a kick, down for a reload, and restores exactly', () => {
    const rig = requireRig(createHumanoidPlaceholder('local'));
    const rest = snapshot(rig);
    const level = riflePitch(rig);
    rig.hold({ pitch: 0, weight: 1, kickUp: 0.1 });
    expect(riflePitch(rig)).toBeGreaterThan(level + 0.09);
    rig.hold({ pitch: 0, weight: 1, reload: 0.5 });
    expect(riflePitch(rig)).toBeLessThan(level - 0.2);
    rig.hold({ pitch: 0, weight: 1, reload: 1, kickUp: 0, kickBack: 0 });
    expect(snapshot(rig)).toEqual(rest);
    // Through all of that, no part but the rifle ever turned.
    const partsNow = rig.root.children.filter((c) => c.name !== 'rifle').map((c) => c.quaternion.toArray());
    const partsRest = createHumanoidPlaceholder('local').children.filter((c) => c.name !== 'rifle').map((c) => c.quaternion.toArray());
    expect(partsNow).toEqual(partsRest);
  });
});
