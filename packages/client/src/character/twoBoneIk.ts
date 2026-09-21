import * as THREE from 'three';

/**
 * Two-bone IK, in one place (T-2.22's arms, T-2.28's legs).
 *
 * Point a two-segment limb from `rootJoint` so that its tip reaches `target`,
 * with the middle joint on the side of `hint`. The law of cosines gives the
 * angle at the root; the hint's component perpendicular to the root-target
 * line gives the plane to bend in. Both bones rest along `rest` in their
 * parent's frame, so the returned quaternions are their LOCAL rotations —
 * valid for a rig whose bind pose is the identity, which is what the rig
 * contract's bones are.
 *
 * Out of reach is not an error: the limb stretches to just under straight.
 * `REACH_MARGIN` is what "just under" means — it keeps the triangle the law of
 * cosines is solving from degenerating, and it is what a planted leg standing
 * straight is short by, so it is a tenth of a millimetre rather than the
 * millimetre that would show as a bent knee. Nothing here allocates when
 * handed an `out`.
 */
export const REACH_MARGIN = 1e-4;
export interface TwoBoneSolution {
  upper: THREE.Quaternion;
  lower: THREE.Quaternion;
}

/** The direction a humanoid's limb bones hang in the bind pose. */
export const LIMB_REST = new THREE.Vector3(0, -1, 0);

const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const scratchC = new THREE.Vector3();
const scratchElbow = new THREE.Vector3();
const scratchDir = new THREE.Vector3();
const scratchUpper = new THREE.Quaternion();
const scratchLower = new THREE.Quaternion();
const scratchWorld = new THREE.Quaternion();

export function solveTwoBone(
  rootJoint: THREE.Vector3,
  target: THREE.Vector3,
  hint: THREE.Vector3,
  upper: number,
  lower: number,
  rest: THREE.Vector3 = LIMB_REST,
  out?: TwoBoneSolution,
): TwoBoneSolution {
  const toTarget = scratchA.copy(target).sub(rootJoint);
  const reach = Math.min(toTarget.length(), upper + lower - REACH_MARGIN);
  const u = toTarget.normalize();
  // The pole: the hint's component perpendicular to the root-target line.
  const pole = scratchB.copy(hint).sub(rootJoint);
  pole.addScaledVector(u, -pole.dot(u)).normalize();
  const cosRoot = (upper * upper + reach * reach - lower * lower) / (2 * upper * reach);
  const rootAngle = Math.acos(Math.max(-1, Math.min(1, cosRoot)));
  const upperDir = scratchC.copy(u).multiplyScalar(Math.cos(rootAngle)).addScaledVector(pole, Math.sin(rootAngle));
  const upperQ = scratchUpper.setFromUnitVectors(rest, upperDir);
  const elbow = scratchElbow.copy(upperDir).multiplyScalar(upper).add(rootJoint);
  const lowerDir = scratchDir.copy(target).sub(elbow).normalize();
  const lowerWorld = scratchWorld.setFromUnitVectors(rest, lowerDir);
  // Local to the upper bone: undo the upper bone's rotation first.
  const lowerQ = scratchLower.copy(upperQ).invert().multiply(lowerWorld);
  const solution = out ?? { upper: new THREE.Quaternion(), lower: new THREE.Quaternion() };
  solution.upper.copy(upperQ);
  solution.lower.copy(lowerQ);
  return solution;
}
