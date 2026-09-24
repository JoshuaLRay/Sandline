import * as THREE from 'three';
import { DEFAULT_MOVE_CONFIG, DEFAULT_WORLD, type MoveConfig, type WorldBox, supportUnder } from '@sandline/shared';
import { type HumanoidRig, isHumanoidRig, isLyingHelpless, requireRig } from './humanoidRig.ts';
import { type TwoBoneSolution, solveTwoBone } from './twoBoneIk.ts';

/**
 * Foot placement (T-2.28): the feet stand on what is under them.
 *
 * A LAYER, ON THE SAME THREE RULES AS THE REST OF E-2.3. Applied after the
 * pose driver every frame, composed on the gait's own output rather than
 * replacing it, never accumulating, and with nothing to show — flat ground —
 * every bone is bit-identical to the driver's. It reads the shared world,
 * which is the same list the controller collides with and the server traces
 * shots against, so the ground the feet stand on is the ground the soldier
 * stands on. It never touches the root: the hitbox is where the server says
 * it is, whatever the legs do underneath it (§0.3, ADR-012).
 *
 * WHAT IT DOES, IN ORDER. Each foot asks `supportUnder` at its own x/z what
 * it is standing over, which gives an offset from the body's authoritative
 * feet height — zero on flat ground, negative over a drop. The hips settle to
 * the LOWEST foot, because a leg that rests straight cannot reach below the
 * hips it hangs from: dropping the hips is the only way a foot goes lower,
 * and it is what a person standing half off a step actually does. Every other
 * foot is then above its support by the difference, and two-bone IK bends that
 * knee to put it back down — the same solver that puts the hands on the rifle
 * (T-2.22). The ankle keeps the world orientation the gait gave it, so a sole
 * stays as flat as the gait had it.
 *
 * THE GAIT STAYS ON TOP, AND A PLANTED FOOT IS THE ONE THE GAIT HAS ON THE
 * GROUND. The IK's target is where the gait has already put the foot, moved
 * vertically; its pole hint is where the gait has already put the knee, so
 * the swing's shape is kept. And a foot the gait has LIFTED is not planted at
 * all: each foot's share of its support fades out with how far the gait has
 * raised it above the same foot's height in the pose's own base, so a leg in
 * mid-swing is the gait's alone and only a foot on the ground is pinned to
 * the world. Standing, where the gait lifts nothing, both feet are planted.
 *
 * BLENDED BY dt, ON A SPRING RATHER THAN AN EXPONENTIAL. The support under a
 * foot changes in one step at an edge — from the slab's top to the ground,
 * 0.4 m, between two frames — and a knee near straight is the one place where
 * a small movement of the foot is a LARGE movement of the joint: the bend
 * grows as the square root of the lift, so an exponential blend, which is
 * fastest in its first frame, turns a 7 cm first step into most of a radian
 * at the knee. That is the snap T-2.23 measured for the vault, in the one
 * shape it can still appear. A critically damped spring starts from zero
 * velocity, so the knee's rate rises from zero instead, and the whole
 * traverse stays inside the joint speeds the gait itself reaches. It snaps to
 * its target inside `FOOT_SETTLE_M`, so "flat" is an exact question and flat
 * ground is the driver's own bits.
 *
 * ONLY WHEN IT IS THE TRUTH. Off while vaulting or downed, which the caller
 * says, and off while airborne, which the layer works out for itself: a body
 * whose own footprint has no support under its feet is in the air, and its
 * legs are the gait's business alone.
 */

/** How far a foot may be planted from the body's own feet height, metres. */
export const FOOT_RANGE_M = 0.45;
/**
 * Spring frequency for the settle, radians per second, critically damped.
 * Bounded by the criterion above: the knee's rate at the start of a traverse
 * is about w x sqrt(2A/L) for a step of A on a leg of segment length L, and
 * it has to stay inside the joint speed a walk already reaches.
 */
export const FOOT_SPRING_RATE = 6;
/** A foot the gait has raised this far above its base is fully in swing. */
export const FOOT_LIFT_FADE_M = 0.08;
/**
 * How far ahead of the knee the IK's pole hint sits, metres in the body's
 * own frame. A knee is a hinge that bends forward, and a standing leg is
 * nearly straight — the knee sits almost exactly ON the hip-to-ankle line,
 * where the perpendicular the solver needs is numerically nothing and its
 * direction is noise, so two consecutive frames can bend the same leg two
 * different ways. Hinting from a point well in front of the knee keeps the
 * plane the leg bends in both stable and anatomical, while the knee's own
 * place still carries whatever the gait is doing with it.
 */
export const KNEE_HINT_M = 0.5;
/**
 * How much of an offset brings the layer fully on, metres.
 *
 * IK cannot reproduce the gait's own bits even when it is asked for the pose
 * the gait is already in: a solved chain reaches the same foot by the
 * shortest arc at each joint, and the gait's rotation of the same joint may
 * carry a twist about the bone that the foot's position does not see. The
 * difference is a tenth of a radian, which is nothing to look at and a
 * visible snap to arrive at in one frame — so the layer fades in over its
 * first two centimetres of offset instead of switching on. Below that the
 * foot is out by less than the fade, which is less than the width of a boot
 * sole; at zero, nothing is written at all.
 */
export const FOOT_FADE_M = 0.02;
/** Inside this of its target and this slow, an offset IS its target. */
export const FOOT_SETTLE_M = 1e-5;
/** The footprint a single foot asks the world about, half-size in metres. */
export const FOOT_HALF_M = 0.09;
/** Feet this far above their own support means airborne, not standing. */
export const FOOT_AIRBORNE_M = 0.05;

export type FootSide = 'left' | 'right';

export interface FootPlacementInput {
  /** The body's authoritative feet height: what the gait poses against. */
  feetY: number;
  /** False while vaulting or downed. Airborne the layer sees for itself. */
  active: boolean;
}

export interface FootPlacementDriver {
  /** The largest rotation any leg joint made in the last update, radians. */
  readonly step: number;
  /** The largest `step` since creation or `resetPeak`. */
  readonly peakStep: number;
  /** How far the hips have settled, metres: 0, or negative toward the lower foot. */
  readonly drop: number;
  /** The blended support offset under one foot, metres. */
  offset(side: FootSide): number;
  update(input: FootPlacementInput, dtSeconds: number): void;
  reset(): void;
  resetPeak(): void;
}

export interface FootPlacementOptions {
  /**
   * The solid world. The shared list, or a test's own — or a getter for the
   * session's named world (T-3.02), which is not known until a join and can
   * change on the next one.
   */
  world?: readonly WorldBox[] | (() => readonly WorldBox[]);
  /** Movement config, for the step height, the ground and the body's footprint. */
  config?: MoveConfig;
}

interface Leg {
  side: FootSide;
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  foot: THREE.Object3D;
  upperLength: number;
  lowerLength: number;
  /** The direction the bones hang in the bind pose, from the rig itself. */
  rest: THREE.Vector3;
  /** The support under this foot, blended, relative to the body's feet. */
  offset: number;
  /** The blend's velocity, metres per second: the spring's state. */
  velocity: number;
  /** Scratch for the base pose's forward kinematics down this leg. */
  fk: THREE.Matrix4;
  /** The bones this layer writes, with what they held before and after it. */
  written: { bone: THREE.Object3D; before: THREE.Quaternion; after: THREE.Quaternion }[];
  /** The last value measured, for the per-frame joint step. */
  previous: THREE.Quaternion[];
  solution: TwoBoneSolution;
}

const scratchFoot = new THREE.Vector3();
const scratchTarget = new THREE.Vector3();
const scratchKnee = new THREE.Vector3();
const scratchRoot = new THREE.Vector3();
const scratchPosition = new THREE.Vector3();
const scratchSole = new THREE.Quaternion();
const scratchLower = new THREE.Quaternion();
const scratchQuaternion = new THREE.Quaternion();
const scratchMatrix = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1);

function clamp(value: number, limit: number): number {
  return value < -limit ? -limit : value > limit ? limit : value;
}

export interface Spring {
  x: number;
  v: number;
}

/**
 * One step of a critically damped spring toward `target`, integrated
 * implicitly so that it is stable at any dt and never overshoots. Velocity
 * starts at zero, which is the whole point: it is what keeps a knee near
 * straight from taking most of a radian in the first frame of a traverse.
 *
 * Settled — inside `FOOT_SETTLE_M` and no longer moving — it IS its target,
 * so a settled offset is exactly its support and a settled flat one is
 * exactly zero, and flat ground leaves the driver's own bits on the bone.
 */
export function springTo(state: Spring, target: number, dtSeconds: number, rate = FOOT_SPRING_RATE): Spring {
  if (!(dtSeconds > 0) || !(rate > 0)) return state;
  if (state.x === target && state.v === 0) return state;
  const f = 1 + 2 * dtSeconds * rate;
  const hoo = dtSeconds * rate * rate;
  const hhoo = dtSeconds * hoo;
  const detInv = 1 / (f + hhoo);
  const x = (f * state.x + dtSeconds * state.v + hhoo * target) * detInv;
  const v = (state.v + hoo * (target - state.x)) * detInv;
  if (Math.abs(x - target) < FOOT_SETTLE_M && Math.abs(v) < FOOT_SETTLE_M) return { x: target, v: 0 };
  return { x, v };
}

/**
 * Plant a soldier's feet on the world. Takes the rig, or the root a factory
 * registered a rig on, as the pose driver does. A rig without knees — the
 * grey box, whose legs are single parts — gets no placement at all, the way
 * a gait that bends knees bends none there.
 */
export function createFootPlacementDriver(
  target: THREE.Object3D | HumanoidRig,
  options: FootPlacementOptions = {},
): FootPlacementDriver {
  const rig = isHumanoidRig(target) ? target : requireRig(target);
  const worldOption = options.world ?? DEFAULT_WORLD;
  const world = (): readonly WorldBox[] => (typeof worldOption === 'function' ? worldOption() : worldOption);
  const config = options.config ?? DEFAULT_MOVE_CONFIG;
  const legs: Leg[] = [];
  for (const side of ['left', 'right'] as const) {
    const upper = rig.bone(`upper-leg-${side}`);
    const lower = rig.bone(`lower-leg-${side}`);
    const foot = rig.bone(`foot-${side}`);
    if (!upper || !lower || !foot || !upper.parent) continue;
    const upperLength = lower.position.length();
    const lowerLength = foot.position.length();
    if (!(upperLength > 0) || !(lowerLength > 0)) continue;
    legs.push({
      side,
      upper,
      lower,
      foot,
      upperLength,
      lowerLength,
      rest: lower.position.clone().normalize(),
      offset: 0,
      velocity: 0,
      fk: new THREE.Matrix4(),
      written: [upper, lower, foot].map((bone) => ({
        bone,
        before: new THREE.Quaternion(),
        after: new THREE.Quaternion(),
      })),
      previous: [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()],
      solution: { upper: new THREE.Quaternion(), lower: new THREE.Quaternion() },
    });
  }
  const hips = rig.bone('hips');
  let step = 0;
  let peakStep = 0;
  let drop = 0;
  /** Set while the last update's application is still on the bones. */
  let applied = false;
  let measured = false;
  let hipsBefore = 0;
  let hipsAfter = 0;

  /**
   * Take the last application off, if the pose driver has not already
   * overwritten it. A frame with no time in it, or a caller that updates
   * twice, must not stack the layer on itself.
   */
  function undo(): void {
    if (!applied) return;
    if (hips && hips.position.y === hipsAfter) hips.position.y = hipsBefore;
    for (const leg of legs) {
      for (const written of leg.written) {
        if (written.bone.quaternion.equals(written.after)) written.bone.quaternion.copy(written.before);
      }
    }
    applied = false;
  }

  /** True while the body's own footprint has ground under its feet. */
  function grounded(feetY: number): boolean {
    rig.root.getWorldPosition(scratchRoot);
    const support = supportUnder(
      scratchRoot.x,
      scratchRoot.z,
      config.radius,
      feetY + config.stepHeight,
      world(),
      config.groundY,
    );
    return feetY - support <= FOOT_AIRBORNE_M;
  }

  /**
   * How much of its support this foot takes, 0..1: all of it while the gait
   * has it on the ground, none while the gait has it in the air. The
   * comparison is against the same foot in the POSE'S OWN base, composed down
   * the leg, so a crouch — which stands on bent legs — is judged by its own
   * rest and not by standing's.
   */
  function plantWeight(leg: Leg): number {
    const hips = rig.bone('hips');
    const parent = hips?.parent;
    if (!parent) return 1;
    leg.fk.identity();
    for (const name of ['hips', `upper-leg-${leg.side}`, `lower-leg-${leg.side}`, `foot-${leg.side}`] as const) {
      const base = rig.base(name);
      if (!base) return 1;
      scratchPosition.fromArray(base.position);
      scratchQuaternion.fromArray(base.quaternion);
      leg.fk.multiply(scratchMatrix.compose(scratchPosition, scratchQuaternion, ONE));
    }
    const baseY = leg.fk.elements[13] as number;
    leg.foot.getWorldPosition(scratchFoot);
    const lift = parent.worldToLocal(scratchFoot).y - baseY;
    // A foot on the ground is on the ground: the dead zone is the width of
    // the arithmetic, and without it a standing soldier's feet take all but
    // a part in 10^15 of their support and no offset is ever exactly itself.
    if (!(lift > FOOT_SETTLE_M)) return 1;
    return lift >= FOOT_LIFT_FADE_M ? 0 : 1 - lift / FOOT_LIFT_FADE_M;
  }

  /** What one foot is standing over, as an offset from the body's feet. */
  function supportOffset(leg: Leg, feetY: number): number {
    leg.foot.getWorldPosition(scratchFoot);
    const support = supportUnder(
      scratchFoot.x,
      scratchFoot.z,
      FOOT_HALF_M,
      feetY + config.stepHeight,
      world(),
      config.groundY,
    );
    return clamp(support - feetY, FOOT_RANGE_M);
  }

  /**
   * Bend one leg so its foot comes back up by `lift` from where it is now,
   * faded in from the gait's own pose by `weight`.
   */
  function plant(leg: Leg, lift: number, weight: number): void {
    const parent = leg.upper.parent;
    if (!parent) return;
    parent.updateWorldMatrix(true, false);
    leg.foot.getWorldPosition(scratchFoot);
    leg.foot.getWorldQuaternion(scratchSole);
    leg.lower.getWorldPosition(scratchKnee);
    // In the hips' frame: the joint, the foot's new place, and the knee the
    // gait has already chosen as the hint, so the swing is kept.
    scratchTarget.set(scratchFoot.x, scratchFoot.y + lift, scratchFoot.z);
    parent.worldToLocal(scratchTarget);
    parent.worldToLocal(scratchKnee).z += KNEE_HINT_M;
    solveTwoBone(
      leg.upper.position,
      scratchTarget,
      scratchKnee,
      leg.upperLength,
      leg.lowerLength,
      leg.rest,
      leg.solution,
    );
    if (weight >= 1) {
      leg.upper.quaternion.copy(leg.solution.upper);
      leg.lower.quaternion.copy(leg.solution.lower);
    } else {
      leg.upper.quaternion.slerp(leg.solution.upper, weight);
      leg.lower.quaternion.slerp(leg.solution.lower, weight);
    }
    leg.upper.updateWorldMatrix(false, true);
    // The sole keeps the orientation the gait gave it.
    leg.foot.quaternion.copy(leg.lower.getWorldQuaternion(scratchLower).invert().multiply(scratchSole));
  }

  function apply(): void {
    drop = 0;
    let magnitude = 0;
    for (const leg of legs) {
      if (leg.offset < drop) drop = leg.offset;
      magnitude = Math.max(magnitude, Math.abs(leg.offset));
    }
    // Flat ground: nothing to show, and the driver's own bits stay on the bone.
    if (magnitude === 0) return;
    const weight = magnitude >= FOOT_FADE_M ? 1 : magnitude / FOOT_FADE_M;
    drop *= weight;
    for (const leg of legs) {
      for (const written of leg.written) written.before.copy(written.bone.quaternion);
    }
    if (hips) {
      hipsBefore = hips.position.y;
      hips.position.y = hipsBefore + drop;
      hipsAfter = hips.position.y;
      hips.updateWorldMatrix(true, true);
    }
    for (const leg of legs) {
      // Every leg is solved, not only the ones off the ground: switching one
      // leg between the gait's pose and a solved one is the same snap the
      // fade exists to avoid. The lowest foot's lift is zero, so its solve
      // asks for the place the hips have already brought it to.
      plant(leg, leg.offset * weight - drop, weight);
      for (const written of leg.written) written.after.copy(written.bone.quaternion);
    }
    applied = true;
  }

  function measure(): void {
    let largest = 0;
    for (const leg of legs) {
      for (let i = 0; i < leg.written.length; i += 1) {
        const bone = leg.written[i]!.bone;
        const previous = leg.previous[i]!;
        // A bone seen for the first time has not moved: the pose driver's own
        // rule, and without it the first frame reports the whole rest pose.
        if (measured) largest = Math.max(largest, previous.angleTo(bone.quaternion));
        previous.copy(bone.quaternion);
      }
    }
    measured = true;
    step = largest;
    if (largest > peakStep) peakStep = largest;
  }

  return {
    get step() { return step; },
    get peakStep() { return peakStep; },
    get drop() { return drop; },
    offset(side) {
      return legs.find((leg) => leg.side === side)?.offset ?? 0;
    },
    update(input, dtSeconds) {
      if (legs.length === 0) return;
      undo();
      const on = input.active && Number.isFinite(input.feetY) && grounded(input.feetY);
      // Going down is not a blend: the downed pose is lying on the ground,
      // and a spring tail on its legs would be a picture of nothing.
      if (!on && isLyingHelpless(rig.pose)) {
        for (const leg of legs) {
          leg.offset = 0;
          leg.velocity = 0;
        }
      }
      for (const leg of legs) {
        const target = on ? supportOffset(leg, input.feetY) * plantWeight(leg) : 0;
        const next = springTo({ x: leg.offset, v: leg.velocity }, target, dtSeconds);
        leg.offset = next.x;
        leg.velocity = next.v;
      }
      apply();
      measure();
    },
    reset() {
      undo();
      for (const leg of legs) {
        leg.offset = 0;
        leg.velocity = 0;
      }
      drop = 0;
      step = 0;
      measured = false;
    },
    resetPeak() { peakStep = 0; },
  };
}
