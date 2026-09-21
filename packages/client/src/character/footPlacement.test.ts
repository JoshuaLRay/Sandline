/**
 * T-2.28: the feet stand on what is under them.
 *
 * The slab in `world.json` is the fixture: 3 m square at x 7.5..10.5,
 * z 6.5..9.5, its top 0.4 m up, with the block on top of it at 1.2 m. A
 * soldier on the slab's west edge has one foot over the slab and one over the
 * ground, which is the whole of this task in one pose.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_MOVE_CONFIG, DEFAULT_WORLD, supportUnder } from '@sandline/shared';
import { HUMANOID_BONES, type HumanoidRig, requireRig } from './humanoidRig.ts';
import { HUMANOID_ROOT_LIFT_M, createHumanoidPlaceholder } from './humanoidPlaceholder.ts';
import { createHumanoidSoldier } from './humanoidSoldier.ts';
import { createLocomotionPoseDriver, type LocomotionPoseDriver } from './locomotionPose.ts';
import {
  FOOT_RANGE_M,
  FOOT_SETTLE_M,
  type FootPlacementDriver,
  createFootPlacementDriver,
  springTo,
} from './footPlacement.ts';
import type { LocomotionResult } from './locomotionState.ts';

const SLAB_TOP = 0.4;
const SLAB_WEST_X = 7.5;
const SLAB_Z = 8;
const BLOCK_TOP = 1.2;
const BLOCK_WEST_X = 8.25;
const BLOCK_Z = 8.6;
const GROUND = 0;
const FPS = 60;

const IDLE: LocomotionResult = {
  state: 'idle',
  direction: 'forward',
  speed: 0,
  normalizedSpeed: 0,
  gaitRate: 1,
  airborne: false,
  directionAngle: 0,
  vaultProgress: 0,
};
const WALK: LocomotionResult = { ...IDLE, state: 'walk', speed: 4.2, normalizedSpeed: 1 };
const LEG_BONES = [
  'upper-leg-left', 'lower-leg-left', 'foot-left',
  'upper-leg-right', 'lower-leg-right', 'foot-right',
] as const;

interface Soldier {
  root: THREE.Mesh;
  rig: HumanoidRig;
  pose: LocomotionPoseDriver;
  feet: FootPlacementDriver;
}

function soldier(): Soldier {
  const root = createHumanoidSoldier('remote');
  const rig = requireRig(root);
  return {
    root,
    rig,
    pose: createLocomotionPoseDriver(rig),
    feet: createFootPlacementDriver(rig, { world: DEFAULT_WORLD }),
  };
}

/** Stand at x/z with the feet on `feetY`, and let the layer settle. */
function stand(s: Soldier, x: number, z: number, feetY: number, frames = 240): void {
  for (let i = 0; i < frames; i += 1) {
    s.root.position.set(x, feetY + HUMANOID_ROOT_LIFT_M, z);
    s.pose.update(IDLE, 1 / FPS);
    s.feet.update({ feetY, active: true }, 1 / FPS);
  }
}

function worldY(s: Soldier, bone: 'foot-left' | 'foot-right' | 'hips' | 'head'): number {
  s.root.updateMatrixWorld(true);
  return new THREE.Vector3().setFromMatrixPosition(s.rig.bone(bone)!.matrixWorld).y;
}

/** How far a knee is bent out of straight, radians. */
function kneeBend(s: Soldier, side: 'left' | 'right'): number {
  return s.rig.bone(`lower-leg-${side}`)!.quaternion.angleTo(new THREE.Quaternion());
}

function snapshot(rig: HumanoidRig) {
  const out: { name: string; p: number[]; q: number[] }[] = [];
  for (const name of HUMANOID_BONES) {
    const bone = rig.bone(name);
    if (bone) out.push({ name, p: bone.position.toArray(), q: bone.quaternion.toArray() });
  }
  return out;
}

describe('a soldier standing half on the slab (T-2.28)', () => {
  it('puts one foot on the slab and one on the ground, with the hips settled and a knee bent', () => {
    const s = soldier();
    const flat = soldier();
    stand(s, SLAB_WEST_X, SLAB_Z, SLAB_TOP);
    stand(flat, 0, 0, GROUND);

    // The soldier faces +Z, so its own left foot (the model's +X) is the one
    // over the slab; the right hangs over the edge.
    expect(s.feet.offset('left')).toBe(0);
    expect(s.feet.offset('right')).toBe(-SLAB_TOP);
    expect(s.feet.drop).toBe(-SLAB_TOP);

    // Each ankle sits the same height over its own support as it does on flat
    // ground: one on the slab's top, one on the ground.
    const ankle = worldY(flat, 'foot-left') - GROUND;
    expect(worldY(s, 'foot-left')).toBeCloseTo(SLAB_TOP + ankle, 3);
    expect(worldY(s, 'foot-right')).toBeCloseTo(GROUND + ankle, 3);

    // The hips have settled to the lower foot: down by the whole drop from
    // where standing on the slab would have put them.
    expect(worldY(s, 'hips')).toBeCloseTo(worldY(flat, 'hips') + SLAB_TOP + s.feet.drop, 6);
    // And the leg on the slab has taken up the difference at the knee, while
    // the one on the ground stands straight.
    expect(kneeBend(s, 'left')).toBeGreaterThan(1);
    expect(kneeBend(s, 'right')).toBeLessThan(0.05);
  });

  it('never moves the root: the hitbox is where the server put it', () => {
    const s = soldier();
    const at = new THREE.Vector3(SLAB_WEST_X, SLAB_TOP + HUMANOID_ROOT_LIFT_M, SLAB_Z);
    stand(s, at.x, SLAB_Z, SLAB_TOP);
    expect(s.root.position.toArray()).toEqual(at.toArray());
    expect(s.root.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(s.root.scale.toArray()).toEqual([1, 1, 1]);
  });

  it('bounds how far a foot is planted from the body', () => {
    const s = soldier();
    // On the block's west edge: the foot off it is over the slab, 0.8 m down.
    stand(s, BLOCK_WEST_X, BLOCK_Z, BLOCK_TOP);
    expect(supportUnder(BLOCK_WEST_X, BLOCK_Z, 0.09, BLOCK_TOP + 0.45, DEFAULT_WORLD, GROUND)).toBeCloseTo(BLOCK_TOP, 9);
    expect(s.feet.offset('right')).toBe(-FOOT_RANGE_M);
    expect(s.feet.drop).toBe(-FOOT_RANGE_M);
    // Bounded means the foot hangs rather than reaching: it is not on the slab.
    expect(worldY(s, 'foot-right')).toBeGreaterThan(SLAB_TOP + 0.2);
  });
});

describe('flat ground is the driver\'s own bits (T-2.28)', () => {
  it('writes nothing at all on flat ground', () => {
    const s = soldier();
    s.pose.update(IDLE, 1 / FPS);
    const before = snapshot(s.rig);
    s.root.position.set(0, HUMANOID_ROOT_LIFT_M, 0);
    for (let i = 0; i < 10; i += 1) {
      s.pose.update(IDLE, 1 / FPS);
      s.feet.update({ feetY: GROUND, active: true }, 1 / FPS);
    }
    expect(snapshot(s.rig)).toEqual(before);
    expect(s.feet.drop).toBe(0);
    expect(s.feet.offset('left')).toBe(0);
    expect(s.feet.offset('right')).toBe(0);
  });

  it('applying it twice in a frame is applying it once', () => {
    const s = soldier();
    stand(s, SLAB_WEST_X, SLAB_Z, SLAB_TOP);
    const once = snapshot(s.rig);
    // A frame with no time in it: the layer must not stack on itself.
    s.feet.update({ feetY: SLAB_TOP, active: true }, 0);
    expect(snapshot(s.rig)).toEqual(once);
    s.feet.update({ feetY: SLAB_TOP, active: true }, 0);
    expect(snapshot(s.rig)).toEqual(once);
  });

  it('walking back onto flat ground returns the gait exactly', () => {
    const s = soldier();
    const flat = soldier();
    stand(s, SLAB_WEST_X, SLAB_Z, SLAB_TOP, 120);
    // Off the slab and settled: the legs are the gait's own again.
    stand(s, 0, 0, GROUND, 240);
    stand(flat, 0, 0, GROUND, 240);
    expect(s.feet.drop).toBe(0);
    expect(snapshot(s.rig)).toEqual(snapshot(flat.rig));
  });
});

describe('the layer is off when it would be a lie (T-2.28)', () => {
  it('does nothing while airborne, whatever the caller says', () => {
    const s = soldier();
    const flat = soldier();
    // Two metres over the slab, feet still reported at the jump's height.
    for (let i = 0; i < 120; i += 1) {
      s.root.position.set(SLAB_WEST_X, 2 + HUMANOID_ROOT_LIFT_M, SLAB_Z);
      s.pose.update(IDLE, 1 / FPS);
      s.feet.update({ feetY: 2, active: true }, 1 / FPS);
      flat.pose.update(IDLE, 1 / FPS);
    }
    expect(s.feet.drop).toBe(0);
    expect(snapshot(s.rig)).toEqual(snapshot(flat.rig));
  });

  it('is off while vaulting or downed, and a downed soldier does not blend out', () => {
    const s = soldier();
    stand(s, SLAB_WEST_X, SLAB_Z, SLAB_TOP);
    expect(s.feet.drop).toBe(-SLAB_TOP);

    // Downed: the pose is on the ground, so the layer goes with it at once.
    s.rig.setPose('downed');
    s.pose.reset();
    const downed = snapshot(s.rig);
    s.feet.update({ feetY: SLAB_TOP, active: false }, 1 / FPS);
    expect(s.feet.drop).toBe(0);
    expect(s.feet.offset('right')).toBe(0);
    expect(snapshot(s.rig)).toEqual(downed);

    // Vaulting: off, and blended out rather than cut.
    s.rig.setPose('standing');
    stand(s, SLAB_WEST_X, SLAB_Z, SLAB_TOP);
    s.feet.update({ feetY: SLAB_TOP, active: false }, 1 / FPS);
    expect(s.feet.offset('right')).toBeGreaterThan(-SLAB_TOP);
    expect(s.feet.offset('right')).toBeLessThan(0);
  });

  it('a rig with no knees gets no placement at all', () => {
    const root = createHumanoidPlaceholder('remote');
    const rig = requireRig(root);
    expect(rig.bone('lower-leg-left')).toBeNull();
    const feet = createFootPlacementDriver(rig, { world: DEFAULT_WORLD });
    const before = root.children.map((part) => ({ p: part.position.toArray(), q: part.quaternion.toArray() }));
    root.position.set(SLAB_WEST_X, SLAB_TOP + HUMANOID_ROOT_LIFT_M, SLAB_Z);
    for (let i = 0; i < 60; i += 1) feet.update({ feetY: SLAB_TOP, active: true }, 1 / FPS);
    expect(feet.drop).toBe(0);
    expect(root.children.map((part) => ({ p: part.position.toArray(), q: part.quaternion.toArray() }))).toEqual(before);
  });
});

describe('walking across the slab\'s edge (T-2.28)', () => {
  /** The peak per-frame rotation of any leg joint over a walk, radians. */
  function walkPeak(withFeet: boolean, fps: number): number {
    const s = soldier();
    const previous = LEG_BONES.map(() => new THREE.Quaternion());
    const dt = 1 / fps;
    let x = 6.2;
    let feetY = GROUND;
    let peak = 0;
    for (let i = 0; i < Math.round(3 * fps); i += 1) {
      x += DEFAULT_MOVE_CONFIG.walkSpeed * dt;
      // The body steps up and down exactly as the controller does.
      feetY = supportUnder(
        x, SLAB_Z, DEFAULT_MOVE_CONFIG.radius, feetY + DEFAULT_MOVE_CONFIG.stepHeight, DEFAULT_WORLD, GROUND,
      );
      s.root.position.set(x, feetY + HUMANOID_ROOT_LIFT_M, SLAB_Z);
      s.root.rotation.y = Math.PI / 2;
      s.pose.update(WALK, dt);
      if (withFeet) s.feet.update({ feetY, active: true }, dt);
      LEG_BONES.forEach((name, k) => {
        const q = s.rig.bone(name)!.quaternion;
        // The gait's own first frames snap out of the rest pose; the walk is
        // what is being measured, not starting one.
        if (i > 3) peak = Math.max(peak, previous[k]!.angleTo(q));
        previous[k]!.copy(q);
      });
    }
    expect(x).toBeGreaterThan(10.5);
    expect(feetY).toBe(GROUND);
    return peak;
  }

  it('keeps the peak joint step inside the walk\'s own, at 60 fps and at 30', () => {
    for (const fps of [60, 30]) {
      const walk = walkPeak(false, fps);
      const crossing = walkPeak(true, fps);
      expect(walk).toBeGreaterThan(0.1);
      expect(crossing).toBeLessThanOrEqual(walk);
    }
  });
});

describe('the settle (T-2.28)', () => {
  it('starts from rest, never overshoots, and lands exactly on its target', () => {
    let state = { x: 0, v: 0 };
    const target = -0.4;
    let previous = 0;
    // The first step is small: a spring starts with no speed, which is what
    // keeps a knee near straight from taking a radian in one frame.
    state = springTo(state, target, 1 / FPS);
    expect(Math.abs(state.x)).toBeLessThan(0.01);
    for (let i = 0; i < 600; i += 1) {
      state = springTo(state, target, 1 / FPS);
      expect(state.x).toBeGreaterThanOrEqual(target);
      expect(state.x).toBeLessThanOrEqual(previous + FOOT_SETTLE_M);
      previous = state.x;
    }
    expect(state.x).toBe(target);
    expect(state.v).toBe(0);
    // A settled spring is its target exactly, so "flat" stays an exact question.
    expect(springTo({ x: 0, v: 0 }, 0, 1 / FPS)).toEqual({ x: 0, v: 0 });
    expect(springTo({ x: 0.2, v: 0 }, 0, 0)).toEqual({ x: 0.2, v: 0 });
  });
});
