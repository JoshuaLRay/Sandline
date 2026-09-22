import * as THREE from 'three';
import {
  HUMANOID_BONES,
  type GaitStyle,
  type HumanoidBoneName,
  type HumanoidPose,
  type HitReaction,
  type HumanoidRig,
  type RigTransform,
  type WeaponHold,
  registerRig,
} from './humanoidRig.ts';
import { plateau } from './locomotionPose.ts';
import { solveTwoBone } from './twoBoneIk.ts';
import { DOWNED_BODY_LIFT_M, HUMANOID_HIT_HALF_HEIGHT, HUMANOID_HIT_RADIUS, HUMANOID_ROOT_LIFT_M, PRONE_BODY_LIFT_M } from './humanoidPlaceholder.ts';
import { type CellName, type PaletteName, remapGeometryUv, soldierAtlas } from './soldierTexture.ts';

/**
 * The M2 soldier: a skinned humanoid built in code (T-2.22).
 *
 * One `SkinnedMesh` on a seventeen-bone skeleton, GPU-skinned like the
 * production soldier will be (ADR-013 budgets 45–65 bones and GPU skinning
 * per character), authored here as primitives welded into one geometry with
 * one textured material: one draw call per soldier where the grey box
 * spent twelve. No asset, no loader, no licence to document: the model is
 * this file, and the M4/M5 Blender → glTF pipeline replaces it by delivering
 * a mesh whose bones carry the names in HUMANOID_BONES.
 *
 * THE DETAIL IS IN THE TEXTURE, NOT THE TRIANGLES (T-2.30). Each primitive
 * names a cell of the generated atlas in `soldierTexture.ts` and is welded
 * with its UVs remapped into it, the way an early-2000s console character
 * carried its whole detail budget in one small hand-painted diffuse. Flat
 * per-segment vertex colours came out when the atlas went in: they could not
 * express a pouch, a seam, a bootlace or a face, and those are the things
 * that make the silhouette read as a soldier rather than as primitives.
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

/** Lying on the back, head forward (+Z): the grey box's turn, applied to the hips. */
const DOWNED_TURN = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, Math.PI, 0, 'YXZ'));
/** Face down, head forward (+Z): the opposite pitch from downed, so the chest faces the ground instead of the sky. */
const PRONE_TURN = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0, 'YXZ'));

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

/**
 * Face down, propped on the elbows, the rifle held forward along the sight
 * line — the hips carry the turn, same as downed, but without the flip onto
 * the back, and the arms keep the standing IK hold rather than going slack:
 * this is a stance a soldier fights from. The legs splay a little for a
 * stable base, the chest and neck lift off the ground so the sight is level.
 */
const PRONE: PoseOffsets = {
  hips: { position: [0, PRONE_BODY_LIFT_M - JOINTS.hips[1], 0], quaternion: PRONE_TURN },
  spine: { euler: [0.5, 0, 0] },
  chest: { euler: [-0.3, 0, 0] },
  neck: { euler: [-0.2, 0, 0] },
  head: { euler: [-0.1, 0, 0] },
  'upper-leg-left': { euler: [0, 0, 0.12] },
  'upper-leg-right': { euler: [0, 0, -0.12] },
  'lower-leg-left': { euler: [0.15, 0, 0] },
  'lower-leg-right': { euler: [0.15, 0, 0] },
};

/**
 * Knees bend, hips bob, the chest twists and leans. The arms do not swing:
 * the aim layer solves them onto the rifle every frame (T-2.25).
 */
const SKINNED_STYLE: GaitStyle = { armSwing: 0, kneeBend: 1, bob: 1, twist: 1, lean: 1 };

/**
 * The aim layer's shares (T-2.25). The spine takes a bounded part of the
 * pitch so the whole torso leans into a steep aim; the neck follows so the
 * head looks along it; the aim attachment turns about the shoulder by the
 * remainder, so the rifle's pitch is exactly the aim's.
 */
const AIM_SPINE_SHARE = 0.3;
const AIM_SPINE_MAX = 0.35;
const AIM_NECK_SHARE = 0.35;
const AIM_NECK_MAX = 0.45;
const X_AXIS = new THREE.Vector3(1, 0, 0);
/**
 * The fire and reload layers (T-2.26). A kick leans the spine by a share of
 * the muzzle rise, so the body takes the shot and not only the rifle. A
 * reload dips the muzzle and sends the left hand from the foregrip to the
 * magazine well and back, both curves of the reload's progress.
 */
const KICK_SPINE_SHARE = 0.3;
const RELOAD_DIP = 0.35;
/**
 * The hit reaction's shares (T-2.27). The chest carries the turn and the
 * tilt; on a head-zone hit the head snaps this much of them again on top, so
 * the head goes further and faster than the body under it.
 */
const REACTION_HEAD_SHARE = 1.6;
/** The magazine well in aim space: under the rifle, a hand's length back from the foregrip. */
const MAG_WELL: [number, number, number] = [0.02, -0.17, 0.13];
const scratchOffset = new THREE.Vector3();

interface Segment {
  geometry: THREE.BufferGeometry;
  bone: number;
}

const scratchMatrix = new THREE.Matrix4();
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
 *
 * THE UVs COME THROUGH (T-2.30). Each segment arrives already remapped into
 * its atlas cell by `remapGeometryUv`, so welding only has to carry `uv`
 * across the way it carries `position` — the flat per-segment vertex colour
 * this used to synthesise is gone, because the atlas says everything it said
 * and the things it could not: pouches, seams, laces, a face.
 */
function weld(segments: Segment[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const indices: number[] = [];
  for (const segment of segments) {
    const source = segment.geometry;
    const position = source.getAttribute('position');
    const normal = source.getAttribute('normal');
    const uv = source.getAttribute('uv');
    const offset = positions.length / 3;
    for (let i = 0; i < position.count; i += 1) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      uvs.push(uv.getX(i), uv.getY(i));
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
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
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
  const atlas = soldierAtlas(variant);
  const rifleGeometry = new THREE.BoxGeometry(0.06, 0.1, 0.9);
  // On the long faces `u` runs stock to muzzle, which is how the one rifle
  // cell gets furniture, a magazine and a barrel out of a single box.
  remapGeometryUv(rifleGeometry, 'rifle');
  const rifle = new THREE.Mesh(rifleGeometry, new THREE.MeshLambertMaterial({ map: atlas }));
  rifle.name = 'rifle';
  rifle.position.set(0, 0, 0.4);
  rifle.castShadow = true;
  aim.add(rifle);

  // -- Skin: primitives around the joints, welded, rigidly weighted. Each one
  // names the atlas cell its surface is painted in; a box may name six, one
  // per face, which is where the torso gets a front and a back. --
  const segments: Segment[] = [];
  const add = (name: HumanoidBoneName, cell: CellName | CellName[], geometry: THREE.BufferGeometry): void => {
    remapGeometryUv(geometry, cell);
    segments.push({ geometry, bone: boneIndex(name) });
  };
  /** Box faces in Three's build order: +X, -X, +Y, -Y, +Z (front), -Z (back). */
  const shirt: CellName[] = ['uniformPlain', 'uniformPlain', 'uniformPlain', 'uniformPlain', 'torsoFront', 'torsoBack'];
  const carrier: CellName[] = ['vest', 'vest', 'gearPlain', 'gearPlain', 'vest', 'pack'];
  add('hips', 'belt', placed(new THREE.BoxGeometry(0.38, 0.22, 0.28), 0, 0.92, 0));
  add('spine', shirt, placed(new THREE.BoxGeometry(0.34, 0.18, 0.26), 0, 1.09, 0));
  add('chest', shirt, placed(new THREE.BoxGeometry(0.42, 0.38, 0.28), 0, 1.31, 0));
  add('chest', carrier, placed(new THREE.BoxGeometry(0.45, 0.3, 0.34), 0, 1.3, 0));
  // The pack is the deepest thing on the body and so the one most able to
  // poke out of the capsule the server resolves hits against. Kept inside it.
  add('chest', 'pack', placed(new THREE.BoxGeometry(0.34, 0.4, 0.15), 0, 1.24, -0.215));
  // The collar, and the pouches the texture alone can only imply. Gear that
  // breaks the outline is most of what tells a 2002 soldier from a mannequin.
  add('chest', 'uniformPlain', placed(new THREE.BoxGeometry(0.22, 0.08, 0.22), 0, 1.5, 0));
  for (const x of [-0.13, 0, 0.13]) {
    add('chest', 'pouch', placed(new THREE.BoxGeometry(0.1, 0.12, 0.07), x, 1.26, 0.19));
  }
  for (const side of ['left', 'right'] as const) {
    const s = side === 'left' ? 1 : -1;
    add('hips', 'pouch', placed(new THREE.BoxGeometry(0.1, 0.13, 0.08), s * 0.15, 0.93, 0.12));
    // A shoulder slab, not a ball: the era built a shoulder out of flats.
    add('chest', 'sleeve', placed(new THREE.BoxGeometry(0.13, 0.15, 0.25), s * 0.2, 1.43, 0));
    add(`upper-arm-${side}`, 'sleeve', placed(new THREE.CapsuleGeometry(0.068, UPPER_ARM_M, 2, 6), s * 0.2, 1.44 - UPPER_ARM_M / 2, 0));
    add(`lower-arm-${side}`, 'sleeve', placed(new THREE.CapsuleGeometry(0.06, LOWER_ARM_M, 2, 6), s * 0.2, 1.14 - LOWER_ARM_M / 2, 0));
    add(`hand-${side}`, 'glove', placed(new THREE.BoxGeometry(0.095, 0.13, 0.095), s * 0.2, 0.81, 0));
    add(`upper-leg-${side}`, 'trouser', placed(new THREE.CapsuleGeometry(0.092, 0.42, 2, 6), s * 0.11, 0.69, 0));
    add(`lower-leg-${side}`, 'trouser', placed(new THREE.CapsuleGeometry(0.075, 0.42, 2, 6), s * 0.11, 0.27, 0));
    // The boot's upper, on the shin that wears it, so the trouser does not
    // stop in mid-air above a block: the ankle is where a chunky boot most
    // obviously fails to be attached to anything.
    add(`lower-leg-${side}`, 'boot', placed(new THREE.BoxGeometry(0.15, 0.14, 0.17), s * 0.11, 0.15, 0.01));
    // Oversized boots, read at distance on a CRT and kept ever since.
    add(`foot-${side}`, 'boot', placed(new THREE.BoxGeometry(0.17, 0.14, 0.34), s * 0.11, 0.07, 0.06));
  }
  add('neck', 'neck', placed(new THREE.CylinderGeometry(0.058, 0.065, 0.12, 6), 0, 1.53, 0));
  add('head', 'face', placed(new THREE.SphereGeometry(0.125, 8, 6), 0, 1.7, 0));
  add('head', 'helmet', placed(new THREE.SphereGeometry(0.152, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.55), 0, 1.72, 0));
  // The brim. One disc at the dome's rim, and the single strongest era cue
  // the whole model has: a helmet without one reads as a swimming cap.
  add('head', 'helmet', placed(new THREE.CylinderGeometry(0.172, 0.162, 0.03, 8), 0, 1.695, 0));

  // Lambert, not Standard (T-2.32). A PBR material is a modern look by
  // construction — a roughness response and an environment term the era had
  // no way to compute. Lambert is diffuse and nothing else, which is what
  // hardware lighting in 2002 was, and it is cheaper besides.
  //
  // SMOOTH NORMALS ON PURPOSE. `flatShading` is the reflex here and it is the
  // wrong console: the PS2 interpolated per-vertex lighting across a triangle
  // (Gouraud), so its curved surfaces read smooth and only the SILHOUETTE
  // gave the polygon count away — which is exactly what T-2.31's six-sided
  // limbs do. Faceted shading is a 2015 indie look, not a 2002 one.
  const mesh = new THREE.SkinnedMesh(weld(segments), new THREE.MeshLambertMaterial({ map: atlas }));
  mesh.name = 'soldier';
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.add(hips);
  // The skin is authored with the feet at y = 0; the root's centre is 0.9 up.
  mesh.position.y = -HUMANOID_ROOT_LIFT_M;
  root.add(mesh);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(ordered));

  // -- The rifle hold: the arms solved onto the grips in the chest's frame. --
  // One function for the build-time standing pose and for the aim layer, so
  // that an aim of zero reproduces the standing arms bit for bit.
  const chestOrigin = new THREE.Vector3().fromArray(JOINTS.chest);
  const inChest = (model: [number, number, number]): THREE.Vector3 => new THREE.Vector3().fromArray(model).sub(chestOrigin);
  const aimOrigin = new THREE.Vector3().fromArray(AIM_IN_CHEST);
  const toWell = new THREE.Vector3().fromArray(MAG_WELL).sub(new THREE.Vector3().fromArray(GRIP_LEFT));
  const holdRifle = (
    side: 'left' | 'right',
    aimTurn: THREE.Quaternion,
    origin: THREE.Vector3 = aimOrigin,
    reach = 0,
  ): { upper: THREE.Quaternion; lower: THREE.Quaternion } => {
    const grip = new THREE.Vector3().fromArray(side === 'left' ? GRIP_LEFT : GRIP_RIGHT);
    // The left hand on its way to the magazine well, in the rifle's frame.
    // Branching rather than scaling by zero keeps a reach of 0 bit-exact.
    if (side === 'left' && reach > 0) grip.addScaledVector(toWell, reach);
    grip.applyQuaternion(aimTurn).add(origin);
    // The same solver the legs plant a foot with (T-2.28), in the chest's frame.
    return solveTwoBone(
      inChest(JOINTS[`upper-arm-${side}`]),
      grip,
      inChest(JOINTS[`upper-arm-${side}`]).add(new THREE.Vector3().fromArray(side === 'left' ? ELBOW_HINT_LEFT : ELBOW_HINT_RIGHT)),
      UPPER_ARM_M,
      LOWER_ARM_M,
    );
  };
  const standing: PoseOffsets = {};
  for (const side of ['left', 'right'] as const) {
    const solved = holdRifle(side, new THREE.Quaternion());
    standing[`upper-arm-${side}`] = { quaternion: solved.upper };
    standing[`lower-arm-${side}`] = { quaternion: solved.lower };
  }
  const poses: Record<HumanoidPose, PoseOffsets> = {
    standing,
    // Crouch, prone and downed keep the hold: the arms are chest-relative.
    crouched: { ...standing, ...CROUCHED },
    prone: { ...standing, ...PRONE },
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
    // A pose re-bases the attachment too: level and in place, until the
    // weapon layer says otherwise.
    aim.quaternion.identity();
    aim.position.fromArray(AIM_IN_CHEST);
    pose = next;
  };
  apply('standing');

  // -- The aim layer's own bookkeeping (T-2.25). --
  // The neck is the driver's to write each frame; the layer composes on it.
  // If the driver has not touched it since the last application (a frame
  // with no time in it), the last application is undone first, so the
  // layer never accumulates.
  const spine = bones.get('spine')!;
  const neck = bones.get('neck')!;
  const neckBefore = new THREE.Quaternion();
  const neckAfter = new THREE.Quaternion();
  let neckApplied = false;
  const spineTurn = new THREE.Quaternion();
  const neckTurn = new THREE.Quaternion();
  const aimTurn = new THREE.Quaternion();
  const restoreArms = (): void => {
    for (const name of ['upper-arm-left', 'lower-arm-left', 'upper-arm-right', 'lower-arm-right'] as const) {
      bones.get(name)!.quaternion.fromArray(bases.get(name)!.quaternion);
    }
  };
  const hold = (state: WeaponHold): void => {
    if (neckApplied && neck.quaternion.equals(neckAfter)) neck.quaternion.copy(neckBefore);
    neckApplied = false;
    const w = Number.isFinite(state.weight) ? Math.max(0, Math.min(1, state.weight)) : 0;
    const pitchRadians = state.pitch;
    if (w === 0 || !Number.isFinite(pitchRadians)) {
      // Off: the pose's own arms and a level rifle in place, whatever the pose is.
      spine.quaternion.fromArray(bases.get('spine')!.quaternion);
      aim.quaternion.identity();
      aim.position.fromArray(AIM_IN_CHEST);
      restoreArms();
      return;
    }
    const p = pitchRadians * w;
    const kickUp = Number.isFinite(state.kickUp) ? Math.max(0, state.kickUp as number) * w : 0;
    const kickBack = Number.isFinite(state.kickBack) ? Math.max(0, state.kickBack as number) * w : 0;
    const reload = Number.isFinite(state.reload) ? Math.max(0, Math.min(1, state.reload as number)) : 0;
    const spineLean = Math.max(-AIM_SPINE_MAX, Math.min(AIM_SPINE_MAX, p * AIM_SPINE_SHARE + kickUp * KICK_SPINE_SHARE));
    const neckLean = Math.max(-AIM_NECK_MAX, Math.min(AIM_NECK_MAX, p * AIM_NECK_SHARE));
    // Looking up is a positive pitch; about the model's X, up is a negative turn.
    spine.quaternion.fromArray(bases.get('spine')!.quaternion).multiply(spineTurn.setFromAxisAngle(X_AXIS, -spineLean));
    neckBefore.copy(neck.quaternion);
    neck.quaternion.multiply(neckTurn.setFromAxisAngle(X_AXIS, -neckLean));
    neckAfter.copy(neck.quaternion);
    neckApplied = true;
    // The rifle turns about the shoulder by what the spine did not take, so
    // its pitch in the body's frame is exactly the aim's.
    // The kick lifts the muzzle further; a reload dips it.
    const dip = RELOAD_DIP * plateau(reload, 0, 0.25, 0.75, 1);
    const rifleTurn = -(p - spineLean) - kickUp + dip;
    // A zero turn is the identity itself, not a rotation by negative zero:
    // the snapshot a test compares must be the build-time bits.
    if (rifleTurn === 0) aimTurn.identity();
    else aimTurn.setFromAxisAngle(X_AXIS, rifleTurn);
    aim.quaternion.copy(aimTurn);
    // The kick drives the rifle back along its own axis.
    aim.position.fromArray(AIM_IN_CHEST);
    if (kickBack > 0) aim.position.add(scratchOffset.set(0, 0, -kickBack).applyQuaternion(aimTurn));
    const reach = plateau(reload, 0, 0.3, 0.7, 1);
    for (const side of ['left', 'right'] as const) {
      const solved = holdRifle(side, aimTurn, aim.position, side === 'left' ? reach : 0);
      // Composed on the rest exactly as the pose is, so a level aim lands on
      // the pose's own bits (a bare copy can differ by the sign of a zero).
      bones.get(`upper-arm-${side}`)!.quaternion.fromArray(rest.get(`upper-arm-${side}`)!.quaternion).multiply(solved.upper);
      bones.get(`lower-arm-${side}`)!.quaternion.fromArray(rest.get(`lower-arm-${side}`)!.quaternion).multiply(solved.lower);
    }
  };

  // -- The hit reaction's own bookkeeping (T-2.27). --
  // The chest is the driver's to write every frame, so the layer composes on
  // whatever it holds, with the same undo-if-untouched guard the neck uses:
  // a frame with no time in it cannot stack the reaction. The head is the
  // layer's alone — the driver rotates the neck, never the head — so it is
  // set from its base and the snap composed on that.
  const head = bones.get('head')!;
  const chestBefore = new THREE.Quaternion();
  const chestAfter = new THREE.Quaternion();
  let chestReacted = false;
  const reactTurn = new THREE.Quaternion();
  const headTurn = new THREE.Quaternion();
  const reactEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const react = (reaction: HitReaction | null): boolean => {
    if (chestReacted && chest.quaternion.equals(chestAfter)) chest.quaternion.copy(chestBefore);
    chestReacted = false;
    head.quaternion.fromArray(bases.get('head')!.quaternion);
    // A soldier on the ground does not react: they are already down, and the
    // reaction would be a picture of a fight they are out of.
    if (!reaction || pose === 'downed') return true;
    const turn = Number.isFinite(reaction.turn) ? reaction.turn : 0;
    const lean = Number.isFinite(reaction.lean) ? reaction.lean : 0;
    if (turn === 0 && lean === 0) return true;
    const headShare = REACTION_HEAD_SHARE * (Number.isFinite(reaction.head) ? Math.max(0, Math.min(1, reaction.head)) : 0);
    chestBefore.copy(chest.quaternion);
    // Tilting back is a negative turn about the model's X, as looking up is.
    chest.quaternion.multiply(reactTurn.setFromEuler(reactEuler.set(-lean, turn, 0, 'YXZ')));
    chestAfter.copy(chest.quaternion);
    chestReacted = true;
    if (headShare > 0) {
      head.quaternion.multiply(headTurn.setFromEuler(reactEuler.set(-lean * headShare, turn * headShare, 0, 'YXZ')));
    }
    return true;
  };

  const rig: HumanoidRig = {
    kind: 'skinned',
    root,
    aim,
    style: SKINNED_STYLE,
    // The skinned soldier reacts in bones (T-2.27); nothing translates it.
    flinchParts: [],
    get pose() {
      return pose ?? 'standing';
    },
    bone: (name) => bones.get(name) ?? null,
    base: (name) => bases.get(name) ?? null,
    setPose(next) {
      if (next === pose) return;
      apply(next);
      neckApplied = false;
      chestReacted = false;
    },
    aimAt: (pitchRadians, weight) => hold({ pitch: pitchRadians, weight }),
    hold,
    react,
  };
  registerRig(rig);
  return root;
}

/**
 * Repaint a live soldier (T-2.33). A palette is a texture swap and nothing
 * else — same geometry, same skeleton, same material type, same draw call —
 * so a slot that flips from bot to human changes colour on the entity that is
 * already standing there. ADR-001's bot/human swap on a live entity is the
 * load-bearing decision of the project; this is what it looks like.
 *
 * A no-op on the grey box, which has no atlas to swap and is a diagnostic
 * fixture rather than a soldier.
 */
export function setSoldierPalette(root: THREE.Object3D, palette: PaletteName): boolean {
  const skin = root.getObjectByName('soldier');
  if (!(skin instanceof THREE.SkinnedMesh)) return false;
  const atlas = soldierAtlas(palette);
  for (const mesh of [skin, root.getObjectByName('rifle')]) {
    if (!(mesh instanceof THREE.Mesh)) continue;
    const material = mesh.material as THREE.MeshLambertMaterial;
    if (material.map === atlas) continue;
    material.map = atlas;
    material.needsUpdate = true;
  }
  return true;
}

/** The skinned mesh under a soldier root, for tests and diagnostics. */
export function soldierSkin(root: THREE.Object3D): THREE.SkinnedMesh {
  const skin = root.getObjectByName('soldier');
  if (!(skin instanceof THREE.SkinnedMesh)) throw new Error('No soldier skin under "' + root.name + '"');
  return skin;
}
