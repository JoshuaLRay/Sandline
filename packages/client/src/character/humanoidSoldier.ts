import * as THREE from 'three';
import {
  HUMANOID_BONES,
  type GaitStyle,
  type HumanoidBoneName,
  type HumanoidPose,
  type HumanoidRig,
  type RigTransform,
  registerRig,
} from './humanoidRig.ts';
import { DOWNED_BODY_LIFT_M, HUMANOID_HIT_HALF_HEIGHT, HUMANOID_HIT_RADIUS, HUMANOID_ROOT_LIFT_M } from './humanoidPlaceholder.ts';

/**
 * The M2 soldier: a skinned humanoid built in code (T-2.22).
 *
 * One `SkinnedMesh` on a seventeen-bone skeleton, GPU-skinned like the
 * production soldier will be (ADR-013 budgets 45–65 bones and GPU skinning
 * per character), authored here as primitives welded into one geometry with
 * one vertex-coloured material: one draw call per soldier where the grey box
 * spent twelve. No asset, no loader, no licence to document: the model is
 * this file, and the M4/M5 Blender → glTF pipeline replaces it by delivering
 * a mesh whose bones carry the names in HUMANOID_BONES.
 *
 * THE ROOT IS STILL THE HITBOX. The factory returns the same invisible
 * capsule the grey box returns — `DEFAULT_HITBOX` on the server — and the
 * skin hangs under it. The harness raycasts the root non-recursively; the
 * skin never takes a hit and never moves the root.
 *
 * THE BIND POSE IS THE IDENTITY. Every bone rests with no rotation and the
 * geometry is authored in model space around the joints, so a bone's local
 * axes are the model's axes: +X is the soldier's left, +Y up, +Z forward, in
 * every joint. A pose or a gait is therefore plain Euler offsets from zero,
 * and the pose driver's arithmetic reads the same on this rig as on the grey
 * box. The rifle hold is the one exception, and it is solved rather than
 * authored: two-bone IK puts each hand on its grip at build time, so the
 * arms are chest-relative and the hands stay on the weapon in every pose.
 */
export type SoldierVariant = 'local' | 'remote';

/** Model-space joint positions, metres, feet at y = 0, facing +Z, +X the soldier's left. */
const JOINTS: Record<HumanoidBoneName, [number, number, number]> = {
  hips: [0, 0.95, 0],
  spine: [0, 1.05, 0],
  chest: [0, 1.27, 0],
  neck: [0, 1.5, 0],
  head: [0, 1.58, 0],
  'upper-arm-left': [0.2, 1.44, 0],
  'lower-arm-left': [0.2, 1.14, 0],
  'hand-left': [0.2, 0.86, 0],
  'upper-arm-right': [-0.2, 1.44, 0],
  'lower-arm-right': [-0.2, 1.14, 0],
  'hand-right': [-0.2, 0.86, 0],
  'upper-leg-left': [0.11, 0.9, 0],
  'lower-leg-left': [0.11, 0.48, 0],
  'foot-left': [0.11, 0.06, 0],
  'upper-leg-right': [-0.11, 0.9, 0],
  'lower-leg-right': [-0.11, 0.48, 0],
  'foot-right': [-0.11, 0.06, 0],
};

const PARENT: Record<HumanoidBoneName, HumanoidBoneName | null> = {
  hips: null,
  spine: 'hips',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  'upper-arm-left': 'chest',
  'lower-arm-left': 'upper-arm-left',
  'hand-left': 'lower-arm-left',
  'upper-arm-right': 'chest',
  'lower-arm-right': 'upper-arm-right',
  'hand-right': 'lower-arm-right',
  'upper-leg-left': 'hips',
  'lower-leg-left': 'upper-leg-left',
  'foot-left': 'lower-leg-left',
  'upper-leg-right': 'hips',
  'lower-leg-right': 'upper-leg-right',
  'foot-right': 'lower-leg-right',
};

const UPPER_ARM_M = 0.3;
const LOWER_ARM_M = 0.28;

/**
 * The weapon attachment in chest space. Its world height and lateral offset
 * are the shared muzzle rig's third-person shoulder (`DEFAULT_MUZZLE_RIG`:
 * 0.3 m to the right, 1.42 m up), so the rifle sits where the tracers start.
 */
export const AIM_IN_CHEST: [number, number, number] = [-0.3, 0.15, 0.05];
/** Where the hands go, in aim space: the grip behind, the foregrip ahead. */
const GRIP_RIGHT: [number, number, number] = [0, -0.08, 0.17];
const GRIP_LEFT: [number, number, number] = [0.02, -0.02, 0.36];
/** Elbow hints in chest space: out to the side and down. */
const ELBOW_HINT_RIGHT: [number, number, number] = [-0.25, -0.6, -0.1];
const ELBOW_HINT_LEFT: [number, number, number] = [0.45, -0.25, 0.1];

const DOWN = new THREE.Vector3(0, -1, 0);

/** Lying on the back, head forward (+Z): the grey box's turn, applied to the hips. */
const DOWNED_TURN = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, Math.PI, 0, 'YXZ'));

interface PoseOffset {
  position?: [number, number, number];
  euler?: [number, number, number];
  quaternion?: THREE.Quaternion;
}
type PoseOffsets = Partial<Record<HumanoidBoneName, PoseOffset>>;

/** A knee-bent crouch: hips 0.4 m down, thighs up, shins back, the spine leaning in. */
const CROUCHED: PoseOffsets = {
  hips: { position: [0, -0.4, 0] },
  spine: { euler: [0.3, 0, 0] },
  chest: { euler: [0.1, 0, 0] },
  neck: { euler: [-0.15, 0, 0] },
  head: { euler: [-0.2, 0, 0] },
  'upper-leg-left': { euler: [-1.35, 0, 0.06] },
  'lower-leg-left': { euler: [1.45, 0, 0] },
  'foot-left': { euler: [-0.1, 0, 0] },
  'upper-leg-right': { euler: [-1.35, 0, -0.06] },
  'lower-leg-right': { euler: [1.45, 0, 0] },
  'foot-right': { euler: [-0.1, 0, 0] },
};

/** On the back, arms out, the rifle hidden. The hips carry the whole turn. */
const DOWNED: PoseOffsets = {
  hips: { position: [0, DOWNED_BODY_LIFT_M - JOINTS.hips[1], 0], quaternion: DOWNED_TURN },
  'upper-arm-left': { euler: [0, 0, 0.55] },
  'lower-arm-left': { euler: [-0.35, 0, 0] },
  'upper-arm-right': { euler: [0, 0, -0.55] },
  'lower-arm-right': { euler: [-0.35, 0, 0] },
  'upper-leg-left': { euler: [0, 0, 0.08] },
  'upper-leg-right': { euler: [0, 0, -0.08] },
};

/** Knees bend, hips bob, the chest twists and leans; the arms stay on the rifle. */
const SKINNED_STYLE: GaitStyle = { armSwing: 0.12, kneeBend: 1, bob: 1, twist: 1, lean: 1 };

interface Segment {
  geometry: THREE.BufferGeometry;
  bone: number;
  color: THREE.Color;
}

const scratchMatrix = new THREE.Matrix4();
const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const scratchC = new THREE.Vector3();
const scratchQ = new THREE.Quaternion();

function boneIndex(name: HumanoidBoneName): number {
  return HUMANOID_BONES.indexOf(name);
}

function placed(geometry: THREE.BufferGeometry, x: number, y: number, z: number, rotX = 0): THREE.BufferGeometry {
  scratchMatrix.makeRotationX(rotX).setPosition(x, y, z);
  return geometry.applyMatrix4(scratchMatrix);
}

/**
 * Weld the segments into one geometry with rigid skin weights: every vertex
 * belongs wholly to its segment's bone. Segments meet at the joints with
 * overlapping caps, so bending a joint keeps the surface closed.
 */
function weld(segments: Segment[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const indices: number[] = [];
  for (const segment of segments) {
    const source = segment.geometry;
    const position = source.getAttribute('position');
    const normal = source.getAttribute('normal');
    const offset = positions.length / 3;
    for (let i = 0; i < position.count; i += 1) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      colors.push(segment.color.r, segment.color.g, segment.color.b);
      skinIndices.push(segment.bone, 0, 0, 0);
      skinWeights.push(1, 0, 0, 0);
    }
    const index = source.index;
    if (index) {
      for (let i = 0; i < index.count; i += 1) indices.push(index.getX(i) + offset);
    } else {
      for (let i = 0; i < position.count; i += 1) indices.push(i + offset);
    }
    segment.geometry.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Two-bone IK in the chest's frame: point the upper arm from `shoulder` so
 * that a lower arm of the given lengths reaches `target`, with the elbow on
 * the side of `hint`. Returns the two bones' local quaternions (rest is the
 * identity, the geometry hangs along -Y).
 */
function solveArm(
  shoulder: THREE.Vector3,
  target: THREE.Vector3,
  hint: THREE.Vector3,
  upper: number,
  lower: number,
): { upper: THREE.Quaternion; lower: THREE.Quaternion } {
  const toTarget = scratchA.copy(target).sub(shoulder);
  const reach = Math.min(toTarget.length(), upper + lower - 1e-3);
  const u = toTarget.normalize();
  // The pole: the hint's component perpendicular to the shoulder-target line.
  const pole = scratchB.copy(hint).sub(shoulder);
  pole.addScaledVector(u, -pole.dot(u)).normalize();
  const cosShoulder = (upper * upper + reach * reach - lower * lower) / (2 * upper * reach);
  const shoulderAngle = Math.acos(Math.max(-1, Math.min(1, cosShoulder)));
  const upperDir = scratchC.copy(u).multiplyScalar(Math.cos(shoulderAngle)).addScaledVector(pole, Math.sin(shoulderAngle));
  const upperQ = new THREE.Quaternion().setFromUnitVectors(DOWN, upperDir);
  const elbow = upperDir.clone().multiplyScalar(upper).add(shoulder);
  const lowerDir = target.clone().sub(elbow).normalize();
  const lowerWorld = new THREE.Quaternion().setFromUnitVectors(DOWN, lowerDir);
  // Local to the upper arm: undo the upper arm's rotation first.
  const lowerQ = upperQ.clone().invert().multiply(lowerWorld);
  return { upper: upperQ, lower: lowerQ };
}

function poseQuaternion(offset: PoseOffset | undefined, out: THREE.Quaternion): THREE.Quaternion {
  if (offset?.quaternion) return out.copy(offset.quaternion);
  if (offset?.euler) return out.setFromEuler(new THREE.Euler(offset.euler[0], offset.euler[1], offset.euler[2], 'XYZ'));
  return out.identity();
}

/**
 * Build a soldier. The returned mesh is the invisible hit capsule, centred
 * `HUMANOID_ROOT_LIFT_M` above the feet like the grey box; the skin, the
 * skeleton and the rifle are its descendants. The rig is registered on it.
 */
export function createHumanoidSoldier(variant: SoldierVariant): THREE.Mesh {
  const local = variant === 'local';
  const root = new THREE.Mesh(
    new THREE.CapsuleGeometry(HUMANOID_HIT_RADIUS, HUMANOID_HIT_HALF_HEIGHT * 2, 4, 8),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  root.name = local ? 'humanoid local' : 'humanoid remote';
  root.castShadow = false;

  // -- Skeleton: identity rest, joints at their model-space positions. --
  const bones = new Map<HumanoidBoneName, THREE.Bone>();
  const ordered: THREE.Bone[] = [];
  for (const name of HUMANOID_BONES) {
    const bone = new THREE.Bone();
    bone.name = name;
    const parent = PARENT[name];
    const joint = JOINTS[name];
    if (parent) {
      const parentJoint = JOINTS[parent];
      bone.position.set(joint[0] - parentJoint[0], joint[1] - parentJoint[1], joint[2] - parentJoint[2]);
      bones.get(parent)!.add(bone);
    } else {
      bone.position.set(joint[0], joint[1], joint[2]);
    }
    bones.set(name, bone);
    ordered.push(bone);
  }
  const hips = bones.get('hips')!;
  const chest = bones.get('chest')!;

  // -- The weapon attachment and the rifle it carries. --
  const aim = new THREE.Object3D();
  aim.name = 'aim';
  aim.position.fromArray(AIM_IN_CHEST);
  chest.add(aim);
  const rifle = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.1, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x20231f, roughness: 0.8 }),
  );
  rifle.name = 'rifle';
  rifle.position.set(0, 0, 0.4);
  rifle.castShadow = true;
  aim.add(rifle);

  // -- Skin: primitives around the joints, welded, rigidly weighted. --
  const skin = new THREE.Color(0xc99572);
  const uniform = new THREE.Color(local ? 0x5f6748 : 0x6f7458);
  const cloth = new THREE.Color(local ? 0x7b8068 : 0x686d5b);
  const gear = new THREE.Color(0x2f3329);
  const segments: Segment[] = [];
  const add = (name: HumanoidBoneName, color: THREE.Color, geometry: THREE.BufferGeometry): void => {
    segments.push({ geometry, bone: boneIndex(name), color });
  };
  add('hips', uniform, placed(new THREE.BoxGeometry(0.36, 0.2, 0.26), 0, 0.92, 0));
  add('spine', cloth, placed(new THREE.BoxGeometry(0.32, 0.18, 0.24), 0, 1.09, 0));
  add('chest', cloth, placed(new THREE.BoxGeometry(0.4, 0.38, 0.26), 0, 1.31, 0));
  add('chest', gear, placed(new THREE.BoxGeometry(0.44, 0.26, 0.32), 0, 1.3, 0));
  add('chest', gear, placed(new THREE.BoxGeometry(0.34, 0.4, 0.16), 0, 1.24, -0.22));
  for (const side of ['left', 'right'] as const) {
    const s = side === 'left' ? 1 : -1;
    add('chest', cloth, placed(new THREE.SphereGeometry(0.09, 8, 6), s * 0.2, 1.44, 0));
    add(`upper-arm-${side}`, uniform, placed(new THREE.CapsuleGeometry(0.055, UPPER_ARM_M, 3, 8), s * 0.2, 1.44 - UPPER_ARM_M / 2, 0));
    add(`lower-arm-${side}`, uniform, placed(new THREE.CapsuleGeometry(0.05, LOWER_ARM_M, 3, 8), s * 0.2, 1.14 - LOWER_ARM_M / 2, 0));
    add(`hand-${side}`, skin, placed(new THREE.BoxGeometry(0.07, 0.11, 0.06), s * 0.2, 0.81, 0));
    add(`upper-leg-${side}`, uniform, placed(new THREE.CapsuleGeometry(0.075, 0.42, 3, 8), s * 0.11, 0.69, 0));
    add(`lower-leg-${side}`, uniform, placed(new THREE.CapsuleGeometry(0.06, 0.42, 3, 8), s * 0.11, 0.27, 0));
    add(`foot-${side}`, gear, placed(new THREE.BoxGeometry(0.13, 0.1, 0.28), s * 0.11, 0.05, 0.05));
  }
  add('neck', skin, placed(new THREE.CylinderGeometry(0.055, 0.06, 0.12, 8), 0, 1.53, 0));
  add('head', skin, placed(new THREE.SphereGeometry(0.12, 10, 8), 0, 1.7, 0));
  add('head', gear, placed(new THREE.SphereGeometry(0.145, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), 0, 1.72, 0));

  const mesh = new THREE.SkinnedMesh(
    weld(segments),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
  );
  mesh.name = 'soldier';
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.add(hips);
  // The skin is authored with the feet at y = 0; the root's centre is 0.9 up.
  mesh.position.y = -HUMANOID_ROOT_LIFT_M;
  root.add(mesh);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(ordered));

  // -- Standing: the rifle hold, solved once in the chest's frame. --
  const chestOrigin = new THREE.Vector3().fromArray(JOINTS.chest);
  const inChest = (model: [number, number, number]): THREE.Vector3 => new THREE.Vector3().fromArray(model).sub(chestOrigin);
  const aimOrigin = new THREE.Vector3().fromArray(AIM_IN_CHEST);
  const standing: PoseOffsets = {};
  for (const side of ['left', 'right'] as const) {
    const grip = new THREE.Vector3().fromArray(side === 'left' ? GRIP_LEFT : GRIP_RIGHT).add(aimOrigin);
    const solved = solveArm(
      inChest(JOINTS[`upper-arm-${side}`]),
      grip,
      inChest(JOINTS[`upper-arm-${side}`]).add(new THREE.Vector3().fromArray(side === 'left' ? ELBOW_HINT_LEFT : ELBOW_HINT_RIGHT)),
      UPPER_ARM_M,
      LOWER_ARM_M,
    );
    standing[`upper-arm-${side}`] = { quaternion: solved.upper };
    standing[`lower-arm-${side}`] = { quaternion: solved.lower };
  }
  const poses: Record<HumanoidPose, PoseOffsets> = {
    standing,
    // Crouch and downed keep the hold: the arms are chest-relative.
    crouched: { ...standing, ...CROUCHED },
    downed: { ...standing, ...DOWNED },
  };

  // -- The rig. --
  const rest = new Map<HumanoidBoneName, RigTransform>();
  for (const name of HUMANOID_BONES) {
    const bone = bones.get(name)!;
    rest.set(name, {
      position: bone.position.toArray() as [number, number, number],
      quaternion: bone.quaternion.toArray() as [number, number, number, number],
    });
  }
  const bases = new Map<HumanoidBoneName, RigTransform>();
  let pose: HumanoidPose | null = null;
  const apply = (next: HumanoidPose): void => {
    const offsets = poses[next];
    for (const name of HUMANOID_BONES) {
      const bone = bones.get(name)!;
      const r = rest.get(name)!;
      const offset = offsets[name];
      const p = offset?.position ?? [0, 0, 0];
      bone.position.set(r.position[0] + p[0], r.position[1] + p[1], r.position[2] + p[2]);
      bone.quaternion.fromArray(r.quaternion).multiply(poseQuaternion(offset, scratchQ));
      bases.set(name, {
        position: bone.position.toArray() as [number, number, number],
        quaternion: bone.quaternion.toArray() as [number, number, number, number],
      });
    }
    aim.visible = next !== 'downed';
    pose = next;
  };
  apply('standing');

  const rig: HumanoidRig = {
    kind: 'skinned',
    root,
    aim,
    style: SKINNED_STYLE,
    flinchParts: [bones.get('spine')!],
    get pose() {
      return pose ?? 'standing';
    },
    bone: (name) => bones.get(name) ?? null,
    base: (name) => bases.get(name) ?? null,
    setPose(next) {
      if (next === pose) return;
      apply(next);
    },
  };
  registerRig(rig);
  return root;
}

/** The skinned mesh under a soldier root, for tests and diagnostics. */
export function soldierSkin(root: THREE.Object3D): THREE.SkinnedMesh {
  const skin = root.getObjectByName('soldier');
  if (!(skin instanceof THREE.SkinnedMesh)) throw new Error('No soldier skin under "' + root.name + '"');
  return skin;
}
