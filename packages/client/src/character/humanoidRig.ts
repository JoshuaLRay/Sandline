import type * as THREE from 'three';

/**
 * The humanoid rig contract (T-2.22).
 *
 * Everything that poses a soldier — the locomotion pose driver, the crouch and
 * downed poses, the flinch, and T-2.23's vault — talks to a soldier through
 * this interface and nothing else. Two things implement it: the skinned
 * soldier in humanoidSoldier.ts (the primary presentation) and the grey-box
 * fixture in humanoidPlaceholder.ts (the fallback and diagnostic). A glTF
 * soldier from the M4/M5 pipeline will be a third, and needs only to name its
 * bones as HUMANOID_BONES does.
 *
 * Three rules the contract exists to keep:
 *
 * 1. THE ROOT IS THE HITBOX. `root` is the invisible capsule the harness
 *    raycasts and the server resolves hits against. No implementation moves,
 *    rotates or rescales it; the rig is its children. main.ts places the root
 *    from authoritative state and never from anything the rig does.
 * 2. BONES ARE NAMED, NOT ASSUMED. A pose or gait asks for a bone by name and
 *    gets null when the rig has no such joint: the grey box has no knees, and
 *    a gait that bends knees simply bends none there. No caller branches on
 *    the rig's kind.
 * 3. GAIT IS LAYERED ON THE POSE. `base(name)` is the transform a bone returns
 *    to in the current pose — the rest transform with the pose's offset — and
 *    the gait composes on top of that every frame, so crouch-walking is the
 *    crouch with a gait on it, and idle in a crouch is exactly the crouch.
 */
export type HumanoidBoneName =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'upper-arm-left'
  | 'lower-arm-left'
  | 'hand-left'
  | 'upper-arm-right'
  | 'lower-arm-right'
  | 'hand-right'
  | 'upper-leg-left'
  | 'lower-leg-left'
  | 'foot-left'
  | 'upper-leg-right'
  | 'lower-leg-right'
  | 'foot-right';

/** Every joint a full rig has, in skeleton order (parents before children). */
export const HUMANOID_BONES: readonly HumanoidBoneName[] = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'upper-arm-left',
  'lower-arm-left',
  'hand-left',
  'upper-arm-right',
  'lower-arm-right',
  'hand-right',
  'upper-leg-left',
  'lower-leg-left',
  'foot-left',
  'upper-leg-right',
  'lower-leg-right',
  'foot-right',
];

/**
 * How the body is arranged on the hit capsule. The capsule itself is the same
 * upright shape in every pose (the server's is), so a pose only ever moves
 * the rig's bones. Vault is T-2.23's to add.
 */
export type HumanoidPose = 'standing' | 'crouched' | 'downed';

export type HumanoidRigKind = 'skinned' | 'grey-box';

export interface RigTransform {
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

/**
 * How much of each gait layer a rig can carry, 0..1. The pose driver is one
 * piece of arithmetic for every rig; these are the rig telling it which parts
 * of that arithmetic have somewhere to land. The grey box swings whole limbs
 * and has no knees to bend, so its knees are 0; the skinned soldier holds a
 * rifle in both hands, so its arms barely swing.
 */
export interface GaitStyle {
  /** Multiplier on the arm swing. */
  armSwing: number;
  /** Multiplier on the knee bend through the swing phase. */
  kneeBend: number;
  /** Multiplier on the hips' vertical bob, twice per cycle. */
  bob: number;
  /** Multiplier on the chest's counter-twist against the hips. */
  twist: number;
  /** Multiplier on the forward lean with speed. */
  lean: number;
}

export interface HumanoidRig {
  readonly kind: HumanoidRigKind;
  /** The hittable root. Never moved by the rig. */
  readonly root: THREE.Object3D;
  /**
   * The weapon attachment: a child of the chest that carries the rifle and
   * that the hands are posed onto. Stable across poses and gait, so anything
   * that wants "where the weapon is" reads its world transform.
   */
  readonly aim: THREE.Object3D;
  readonly style: GaitStyle;
  /** What a hit jerks back along local -Z: the upper body, not the legs. */
  readonly flinchParts: readonly THREE.Object3D[];
  readonly pose: HumanoidPose;
  bone(name: HumanoidBoneName): THREE.Object3D | null;
  /** The transform `name` returns to in the current pose, or null without the bone. */
  base(name: HumanoidBoneName): RigTransform | null;
  /**
   * Arrange the bones for a pose. Idempotent, and `standing` restores every
   * bone's standing transform exactly. Leaves the root alone.
   */
  setPose(pose: HumanoidPose): void;
}

const RIGS = new WeakMap<THREE.Object3D, HumanoidRig>();

/** Factories register the rig that owns a root so callers can get from one to the other. */
export function registerRig(rig: HumanoidRig): void {
  RIGS.set(rig.root, rig);
}

export function rigOf(root: THREE.Object3D): HumanoidRig | null {
  return RIGS.get(root) ?? null;
}

export function requireRig(root: THREE.Object3D): HumanoidRig {
  const rig = rigOf(root);
  if (!rig) throw new Error(`No humanoid rig is registered for "${root.name}"`);
  return rig;
}

export function isHumanoidRig(value: THREE.Object3D | HumanoidRig): value is HumanoidRig {
  return typeof (value as HumanoidRig).bone === 'function' && typeof (value as HumanoidRig).setPose === 'function';
}

export function transformOf(part: THREE.Object3D): RigTransform {
  return {
    position: part.position.toArray() as [number, number, number],
    quaternion: part.quaternion.toArray() as [number, number, number, number],
  };
}
