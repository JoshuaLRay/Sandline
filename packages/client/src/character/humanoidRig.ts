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
 * How the body is arranged on the root capsule. The root is the same
 * upright shape in every pose, so a pose only ever moves the rig's bones;
 * the server's hit volumes follow the pose (`lagComp.ts` `POSED_BODIES`,
 * held to this rig's skin by `humanoidSoldier.test.ts`). Vault is T-2.23's
 * to add.
 *
 * `prone` (T-2.41) is a voluntary combat stance, not `downed`: the weapon
 * stays in hand and the rig keeps reacting to hits, and the body faces down
 * rather than lying on its back.
 *
 * `dead` is not `downed`: face down and flat, both arms stretched above the
 * head on the ground, no weapon, so a body and a soldier waiting on a revive
 * never look alike.
 */
export type HumanoidPose = 'standing' | 'crouched' | 'downed' | 'prone' | 'dead';

/** The poses that lie on the ground with no weapon and no reactions. */
export function isLyingHelpless(pose: HumanoidPose | null): boolean {
  return pose === 'downed' || pose === 'dead';
}

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
  /**
   * What a hit jerks back along local -Z when the rig has no reaction of its
   * own: the upper body, not the legs (T-2.11). Empty on a rig that answers
   * `react`, which shows the hit in bones instead (T-2.27).
   */
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
  /**
   * Pitch the weapon and what holds it to a signed aim pitch, radians,
   * positive up (T-2.25). A LAYER: applied after the pose driver every
   * frame, additive on its output, and never accumulating — applying it
   * twice is applying it once. `weight` 0..1 fades it; at 0, or at pitch 0
   * with weight 1, every bone is bit-identical to the driver's output.
   * The same as `hold({ pitch, weight })`.
   */
  aimAt(pitchRadians: number, weight: number): void;
  /**
   * The whole weapon layer in one call (T-2.25, T-2.26): the aim, the fire
   * layer's kick, and the reload in progress. One pass, so the hands are
   * solved onto the rifle wherever all three have put it. Same rules as
   * `aimAt`: applied after the driver, never accumulating, and with every
   * input at zero (or weight 0) every bone is the driver's own bits.
   */
  hold(state: WeaponHold): void;
  /**
   * What is in the hands, by loadout id (a weapons.json or projectiles.json
   * id). Swaps the model on the aim attachment and moves the grips the next
   * `hold` solves the hands onto. The carbine is the rig's own rifle; a rig
   * with nothing to swap (the grey box) ignores it.
   */
  setHeld(id: string): void;
  /** The loadout id `setHeld` last took; the carbine until then. */
  readonly held: string;
  /**
   * Show a hit (T-2.27). A LAYER, on the same three rules as `hold`: applied
   * after the pose driver, never accumulating, and restoring the driver's own
   * bits exactly when it ends. `react(null)` ends it — and with nothing live
   * it is the question on its own, which is how `effects.flinch` asks.
   *
   * Returns true when the rig has taken the reaction, and false when it has
   * none of its own and the caller should jerk `flinchParts` back instead.
   * A downed soldier does not react: they are already on the ground.
   */
  react(reaction: HitReaction | null): boolean;
}

/**
 * What a round that landed does to the body that took it, in the rig's terms.
 * Angles in radians, signed in the model's frame (+X the soldier's left, +Y
 * up, +Z forward); `hitReaction.ts` computes them from the shot.
 */
export interface HitReaction {
  /** The chest's turn away from the shooter about its own up axis. Positive turns it to the soldier's left. */
  turn: number;
  /** The chest's tilt along the shot. Positive tilts it back, away from a shot in front. */
  lean: number;
  /** 0..1: how much of the reaction the head takes on top of the chest. Only a head-zone hit is above 0. */
  head: number;
}

/** What the weapon layer is asked to show this frame. */
export interface WeaponHold {
  /** Signed aim pitch, radians, positive up. */
  pitch: number;
  /** 0..1: fades the whole layer (through a vault; off while downed). */
  weight: number;
  /** The fire layer's kick: metres back along the rifle's own axis. */
  kickBack?: number;
  /** The fire layer's kick: radians of muzzle rise. */
  kickUp?: number;
  /** 0..1 through a reload; 0 or absent when none is in progress. */
  reload?: number;
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
