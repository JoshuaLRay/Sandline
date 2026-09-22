import * as THREE from 'three';
import {
  type GaitStyle,
  type HumanoidBoneName,
  type HumanoidPose,
  type HumanoidRig,
  type RigTransform,
  registerRig,
  transformOf,
} from './humanoidRig.ts';
import { plateau } from './locomotionPose.ts';

/**
 * M2 grey-box character: the fallback and diagnostic fixture (T-2.22).
 *
 * This is intentionally grey-box art: loose primitives on the hit capsule,
 * which gives camera, locomotion and aiming work a human silhouette with no
 * skinning in the way. Since T-2.22 the skinned soldier in humanoidSoldier.ts
 * is what the harness draws; this stays for `?greybox` and for the tests that
 * want a rig whose parts can be read off directly. It implements the same
 * rig contract (humanoidRig.ts): whole limbs stand in for the upper-limb
 * bones, and the joints it does not have read as null.
 *
 * THE ROOT IS THE HITBOX, NOT THE TORSO. The QA harness raycasts the shootable
 * set non-recursively — one object per player — to converge the aim and to end
 * predicted tracers. That object has to be the same shape the SERVER resolves
 * hits against (`DEFAULT_HITBOX` in lagComp.ts: a 0.35 m capsule, 1.8 m tall,
 * centred 0.9 m above the feet), or the client and server disagree about what
 * a shot can hit. The first version of this file made the torso box the root,
 * and the harness then treated a soldier as 0.72 m of torso: a predicted
 * tracer passed clean through a head or a shin the server scored as a hit, and
 * the aim converged on the background behind them. The capsule is invisible;
 * the visible parts are its children.
 */
export type HumanoidVariant = 'local' | 'remote';

/**
 * How the visible parts are arranged on the hit capsule (T-2.14).
 *
 * THE POSE MOVES THE PARTS, NEVER THE ROOT. The server's hitbox is the same
 * upright capsule whether a soldier is standing or downed, so the client's
 * shootable root must stay exactly where and how it is; only the children
 * lie down. A downed soldier is therefore still hit where the server says
 * they are hit, and the parts are the picture of it.
 */
export type { HumanoidPose } from './humanoidRig.ts';

/** Height of a downed body's centre above the feet, metres: lying on its back. */
export const DOWNED_BODY_LIFT_M = 0.28;
/** Height of a prone body's centre above the feet, metres: face down, propped on the elbows. */
export const PRONE_BODY_LIFT_M = 0.3;
/** The root's centre sits this far above the feet (the capsule's half height plus radius). */
export const HUMANOID_ROOT_LIFT_M = 0.9;

type RestTransform = RigTransform;

/** Lying on the back, head forward (+Z): turn the up axis onto forward, then face up. */
const DOWNED_TURN = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, Math.PI, 0, 'YXZ'));
/** Face down, head forward (+Z): the opposite pitch from downed, so the chest faces the ground instead of the sky. */
const PRONE_TURN = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0, 'YXZ'));
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();


/** Mirrors the server's hitbox. The test pins these to `DEFAULT_HITBOX`. */
export const HUMANOID_HIT_RADIUS = 0.35;
export const HUMANOID_HIT_HALF_HEIGHT = 0.55;
export const HUMANOID_HIT_CROUCH_HALF_HEIGHT = 0.25;
/**
 * The capsule's full height, standing and crouched: what a hit's height up
 * the body is read against for its zone, exactly as the server reads it
 * (T-2.27). The visible capsule never changes shape — a pose moves bones, not
 * the root — so the crouched height is the server's number, not a measurement
 * of the client's root.
 */
export const HUMANOID_HIT_HEIGHT_M = 2 * (HUMANOID_HIT_HALF_HEIGHT + HUMANOID_HIT_RADIUS);
export const HUMANOID_CROUCH_HIT_HEIGHT_M = 2 * (HUMANOID_HIT_CROUCH_HALF_HEIGHT + HUMANOID_HIT_RADIUS);

export function createHumanoidPlaceholder(variant: HumanoidVariant): THREE.Mesh {
  const local = variant === 'local';
  // CapsuleGeometry's length is the cylinder between the caps: 2 x halfHeight.
  const root = new THREE.Mesh(
    new THREE.CapsuleGeometry(HUMANOID_HIT_RADIUS, HUMANOID_HIT_HALF_HEIGHT * 2, 4, 8),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  root.name = local ? 'humanoid local' : 'humanoid remote';

  // Lambert like the skinned soldier (T-2.32), so the fixture is lit the same
  // way as the thing it stands in for. A diagnostic that shades differently
  // from the model tells you about the diagnostic.
  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.72, 0.34),
    new THREE.MeshLambertMaterial({ color: local ? 0x7b8068 : 0x686d5b }),
  );
  torso.name = 'torso';
  torso.castShadow = true;
  root.add(torso);

  const skin = new THREE.MeshLambertMaterial({ color: 0xc99572 });
  const uniform = new THREE.MeshLambertMaterial({ color: local ? 0x5f6748 : 0x6f7458 });
  const gear = new THREE.MeshLambertMaterial({ color: 0x2f3329 });
  const weapon = new THREE.MeshLambertMaterial({ color: 0x20231f });

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 10, 8), skin);
  head.name = 'head';
  head.position.set(0, 0.62, 0);
  root.add(head);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.52), gear);
  helmet.name = 'helmet';
  helmet.position.set(0, 0.69, 0);
  root.add(helmet);

  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.3), uniform);
  pelvis.name = 'pelvis';
  pelvis.position.set(0, -0.25, 0);
  root.add(pelvis);

  for (const side of [-1, 1] as const) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.43, 4, 8), uniform);
    arm.name = side < 0 ? 'arm-left' : 'arm-right';
    arm.position.set(side * 0.43, 0.02, 0);
    arm.rotation.z = side * -0.12;
    root.add(arm);

    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.5, 4, 8), uniform);
    leg.name = side < 0 ? 'leg-left' : 'leg-right';
    leg.position.set(side * 0.17, -0.48, 0);
    root.add(leg);

    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.12, 0.38), gear);
    boot.name = side < 0 ? 'boot-left' : 'boot-right';
    boot.position.set(side * 0.17, -0.72, 0.08);
    root.add(boot);
  }

  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.52, 0.18), gear);
  backpack.name = 'backpack';
  backpack.position.set(0, -0.02, -0.25);
  root.add(backpack);

  const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.95), weapon);
  rifle.name = 'rifle';
  rifle.position.set(0.35, 0.02, 0.48);
  root.add(rifle);

  // Capture the factory rest once so animation and crouch presentation always
  // return to the same authored pose, regardless of which runs first.
  for (const child of root.children) {
    child.castShadow = true;
    child.userData['rest'] = {
      position: child.position.toArray() as [number, number, number],
      quaternion: child.quaternion.toArray() as [number, number, number, number],
    } satisfies RestTransform;
  }
  root.castShadow = false;
  registerRig(createGreyBoxRig(root));
  return root;
}

/** Which named part stands in for each bone. The joints missing here read as null. */
const GREY_BOX_BONES: Partial<Record<HumanoidBoneName, string>> = {
  hips: 'pelvis',
  chest: 'torso',
  head: 'head',
  'upper-arm-left': 'arm-left',
  'upper-arm-right': 'arm-right',
  'upper-leg-left': 'leg-left',
  'upper-leg-right': 'leg-right',
  'foot-left': 'boot-left',
  'foot-right': 'boot-right',
};

/** Whole limbs swing; there are no knees to bend, no spine to twist. */
const GREY_BOX_STYLE: GaitStyle = { armSwing: 1, kneeBend: 0, bob: 0, twist: 0, lean: 0 };

/** How far the fixture's rifle dips through a reload, radians (T-2.26). */
const GREY_BOX_RELOAD_DIP = 0.35;

/** The parts a hit jerks back: the upper body, not the legs that hold it up. */
export const GREY_BOX_FLINCH_PARTS: readonly string[] = ['torso', 'head', 'helmet', 'arm-left', 'arm-right', 'backpack', 'rifle'];

/**
 * The grey box as a rig. A pose moves the parts directly (`setHumanoidPose`),
 * so the base a bone returns to is captured from the parts right after a
 * pose is applied — which is the only moment the parts hold a pure pose.
 */
function createGreyBoxRig(root: THREE.Mesh): HumanoidRig {
  const parts = new Map<HumanoidBoneName, THREE.Object3D>();
  for (const [bone, name] of Object.entries(GREY_BOX_BONES) as [HumanoidBoneName, string][]) {
    const part = root.getObjectByName(name);
    if (part) parts.set(bone, part);
  }
  const bases = new Map<HumanoidBoneName, RigTransform>();
  const capture = (): void => {
    for (const [bone, part] of parts) bases.set(bone, transformOf(part));
  };
  capture();
  const aim = root.getObjectByName('rifle');
  if (!aim) throw new Error('The grey box has no rifle');
  const flinchParts = root.children.filter((part) => GREY_BOX_FLINCH_PARTS.includes(part.name));
  // The aim layer on the fixture: the rifle part turns about its own X
  // (T-2.25). Undo the last turn if it is still in place, then apply.
  const rifleBefore = new THREE.Quaternion();
  const rifleAfter = new THREE.Quaternion();
  let rifleTurned = false;
  const rifleTurn = new THREE.Quaternion();
  const X = new THREE.Vector3(1, 0, 0);
  return {
    kind: 'grey-box',
    root,
    aim,
    style: GREY_BOX_STYLE,
    flinchParts,
    get pose() {
      return humanoidPose(root);
    },
    bone: (name) => parts.get(name) ?? null,
    base: (name) => bases.get(name) ?? null,
    setPose(pose) {
      if (humanoidPose(root) === pose) return;
      setHumanoidPose(root, pose);
      capture();
      rifleTurned = false;
    },
    aimAt(pitchRadians, weight) {
      this.hold({ pitch: pitchRadians, weight });
    },
    hold(state) {
      if (rifleTurned && aim.quaternion.equals(rifleAfter)) aim.quaternion.copy(rifleBefore);
      rifleTurned = false;
      const w = Number.isFinite(state.weight) ? Math.max(0, Math.min(1, state.weight)) : 0;
      if (w === 0 || !Number.isFinite(state.pitch)) return;
      const kickUp = Number.isFinite(state.kickUp) ? Math.max(0, state.kickUp as number) : 0;
      const reload = Number.isFinite(state.reload) ? Math.max(0, Math.min(1, state.reload as number)) : 0;
      // The fixture turns its rifle for the aim, the kick and a reload's dip;
      // it has no hands to send to a magazine well.
      const turn = -(state.pitch + kickUp) * w + GREY_BOX_RELOAD_DIP * plateau(reload, 0, 0.25, 0.75, 1);
      if (turn === 0) return;
      rifleBefore.copy(aim.quaternion);
      aim.quaternion.multiply(rifleTurn.setFromAxisAngle(X, turn));
      rifleAfter.copy(aim.quaternion);
      rifleTurned = true;
    },
    react() {
      /**
       * The fixture has no reaction of its own (T-2.27): no spine to turn,
       * and a head that is a box sitting on the torso rather than a joint.
       * It keeps the T-2.11 translation flinch, which `effects.flinch` reads
       * this `false` and falls back to, over `flinchParts`.
       */
      return false;
    },
  };
}

/**
 * Arrange the parts for a pose. Idempotent: applying the same pose twice
 * changes nothing, and `standing` restores every part's rest transform
 * EXACTLY (the rest is captured from the parts the first time this is
 * called, so it is whatever the factory built). The root is untouched.
 */
export function setHumanoidPose(root: THREE.Object3D, pose: HumanoidPose): void {
  const current = root.userData['pose'] as HumanoidPose | undefined;
  if (current === pose) return;
  if (current === undefined && pose === 'standing') {
    root.userData['pose'] = 'standing';
    return;
  }
  for (const part of root.children) {
    let rest = part.userData['rest'] as RestTransform | undefined;
    if (!rest) {
      rest = { position: part.position.toArray() as [number, number, number], quaternion: part.quaternion.toArray() as [number, number, number, number] };
      part.userData['rest'] = rest;
    }
    if (pose === 'standing') {
      part.position.fromArray(rest.position);
      part.quaternion.fromArray(rest.quaternion);
      continue;
    }
    if (pose === 'crouched') {
      part.position.fromArray(rest.position);
      part.quaternion.fromArray(rest.quaternion);
      if (part.name === 'head' || part.name === 'helmet') part.position.y -= 0.25;
      else if (part.name === 'torso' || part.name === 'backpack') part.position.y -= 0.22;
      else if (part.name === 'pelvis') part.position.y -= 0.12;
      else if (part.name.startsWith('leg-')) {
        part.position.y -= 0.06;
        part.rotation.x += 0.55;
      } else if (part.name.startsWith('boot-')) {
        part.position.y -= 0.04;
      } else if (part.name.startsWith('arm-')) {
        part.position.y -= 0.18;
        part.rotation.x += 0.3;
      }
      continue;
    }
    // Turn the rest pose about the root's origin, then drop it to the ground.
    // Prone and downed differ only in which turn: prone keeps the face down
    // and the weapon forward, downed adds the extra flip onto the back.
    const turn = pose === 'prone' ? PRONE_TURN : DOWNED_TURN;
    const lift = pose === 'prone' ? PRONE_BODY_LIFT_M : DOWNED_BODY_LIFT_M;
    scratchPosition.fromArray(rest.position).applyQuaternion(turn);
    scratchPosition.y += lift - HUMANOID_ROOT_LIFT_M;
    part.position.copy(scratchPosition);
    scratchQuaternion.fromArray(rest.quaternion);
    part.quaternion.copy(turn).multiply(scratchQuaternion);
  }
  root.userData['pose'] = pose;
}

export function humanoidPose(root: THREE.Object3D): HumanoidPose {
  return (root.userData['pose'] as HumanoidPose | undefined) ?? 'standing';
}

