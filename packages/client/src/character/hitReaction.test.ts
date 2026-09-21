/**
 * T-2.27: the hit reaction as a layer on the rig. The chest turns away from
 * where the round came from, the head snaps only on a head-zone hit, the
 * size is the strength, and none of it leaves a trace: withdrawn, downed,
 * or applied twice, the bones are the driver's own bits.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HUMANOID_BONES, type HitReaction, type HumanoidRig, requireRig } from './humanoidRig.ts';
import { HUMANOID_ROOT_LIFT_M, createHumanoidPlaceholder } from './humanoidPlaceholder.ts';
import { HIT_HEAD_RAD, HIT_LEAN_RAD, HIT_TWIST_RAD, createHumanoidSoldier } from './humanoidSoldier.ts';
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
const FROM_LEFT: HitReaction = { fromX: 1, fromZ: 0, head: false, strength: 1 };
const FROM_RIGHT: HitReaction = { fromX: -1, fromZ: 0, head: false, strength: 1 };
const FROM_FRONT: HitReaction = { fromX: 0, fromZ: 1, head: false, strength: 1 };

function snapshot(rig: HumanoidRig) {
  const out: { name: string; p: number[]; q: number[] }[] = [];
  for (const name of HUMANOID_BONES) {
    const bone = rig.bone(name);
    if (bone) out.push({ name, p: bone.position.toArray(), q: bone.quaternion.toArray() });
  }
  out.push({ name: 'aim', p: rig.aim.position.toArray(), q: rig.aim.quaternion.toArray() });
  return out;
}

/** A bone's local turn as yaw (about Y) and pitch (about X), relative to its rest. */
function turnOf(rig: HumanoidRig, name: 'chest' | 'neck'): { yaw: number; pitch: number } {
  const rest = new THREE.Quaternion().fromArray(requireRig(createHumanoidSoldier('local')).bone(name)!.quaternion.toArray());
  const local = rest.invert().multiply(rig.bone(name)!.quaternion);
  const e = new THREE.Euler().setFromQuaternion(local, 'YXZ');
  return { yaw: e.y, pitch: e.x };
}

function soldier(): HumanoidRig {
  return requireRig(createHumanoidSoldier('local'));
}

describe('the hit reaction on the skinned soldier (T-2.27)', () => {
  it('turns the chest away from the round: one way from the left, the other from the right', () => {
    const rig = soldier();
    rig.react!(FROM_LEFT);
    const left = turnOf(rig, 'chest');
    rig.react!(FROM_RIGHT);
    const right = turnOf(rig, 'chest');
    // A round from the left (+X) carries the left shoulder back: a positive turn about Y.
    expect(left.yaw).toBeCloseTo(HIT_TWIST_RAD, 6);
    expect(right.yaw).toBeCloseTo(-HIT_TWIST_RAD, 6);
    expect(Math.abs(left.pitch)).toBeLessThan(1e-9);
    // From the front, the chest is tipped back and not twisted.
    rig.react!(FROM_FRONT);
    const front = turnOf(rig, 'chest');
    expect(front.pitch).toBeCloseTo(-HIT_LEAN_RAD, 6);
    expect(Math.abs(front.yaw)).toBeLessThan(1e-9);
  });

  it('snaps the head on a head-zone hit and leaves the neck alone on a torso hit', () => {
    const rig = soldier();
    const neckRest = rig.bone('neck')!.quaternion.toArray();
    rig.react!(FROM_LEFT);
    expect(rig.bone('neck')!.quaternion.toArray()).toEqual(neckRest);
    rig.react!({ ...FROM_LEFT, head: true });
    expect(turnOf(rig, 'neck').yaw).toBeCloseTo(HIT_HEAD_RAD, 6);
    // The chest turned the same way: the head snap is on top of it.
    expect(turnOf(rig, 'chest').yaw).toBeCloseTo(HIT_TWIST_RAD, 6);
  });

  it('scales with the strength', () => {
    const rig = soldier();
    rig.react!({ ...FROM_LEFT, strength: 0.5 });
    expect(turnOf(rig, 'chest').yaw).toBeCloseTo(HIT_TWIST_RAD / 2, 6);
    rig.react!({ ...FROM_LEFT, head: true, strength: 0.25 });
    expect(turnOf(rig, 'chest').yaw).toBeCloseTo(HIT_TWIST_RAD / 4, 6);
    expect(turnOf(rig, 'neck').yaw).toBeCloseTo(HIT_HEAD_RAD / 4, 6);
    // Out of range is clamped; nothing is a strength of zero.
    rig.react!({ ...FROM_LEFT, strength: 4 });
    expect(turnOf(rig, 'chest').yaw).toBeCloseTo(HIT_TWIST_RAD, 6);
  });

  it('withdrawn, it is bit-exact: null, strength 0, under any aim', () => {
    const rig = soldier();
    const fresh = soldier();
    for (const pitch of [0, 25 * DEG, -40 * DEG]) {
      rig.hold({ pitch, weight: 1, kickUp: 0.03, reload: 0.4 });
      fresh.hold({ pitch, weight: 1, kickUp: 0.03, reload: 0.4 });
      rig.react!({ ...FROM_LEFT, head: true });
      expect(snapshot(rig)).not.toEqual(snapshot(fresh));
      rig.react!(null);
      expect(snapshot(rig)).toEqual(snapshot(fresh));
      rig.react!({ ...FROM_RIGHT, head: true });
      rig.react!({ ...FROM_RIGHT, strength: 0 });
      expect(snapshot(rig)).toEqual(snapshot(fresh));
    }
  });

  it('is a layer in the same pass as the hold: any order, and twice is once', () => {
    const a = soldier();
    const b = soldier();
    const hold = { pitch: 20 * DEG, weight: 1, kickUp: 0.05 };
    a.react!({ ...FROM_LEFT, head: true });
    a.hold(hold);
    b.hold(hold);
    b.react!({ ...FROM_LEFT, head: true });
    expect(snapshot(a)).toEqual(snapshot(b));
    a.react!({ ...FROM_LEFT, head: true });
    a.react!({ ...FROM_LEFT, head: true });
    a.hold(hold);
    a.hold(hold);
    expect(snapshot(a)).toEqual(snapshot(b));
    // Still the hit's turn, not three of them.
    expect(turnOf(a, 'chest').yaw).toBeCloseTo(HIT_TWIST_RAD, 6);
  });

  it('shows nothing on a downed soldier, and a soldier going down drops the hit it had', () => {
    const rig = soldier();
    const plain = soldier();
    rig.setPose('downed');
    plain.setPose('downed');
    rig.react!({ ...FROM_LEFT, head: true });
    expect(snapshot(rig)).toEqual(snapshot(plain));
    rig.setPose('standing');
    plain.setPose('standing');
    rig.react!({ ...FROM_LEFT, head: true });
    rig.setPose('downed');
    plain.setPose('downed');
    rig.aimAt(0, 0);
    plain.aimAt(0, 0);
    expect(snapshot(rig)).toEqual(snapshot(plain));
    rig.setPose('standing');
    plain.setPose('standing');
    rig.hold({ pitch: 0, weight: 1 });
    plain.hold({ pitch: 0, weight: 1 });
    expect(snapshot(rig)).toEqual(snapshot(plain));
  });

  it('rides a walk without accumulating, and never moves the root', () => {
    const a = soldier();
    const b = soldier();
    const da = createLocomotionPoseDriver(a);
    const db = createLocomotionPoseDriver(b);
    a.root.position.set(3, HUMANOID_ROOT_LIFT_M, -2);
    const before = { p: a.root.position.toArray(), q: a.root.quaternion.toArray() };
    for (let i = 0; i < 90; i += 1) {
      da.update(WALK, 1 / 60);
      a.hold({ pitch: 10 * DEG, weight: 1 });
      a.react!({ ...FROM_LEFT, head: i % 2 === 0, strength: 1 - i / 90 });
      db.update(WALK, 1 / 60);
      b.hold({ pitch: 10 * DEG, weight: 1 });
    }
    // A frame with no time in it: the driver writes nothing, the layers must not stack.
    da.update(WALK, 0);
    a.hold({ pitch: 10 * DEG, weight: 1 });
    a.react!(FROM_LEFT);
    a.react!(null);
    db.update(WALK, 0);
    b.hold({ pitch: 10 * DEG, weight: 1 });
    expect(snapshot(a)).toEqual(snapshot(b));
    expect(a.root.position.toArray()).toEqual(before.p);
    expect(a.root.quaternion.toArray()).toEqual(before.q);
  });
});

describe('the grey box has no reaction of its own (T-2.27)', () => {
  it('offers no react, so the entry point keeps the translation flinch for it', () => {
    const rig = requireRig(createHumanoidPlaceholder('local'));
    expect(rig.react).toBeUndefined();
  });
});
