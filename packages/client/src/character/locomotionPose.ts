import * as THREE from 'three';
import type { LocomotionResult, LocomotionState } from './locomotionState.ts';

const TWO_PI = Math.PI * 2;
const WALK_CYCLE_HZ = 1.9;
const SPRINT_CYCLE_HZ = 2.5;
const WALK_LEG_SWING = 0.42;
const SPRINT_LEG_SWING = 0.58;
const WALK_ARM_SWING = 0.28;
const SPRINT_ARM_SWING = 0.38;
const LATERAL_SWING_SCALE = 0.55;

interface RestTransform {
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

interface LimbSet {
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
  leftArm: THREE.Object3D;
  rightArm: THREE.Object3D;
}

function restOf(part: THREE.Object3D): RestTransform {
  let rest = part.userData['locomotionRest'] as RestTransform | undefined;
  if (!rest) {
    rest = {
      position: part.position.toArray() as [number, number, number],
      quaternion: part.quaternion.toArray() as [number, number, number, number],
    };
    part.userData['locomotionRest'] = rest;
  }
  return rest;
}

function findPart(root: THREE.Object3D, name: string): THREE.Object3D {
  const part = root.getObjectByName(name);
  if (!part) throw new Error('Humanoid gait requires "' + name + '"');
  return part;
}

function applyRotation(part: THREE.Object3D, x: number, z: number): void {
  const rest = restOf(part);
  const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, 0, z, 'XYZ'));
  part.quaternion.fromArray(rest.quaternion).multiply(delta);
}

export interface LocomotionPoseDriver {
  readonly phase: number;
  update(result: LocomotionResult, dtSeconds: number): void;
  reset(): void;
}

export function createLocomotionPoseDriver(root: THREE.Object3D): LocomotionPoseDriver {
  const limbs: LimbSet = {
    leftLeg: findPart(root, 'leg-left'),
    rightLeg: findPart(root, 'leg-right'),
    leftArm: findPart(root, 'arm-left'),
    rightArm: findPart(root, 'arm-right'),
  };

  let phase = 0;

  function restore(): void {
    for (const part of Object.values(limbs)) {
      const rest = restOf(part);
      part.position.fromArray(rest.position);
      part.quaternion.fromArray(rest.quaternion);
    }
  }

  function update(result: LocomotionResult, dtSeconds: number): void {
    if (result.state === 'idle' || !Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      if (result.state === 'idle') {
        phase = 0;
        restore();
      }
      return;
    }

    const speed = Math.max(0, Math.min(1, result.normalizedSpeed));
    const state: LocomotionState = result.state;
    const cycleHz = state === 'sprint' ? SPRINT_CYCLE_HZ : WALK_CYCLE_HZ;
    phase = (phase + dtSeconds * TWO_PI * cycleHz * speed) % TWO_PI;

    const forward = Math.cos(result.directionAngle);
    const right = Math.sin(result.directionAngle);
    const gaitScale =
      state === 'sprint' ? 1 :
      state === 'crouch-walk' ? 0.55 :
      state === 'crawl' ? 0.35 :
      1;

    const legSwing = (state === 'sprint' ? SPRINT_LEG_SWING : WALK_LEG_SWING) * speed * gaitScale;
    const armSwing = (state === 'sprint' ? SPRINT_ARM_SWING : WALK_ARM_SWING) * speed * gaitScale;
    const stride = Math.sin(phase);
    const counterStride = -stride;
    const lateral = Math.cos(phase) * right * LATERAL_SWING_SCALE;

    applyRotation(limbs.leftLeg, stride * legSwing * forward, counterStride * legSwing * right);
    applyRotation(limbs.rightLeg, counterStride * legSwing * forward, stride * legSwing * right);
    applyRotation(limbs.leftArm, counterStride * armSwing * forward, stride * armSwing * right);
    applyRotation(limbs.rightArm, stride * armSwing * forward, counterStride * armSwing * right);

    const bodySway = lateral * 0.08;
    applyRotation(limbs.leftArm, counterStride * armSwing * forward, stride * armSwing * right + bodySway);
    applyRotation(limbs.rightArm, stride * armSwing * forward, counterStride * armSwing * right + bodySway);
  }

  return {
    get phase() { return phase; },
    update,
    reset() { phase = 0; restore(); },
  };
}
