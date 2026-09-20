import * as THREE from 'three';
import { type HumanoidBoneName, type HumanoidRig, isHumanoidRig, requireRig } from './humanoidRig.ts';
import type { LocomotionResult, LocomotionState } from './locomotionState.ts';

/**
 * The gait (T-2.18, routed through the rig contract in T-2.22).
 *
 * One piece of arithmetic for every rig. The classifier's result and the
 * frame's dt advance a phase; the phase and the movement direction become
 * joint rotations, applied on top of whatever the rig's current pose puts
 * each bone at (`rig.base`). The rig's `style` says how much of each layer
 * it can carry: the grey box swings whole limbs and has nothing else, the
 * skinned soldier bends knees, bobs, twists and leans, and keeps its arms
 * on the rifle. No bone is assumed: a rig without a joint skips that joint.
 *
 * Idle restores every animated bone to its base exactly, so an idle crouch
 * is precisely the crouch and an idle stand is precisely the factory rest.
 */
const TWO_PI = Math.PI * 2;
const WALK_CYCLE_HZ = 1.9;
const SPRINT_CYCLE_HZ = 2.5;
const WALK_LEG_SWING = 0.42;
const SPRINT_LEG_SWING = 0.58;
const WALK_ARM_SWING = 0.28;
const SPRINT_ARM_SWING = 0.38;
const LATERAL_SWING_SCALE = 0.55;
/** Peak knee bend through the swing phase, radians, at full walk. */
const WALK_KNEE_BEND = 0.85;
const SPRINT_KNEE_BEND = 1.15;
/** Hips drop this far at mid-stride, twice a cycle. */
const WALK_BOB_M = 0.03;
const SPRINT_BOB_M = 0.05;
/** The chest counter-twists against the hips by this much, radians. */
const TWIST = 0.12;
/** Forward lean at full speed, radians. */
const WALK_LEAN = 0.05;
const SPRINT_LEAN = 0.2;

/** Bones the gait writes. Rotation only, except the hips, which also bob. */
const ROTATED: readonly HumanoidBoneName[] = [
  'upper-leg-left',
  'lower-leg-left',
  'foot-left',
  'upper-leg-right',
  'lower-leg-right',
  'foot-right',
  'upper-arm-left',
  'upper-arm-right',
  'chest',
];

const scratchEuler = new THREE.Euler(0, 0, 0, 'XYZ');
const scratchQuaternion = new THREE.Quaternion();

export interface LocomotionPoseDriver {
  readonly phase: number;
  update(result: LocomotionResult, dtSeconds: number): void;
  reset(): void;
}

/**
 * Drive a soldier's gait. Takes the rig, or the root a factory registered a
 * rig on (both factories do).
 */
export function createLocomotionPoseDriver(target: THREE.Object3D | HumanoidRig): LocomotionPoseDriver {
  const rig = isHumanoidRig(target) ? target : requireRig(target);
  if (!rig.bone('upper-leg-left') || !rig.bone('upper-leg-right')) {
    throw new Error('Humanoid gait requires upper-leg bones');
  }
  let phase = 0;

  function rotate(name: HumanoidBoneName, x: number, y: number, z: number): void {
    const bone = rig.bone(name);
    const base = rig.base(name);
    if (!bone || !base) return;
    scratchQuaternion.setFromEuler(scratchEuler.set(x, y, z));
    bone.quaternion.fromArray(base.quaternion).multiply(scratchQuaternion);
  }

  function restore(): void {
    for (const name of ROTATED) {
      const bone = rig.bone(name);
      const base = rig.base(name);
      if (bone && base) bone.quaternion.fromArray(base.quaternion);
    }
    const hips = rig.bone('hips');
    const hipsBase = rig.base('hips');
    if (hips && hipsBase) hips.position.fromArray(hipsBase.position);
  }

  function update(result: LocomotionResult, dtSeconds: number): void {
    if (result.state === 'idle') {
      phase = 0;
      restore();
      return;
    }
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;

    const speed = Math.max(0, Math.min(1, result.normalizedSpeed));
    const state: LocomotionState = result.state;
    const sprint = state === 'sprint';
    const cycleHz = sprint ? SPRINT_CYCLE_HZ : WALK_CYCLE_HZ;
    phase = (phase + dtSeconds * TWO_PI * cycleHz * speed) % TWO_PI;

    const forward = Math.cos(result.directionAngle);
    const right = Math.sin(result.directionAngle);
    const gaitScale =
      sprint ? 1 :
      state === 'crouch-walk' ? 0.55 :
      state === 'crawl' ? 0.35 :
      1;
    const { style } = rig;

    const legSwing = (sprint ? SPRINT_LEG_SWING : WALK_LEG_SWING) * speed * gaitScale;
    const armSwing = (sprint ? SPRINT_ARM_SWING : WALK_ARM_SWING) * speed * gaitScale * style.armSwing;
    const stride = Math.sin(phase);
    const counterStride = -stride;
    const lateral = Math.cos(phase) * right * LATERAL_SWING_SCALE;
    const bodySway = lateral * 0.08;

    // Knees bend through the swing, when the leg travels from back to front.
    // The left leg is forward when its stride is negative, so it swings while
    // the cosine is negative; the right leg is half a cycle behind.
    const kneeReach = Math.abs(forward) + 0.5 * Math.abs(right);
    const kneeBend = (sprint ? SPRINT_KNEE_BEND : WALK_KNEE_BEND) * speed * gaitScale * style.kneeBend * kneeReach;
    const kneeLeft = kneeBend * Math.max(0, -Math.cos(phase));
    const kneeRight = kneeBend * Math.max(0, Math.cos(phase));

    rotate('upper-leg-left', stride * legSwing * forward, 0, counterStride * legSwing * right);
    rotate('upper-leg-right', counterStride * legSwing * forward, 0, stride * legSwing * right);
    rotate('lower-leg-left', kneeLeft, 0, 0);
    rotate('lower-leg-right', kneeRight, 0, 0);
    rotate('foot-left', -0.5 * kneeLeft, 0, 0);
    rotate('foot-right', -0.5 * kneeRight, 0, 0);
    rotate('upper-arm-left', counterStride * armSwing * forward, 0, stride * armSwing * right + bodySway);
    rotate('upper-arm-right', stride * armSwing * forward, 0, counterStride * armSwing * right + bodySway);

    const twist = TWIST * style.twist * stride * forward * speed;
    const lean = (sprint ? SPRINT_LEAN : WALK_LEAN) * style.lean * speed * forward;
    rotate('chest', lean, twist, 0);

    const hips = rig.bone('hips');
    const hipsBase = rig.base('hips');
    if (hips && hipsBase) {
      const bob = (sprint ? SPRINT_BOB_M : WALK_BOB_M) * style.bob * speed * (1 - Math.cos(2 * phase)) * 0.5;
      hips.position.set(hipsBase.position[0], hipsBase.position[1] - bob, hipsBase.position[2]);
    }
  }

  return {
    get phase() { return phase; },
    update,
    reset() { phase = 0; restore(); },
  };
}
