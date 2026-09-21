/**
 * T-2.27: the hit reaction as a layer on the rig. The chest turns away from
 * the shooter and tilts along the shot, the head snaps on a head-zone hit,
 * and `react(null)` hands every bone back to the pose driver exactly as it
 * left them. The grey box has no reaction of its own and says so.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HUMANOID_BONES, type HitReaction, type HumanoidRig, requireRig } from './humanoidRig.ts';
import { createHumanoidPlaceholder } from './humanoidPlaceholder.ts';
import { createHumanoidSoldier } from './humanoidSoldier.ts';
import { createLocomotionPoseDriver } from './locomotionPose.ts';
import { hitReactionFrom, shooterDirection } from './hitReaction.ts';
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
const IDLE: LocomotionResult = { ...WALK, state: 'idle', speed: 0, normalizedSpeed: 0 };

function snapshot(rig: HumanoidRig) {
  const out: { name: string; p: number[]; q: number[] }[] = [];
  for (const name of HUMANOID_BONES) {
    const bone = rig.bone(name);
    if (bone) out.push({ name, p: bone.position.toArray(), q: bone.quaternion.toArray() });
  }
  out.push({ name: 'aim', p: rig.aim.position.toArray(), q: rig.aim.quaternion.toArray() });
  return out;
}

/** A bone's yaw in the root's frame, radians, positive to the soldier's left. */
function yawOf(rig: HumanoidRig, name: 'chest' | 'head'): number {
  rig.root.updateMatrixWorld(true);
  const bone = rig.bone(name);
  if (!bone) throw new Error(`no ${name}`);
  const forward = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()))
    .applyQuaternion(rig.root.getWorldQuaternion(new THREE.Quaternion()).invert());
  return Math.atan2(forward.x, forward.z);
}

/** A bone's pitch in the root's frame, radians, positive looking up. */
function pitchOf(rig: HumanoidRig, name: 'chest' | 'head'): number {
  rig.root.updateMatrixWorld(true);
  const bone = rig.bone(name);
  if (!bone) throw new Error(`no ${name}`);
  const forward = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()))
    .applyQuaternion(rig.root.getWorldQuaternion(new THREE.Quaternion()).invert());
  return Math.asin(Math.max(-1, Math.min(1, forward.y)));
}

const HIT = 45;
const fromLeft = (): HitReaction => hitReactionFrom(HIT, 'torso', shooterDirection(5, 0, 0));
const fromRight = (): HitReaction => hitReactionFrom(HIT, 'torso', shooterDirection(-5, 0, 0));

describe('the hit reaction on the skinned soldier (T-2.27)', () => {
  it('turns the chest away from the shooter: one way from the left, the other from the right', () => {
    const rig = requireRig(createHumanoidSoldier('remote'));
    const rest = yawOf(rig, 'chest');

    rig.react(fromLeft());
    const left = yawOf(rig, 'chest');
    rig.react(fromRight());
    const right = yawOf(rig, 'chest');

    // A round from the soldier's left turns them to their right, and back.
    expect(left).toBeLessThan(rest);
    expect(right).toBeGreaterThan(rest);
    expect(left - rest).toBeCloseTo(-(right - rest), 12);
  });

  it('tilts the chest back from a shot in front, and further for more damage', () => {
    const rig = requireRig(createHumanoidSoldier('remote'));
    const rest = pitchOf(rig, 'chest');
    const inFront = shooterDirection(0, 5, 0);

    rig.react(hitReactionFrom(HIT, 'torso', inFront));
    const full = pitchOf(rig, 'chest');
    rig.react(hitReactionFrom(HIT / 4, 'torso', inFront));
    const light = pitchOf(rig, 'chest');

    // Tilting back from a round in the chest is the chest pointing upward.
    expect(full).toBeGreaterThan(rest);
    expect(light).toBeGreaterThan(rest);
    expect(full - rest).toBeGreaterThan(light - rest);
  });

  it('moves the head on a head-zone hit and leaves it alone on a torso hit', () => {
    const rig = requireRig(createHumanoidSoldier('remote'));
    const head = rig.bone('head');
    if (!head) throw new Error('no head');
    const restBits = head.quaternion.toArray();
    const restYaw = yawOf(rig, 'head');

    rig.react(hitReactionFrom(HIT, 'torso', shooterDirection(5, 0, 0)));
    // The chest carries the head with it; the head's OWN rotation is untouched.
    expect(head.quaternion.toArray()).toEqual(restBits);
    const torsoHitYaw = yawOf(rig, 'head');

    rig.react(hitReactionFrom(HIT, 'head', shooterDirection(5, 0, 0)));
    expect(head.quaternion.toArray()).not.toEqual(restBits);
    // The snap goes further than the body under it, the same way.
    const headHitYaw = yawOf(rig, 'head');
    expect(headHitYaw).toBeLessThan(torsoHitYaw);
    expect(torsoHitYaw).toBeLessThan(restYaw);
  });

  it('restores the driver\'s own bits exactly, with and without a frame between', () => {
    const rig = requireRig(createHumanoidSoldier('local'));
    const driver = createLocomotionPoseDriver(rig);
    driver.update(IDLE, 1 / 60);
    rig.hold({ pitch: 0.2, weight: 1 });
    const before = snapshot(rig);

    // Straight there and back, with nothing in between.
    rig.react(fromLeft());
    expect(snapshot(rig)).not.toEqual(before);
    rig.react(null);
    expect(snapshot(rig)).toEqual(before);

    // And with the driver running between, which is the real frame order.
    rig.react(fromRight());
    driver.update(IDLE, 1 / 60);
    rig.hold({ pitch: 0.2, weight: 1 });
    rig.react(null);
    expect(snapshot(rig)).toEqual(before);
  });

  it('never accumulates: twice in a frame is once, and a second hit restarts without drift', () => {
    const rig = requireRig(createHumanoidSoldier('local'));
    const driver = createLocomotionPoseDriver(rig);
    driver.update(IDLE, 1 / 60);
    const rest = snapshot(rig);

    rig.react(fromLeft());
    const once = snapshot(rig);
    rig.react(fromLeft());
    expect(snapshot(rig)).toEqual(once);

    // A second round from the other side is the new reaction, not the sum.
    rig.react(fromRight());
    const answered = snapshot(rig);
    rig.react(null);
    rig.react(fromRight());
    expect(snapshot(rig)).toEqual(answered);
    rig.react(null);
    expect(snapshot(rig)).toEqual(rest);
  });

  it('a walk with the reaction on every frame is the walk once it has recovered', () => {
    const plain = requireRig(createHumanoidSoldier('remote'));
    const hit = requireRig(createHumanoidSoldier('remote'));
    const plainDriver = createLocomotionPoseDriver(plain);
    const hitDriver = createLocomotionPoseDriver(hit);
    const reaction = fromLeft();
    for (let frame = 0; frame < 40; frame += 1) {
      plainDriver.update(WALK, 1 / 60);
      hitDriver.update(WALK, 1 / 60);
      // Fading out as the recovery does, then gone.
      const left = Math.max(0, 1 - frame / 20);
      hit.react(left > 0 ? { turn: reaction.turn * left, lean: reaction.lean * left, head: 0 } : null);
    }
    expect(snapshot(hit)).toEqual(snapshot(plain));
  });

  it('a downed soldier does not react', () => {
    const rig = requireRig(createHumanoidSoldier('remote'));
    rig.setPose('downed');
    const down = snapshot(rig);
    rig.react(hitReactionFrom(HIT, 'head', shooterDirection(5, 0, 0)));
    expect(snapshot(rig)).toEqual(down);
    rig.react(null);
    expect(snapshot(rig)).toEqual(down);
  });

  it('a hit while standing is gone once the soldier goes down', () => {
    const rig = requireRig(createHumanoidSoldier('remote'));
    rig.react(fromLeft());
    rig.setPose('downed');
    const down = snapshot(rig);
    rig.react(null);
    expect(snapshot(rig)).toEqual(down);
  });
});

describe('the grey box has no reaction of its own (T-2.27)', () => {
  it('says so, and nothing moves when it is asked', () => {
    const root = createHumanoidPlaceholder('remote');
    const rig = requireRig(root);
    const before = root.children.map((part) => ({
      name: part.name,
      p: part.position.toArray(),
      q: part.quaternion.toArray(),
    }));

    expect(rig.react(null)).toBe(false);
    expect(rig.react(fromLeft())).toBe(false);

    expect(root.children.map((part) => ({
      name: part.name,
      p: part.position.toArray(),
      q: part.quaternion.toArray(),
    }))).toEqual(before);
    // And it still names the parts a translation flinch jerks back (T-2.11).
    expect(rig.flinchParts.length).toBeGreaterThan(0);
  });

  it('the skinned soldier answers instead, and names no parts to translate', () => {
    const rig = requireRig(createHumanoidSoldier('remote'));
    expect(rig.react(null)).toBe(true);
    expect(rig.flinchParts).toEqual([]);
  });
});
