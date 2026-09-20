import * as THREE from 'three';
import { type HumanoidBoneName, type HumanoidRig, isHumanoidRig, requireRig } from './humanoidRig.ts';
import type { LocomotionResult, LocomotionState } from './locomotionState.ts';

/**
 * The gait (T-2.18, routed through the rig contract in T-2.22, vault in
 * T-2.23).
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
 *
 * THE VAULT IS A CURVE OF THE SERVER'S CLOCK, BLENDED IN AND OUT. The vault
 * pose is a function of the authoritative progress (`vaultProgress`, 0..1):
 * the chest leans over the obstacle, the lead leg lifts and comes down
 * first, the trailing leg pushes off and follows. Nothing here has a clock
 * of its own for the vault, so a local prediction and a remote interpolation
 * fed the same progress strike the same pose. What the driver adds is the
 * blending: the gait it was in is frozen and crossfaded into the vault over
 * ENTRY_SECONDS, the vault is crossfaded back into the live gait over
 * EXIT_SECONDS, and a short landing dip follows. Every weight moves by dt,
 * so no frame jumps; `step` and `peakStep` measure that, and the harness
 * prints them.
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

/** Seconds to crossfade the frozen gait into the vault pose. */
export const VAULT_ENTRY_SECONDS = 0.12;
/** Seconds to crossfade the vault pose back into the live gait. */
export const VAULT_EXIT_SECONDS = 0.25;
/** The landing dip: a half sine of this length, starting at the landing. */
export const LANDING_SECONDS = 0.26;
const LANDING_DIP_M = 0.07;
const LANDING_KNEE = 0.35;
const LANDING_THIGH = -0.3;
const LANDING_LEAN = 0.15;
/** Vault pose amplitudes, radians and metres. */
const VAULT_LEAN = 0.45;
const VAULT_LOOK_UP = -0.3;
const VAULT_PELVIS_TILT = 0.2;
const VAULT_TUCK_M = 0.06;
const VAULT_LEAD_THIGH = -1.2;
const VAULT_LEAD_KNEE = 1.0;
const VAULT_PUSH_THIGH = 0.4;
const VAULT_TRAIL_THIGH = -1.0;
const VAULT_TRAIL_KNEE = 1.0;

/** Bones the gait writes. Rotation only, except the hips, which also move. */
const ROTATED: readonly HumanoidBoneName[] = [
  'hips',
  'upper-leg-left',
  'lower-leg-left',
  'foot-left',
  'upper-leg-right',
  'lower-leg-right',
  'foot-right',
  'upper-arm-left',
  'upper-arm-right',
  'chest',
  'neck',
];

const scratchEuler = new THREE.Euler(0, 0, 0, 'XYZ');
const scratchGait = new THREE.Quaternion();
const scratchVault = new THREE.Quaternion();
const scratchLand = new THREE.Quaternion();
const scratchMix = new THREE.Quaternion();

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Rises over [upStart, upEnd], holds at 1, falls over [downStart, downEnd]. */
function plateau(p: number, upStart: number, upEnd: number, downStart: number, downEnd: number): number {
  return smoothstep(upStart, upEnd, p) * (1 - smoothstep(downStart, downEnd, p));
}

export interface LocomotionPoseDriver {
  readonly phase: number;
  /** The largest rotation any animated bone made in the last update, radians. */
  readonly step: number;
  /** The largest `step` since creation or `resetPeak`. */
  readonly peakStep: number;
  /** 0..1: how much of the pose is the vault right now. */
  readonly vaultWeight: number;
  update(result: LocomotionResult, dtSeconds: number): void;
  reset(): void;
  resetPeak(): void;
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
  let step = 0;
  let peakStep = 0;
  /** 0..1, the vault's share of the pose; moves by dt, never jumps. */
  let vaultWeight = 0;
  let vaulting = false;
  /** The vault progress the pose is at; held at the last value through the exit blend. */
  let vaultProgress = 0;
  /** Seconds since the landing, while the landing dip runs; null otherwise. */
  let landing: number | null = null;
  /** The gait's per-bone rotation at the moment the vault began. */
  const frozenGait = new Map<HumanoidBoneName, THREE.Quaternion>();
  const previous = new Map<HumanoidBoneName, THREE.Quaternion>();

  /** The gait's rotation of one bone, from the live phase and speed. */
  interface GaitTerms {
    stride: number;
    legSwing: number;
    armSwing: number;
    kneeLeft: number;
    kneeRight: number;
    forward: number;
    right: number;
    bodySway: number;
    twist: number;
    lean: number;
  }

  function gaitEuler(name: HumanoidBoneName, g: GaitTerms, out: THREE.Euler): THREE.Euler {
    const counter = -g.stride;
    switch (name) {
      case 'upper-leg-left': return out.set(g.stride * g.legSwing * g.forward, 0, counter * g.legSwing * g.right);
      case 'upper-leg-right': return out.set(counter * g.legSwing * g.forward, 0, g.stride * g.legSwing * g.right);
      case 'lower-leg-left': return out.set(g.kneeLeft, 0, 0);
      case 'lower-leg-right': return out.set(g.kneeRight, 0, 0);
      case 'foot-left': return out.set(-0.5 * g.kneeLeft, 0, 0);
      case 'foot-right': return out.set(-0.5 * g.kneeRight, 0, 0);
      case 'upper-arm-left': return out.set(counter * g.armSwing * g.forward, 0, g.stride * g.armSwing * g.right + g.bodySway);
      case 'upper-arm-right': return out.set(g.stride * g.armSwing * g.forward, 0, counter * g.armSwing * g.right + g.bodySway);
      case 'chest': return out.set(g.lean, g.twist, 0);
      default: return out.set(0, 0, 0);
    }
  }

  /** The vault pose at progress p, per bone. Zero at p = 0 and at p = 1. */
  function vaultEuler(name: HumanoidBoneName, p: number, out: THREE.Euler): THREE.Euler {
    const env = plateau(p, 0, 0.25, 0.7, 1);
    // Windows wide enough that no joint moves faster than it does in a
    // walk: the lead leg lifts through the approach and comes down over the
    // top, the trailing leg pushes off and follows once the lead is over.
    const lead = plateau(p, 0, 0.35, 0.5, 0.85);
    const push = plateau(p, 0, 0.25, 0.25, 0.5);
    const trail = plateau(p, 0.25, 0.6, 0.6, 1);
    const knee = rig.style.kneeBend;
    switch (name) {
      case 'chest': return out.set(VAULT_LEAN * env, 0, 0);
      case 'neck': return out.set(VAULT_LOOK_UP * env, 0, 0);
      case 'hips': return out.set(VAULT_PELVIS_TILT * env, 0, 0);
      case 'upper-leg-left': return out.set(VAULT_LEAD_THIGH * lead, 0, 0.1 * lead);
      case 'lower-leg-left': return out.set(VAULT_LEAD_KNEE * lead * knee, 0, 0);
      case 'foot-left': return out.set(-0.3 * lead, 0, 0);
      case 'upper-leg-right': return out.set(VAULT_PUSH_THIGH * push + VAULT_TRAIL_THIGH * trail, 0, -0.1 * trail);
      case 'lower-leg-right': return out.set(VAULT_TRAIL_KNEE * trail * knee, 0, 0);
      case 'foot-right': return out.set(-0.3 * trail, 0, 0);
      default: return out.set(0, 0, 0);
    }
  }

  /** The landing dip at `dip` (0..1), per bone. */
  function landingEuler(name: HumanoidBoneName, dip: number, out: THREE.Euler): THREE.Euler {
    const knee = LANDING_KNEE * dip * rig.style.kneeBend;
    switch (name) {
      case 'upper-leg-left':
      case 'upper-leg-right': return out.set(LANDING_THIGH * dip, 0, 0);
      case 'lower-leg-left':
      case 'lower-leg-right': return out.set(knee, 0, 0);
      case 'foot-left':
      case 'foot-right': return out.set(-0.5 * knee, 0, 0);
      case 'chest': return out.set(LANDING_LEAN * dip, 0, 0);
      default: return out.set(0, 0, 0);
    }
  }

  function measure(): void {
    let largest = 0;
    for (const name of ROTATED) {
      const bone = rig.bone(name);
      if (!bone) continue;
      const before = previous.get(name);
      if (before) largest = Math.max(largest, before.angleTo(bone.quaternion));
      else previous.set(name, new THREE.Quaternion());
      previous.get(name)!.copy(bone.quaternion);
    }
    step = largest;
    if (largest > peakStep) peakStep = largest;
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
    measure();
  }

  function update(result: LocomotionResult, dtSeconds: number): void {
    const blending = vaultWeight > 0 || landing !== null || result.state === 'vault';
    if (result.state === 'idle' && !blending) {
      phase = 0;
      restore();
      return;
    }
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;

    // -- The vault's share, and the landing that follows it. --
    if (result.state === 'vault') {
      if (!vaulting) {
        vaulting = true;
        landing = null;
        // Freeze the gait where it is: the crossfade starts from this frame.
        for (const name of ROTATED) {
          if (!rig.bone(name)) continue;
          const q = frozenGait.get(name) ?? new THREE.Quaternion();
          const base = rig.base(name);
          const bone = rig.bone(name)!;
          // The bone's current rotation relative to its base.
          q.fromArray(base!.quaternion).invert().multiply(bone.quaternion);
          frozenGait.set(name, q);
        }
      }
      vaultProgress = result.vaultProgress;
      vaultWeight = Math.min(1, vaultWeight + dtSeconds / VAULT_ENTRY_SECONDS);
    } else {
      if (vaulting) {
        vaulting = false;
        landing = 0;
        // Resume the gait where the vault leaves the legs: the lead (left)
        // leg ahead, the trailing leg behind, both knees straight.
        phase = Math.PI * 1.5;
      } else if (landing !== null) {
        landing += dtSeconds;
        if (landing >= LANDING_SECONDS) landing = null;
      }
      vaultWeight = Math.max(0, vaultWeight - dtSeconds / VAULT_EXIT_SECONDS);
    }
    const dip = landing === null ? 0 : Math.sin((Math.PI * landing) / LANDING_SECONDS);

    // -- The live gait. --
    const speed = result.state === 'idle' ? 0 : Math.max(0, Math.min(1, result.normalizedSpeed));
    const state: LocomotionState = result.state;
    const sprint = state === 'sprint';
    const cycleHz = sprint ? SPRINT_CYCLE_HZ : WALK_CYCLE_HZ;
    // The phase holds through a vault: the gait resumes where it stopped.
    if (state !== 'vault') phase = (phase + dtSeconds * TWO_PI * cycleHz * speed) % TWO_PI;
    if (state === 'idle') phase = 0;

    const forward = Math.cos(result.directionAngle);
    const right = Math.sin(result.directionAngle);
    const gaitScale =
      sprint ? 1 :
      state === 'crouch-walk' ? 0.55 :
      state === 'crawl' ? 0.35 :
      1;
    const { style } = rig;
    const stride = Math.sin(phase);
    const lateral = Math.cos(phase) * right * LATERAL_SWING_SCALE;
    // Knees bend through the swing, when the leg travels from back to front.
    // The left leg is forward when its stride is negative, so it swings while
    // the cosine is negative; the right leg is half a cycle behind.
    const kneeReach = Math.abs(forward) + 0.5 * Math.abs(right);
    const kneeBend = (sprint ? SPRINT_KNEE_BEND : WALK_KNEE_BEND) * speed * gaitScale * style.kneeBend * kneeReach;
    const gait: GaitTerms = {
      stride,
      legSwing: (sprint ? SPRINT_LEG_SWING : WALK_LEG_SWING) * speed * gaitScale,
      armSwing: (sprint ? SPRINT_ARM_SWING : WALK_ARM_SWING) * speed * gaitScale * style.armSwing,
      kneeLeft: kneeBend * Math.max(0, -Math.cos(phase)),
      kneeRight: kneeBend * Math.max(0, Math.cos(phase)),
      forward,
      right,
      bodySway: lateral * 0.08,
      twist: TWIST * style.twist * stride * forward * speed,
      lean: (sprint ? SPRINT_LEAN : WALK_LEAN) * style.lean * speed * forward,
    };

    // -- Compose: base x (gait ~ vault) x landing. --
    for (const name of ROTATED) {
      const bone = rig.bone(name);
      const base = rig.base(name);
      if (!bone || !base) continue;
      if (vaulting) scratchGait.copy(frozenGait.get(name)!);
      else scratchGait.setFromEuler(gaitEuler(name, gait, scratchEuler));
      if (vaultWeight > 0) {
        scratchVault.setFromEuler(vaultEuler(name, vaultProgress, scratchEuler));
        scratchMix.copy(scratchGait).slerp(scratchVault, vaultWeight);
      } else {
        scratchMix.copy(scratchGait);
      }
      if (dip > 0) scratchMix.multiply(scratchLand.setFromEuler(landingEuler(name, dip, scratchEuler)));
      bone.quaternion.fromArray(base.quaternion).multiply(scratchMix);
    }

    const hips = rig.bone('hips');
    const hipsBase = rig.base('hips');
    if (hips && hipsBase) {
      const bob = (sprint ? SPRINT_BOB_M : WALK_BOB_M) * style.bob * speed * (1 - Math.cos(2 * phase)) * 0.5;
      const tuck = VAULT_TUCK_M * plateau(vaultProgress, 0, 0.25, 0.7, 1) * style.bob;
      const drop = bob * (1 - vaultWeight) + tuck * vaultWeight + LANDING_DIP_M * dip * style.bob;
      hips.position.set(hipsBase.position[0], hipsBase.position[1] - drop, hipsBase.position[2]);
    }
    measure();
  }

  return {
    get phase() { return phase; },
    get step() { return step; },
    get peakStep() { return peakStep; },
    get vaultWeight() { return vaultWeight; },
    update,
    reset() {
      phase = 0;
      vaultWeight = 0;
      vaulting = false;
      vaultProgress = 0;
      landing = null;
      restore();
    },
    resetPeak() { peakStep = 0; },
  };
}
