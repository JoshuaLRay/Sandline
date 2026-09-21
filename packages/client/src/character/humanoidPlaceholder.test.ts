import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_HITBOX } from '@sandline/server';
import {
  DOWNED_BODY_LIFT_M,
  HUMANOID_CROUCH_HIT_HEIGHT_M,
  HUMANOID_HIT_CROUCH_HALF_HEIGHT,
  HUMANOID_HIT_HALF_HEIGHT,
  HUMANOID_HIT_HEIGHT_M,
  HUMANOID_HIT_RADIUS,
  HUMANOID_ROOT_LIFT_M,
  createHumanoidPlaceholder,
  humanoidPose,
  setHumanoidPose,
} from './humanoidPlaceholder.ts';

describe('humanoid placeholder (T-2.06)', () => {
  it('returns one hittable mesh root with the expected soldier silhouette parts', () => {
    const soldier = createHumanoidPlaceholder('local');

    expect(soldier).toBeInstanceOf(THREE.Mesh);
    expect(soldier.geometry).toBeInstanceOf(THREE.CapsuleGeometry);
    expect(soldier.children.map((child) => child.name)).toEqual([
      'torso',
      'head',
      'helmet',
      'pelvis',
      'arm-left',
      'leg-left',
      'boot-left',
      'arm-right',
      'leg-right',
      'boot-right',
      'backpack',
      'rifle',
    ]);
    expect(soldier.name).toBe('humanoid local');
  });

  it('uses the same dimensions for local and remote soldiers', () => {
    const local = createHumanoidPlaceholder('local');
    const remote = createHumanoidPlaceholder('remote');

    local.geometry.computeBoundingBox();
    remote.geometry.computeBoundingBox();
    expect(local.geometry.boundingBox?.min.toArray()).toEqual(remote.geometry.boundingBox?.min.toArray());
    expect(local.geometry.boundingBox?.max.toArray()).toEqual(remote.geometry.boundingBox?.max.toArray());
    expect(local.children.map((child) => child.name)).toEqual(remote.children.map((child) => child.name));
  });

  it('keeps the placeholder self-contained without sharing mutable materials between soldiers', () => {
    const a = createHumanoidPlaceholder('local');
    const b = createHumanoidPlaceholder('remote');

    const aMaterials = new Set<THREE.Material>();
    a.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        const material = Array.isArray(object.material) ? object.material[0] : object.material;
        aMaterials.add(material);
      }
    });
    b.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        const material = Array.isArray(object.material) ? object.material[0] : object.material;
        expect(aMaterials.has(material)).toBe(false);
      }
    });
  });

  it('makes the hit root the SERVER hitbox, not the torso', () => {
    /**
     * The harness raycasts one object per player (non-recursive), so that
     * object must be the capsule the server resolves hits against — or the
     * client and server disagree about what a shot can hit (note 16).
     */
    expect(HUMANOID_HIT_RADIUS).toBe(DEFAULT_HITBOX.radius);
    expect(HUMANOID_HIT_HALF_HEIGHT).toBe(DEFAULT_HITBOX.halfHeight);
    /**
     * And the heights a hit's zone is read against (T-2.27) are the server's
     * own, or the client would draw a head reaction for a round the server
     * scored on a torso.
     */
    expect(HUMANOID_HIT_CROUCH_HALF_HEIGHT).toBe(DEFAULT_HITBOX.crouchHalfHeight);
    expect(HUMANOID_HIT_HEIGHT_M).toBe(2 * (DEFAULT_HITBOX.halfHeight + DEFAULT_HITBOX.radius));
    expect(HUMANOID_CROUCH_HIT_HEIGHT_M).toBe(
      2 * ((DEFAULT_HITBOX.crouchHalfHeight ?? DEFAULT_HITBOX.halfHeight) + DEFAULT_HITBOX.radius),
    );

    const soldier = createHumanoidPlaceholder('remote');
    // Placed the way main.ts places it: root at the capsule centre above the feet.
    soldier.position.set(0, DEFAULT_HITBOX.centerOffsetY, 0);
    soldier.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const hitsAt = (y: number): boolean => {
      ray.set(new THREE.Vector3(0, y, -5), new THREE.Vector3(0, 0, 1));
      return ray.intersectObject(soldier, false).length > 0;
    };
    // Head, torso and shin all score on the server; the harness must agree.
    expect(hitsAt(1.65)).toBe(true);
    expect(hitsAt(0.9)).toBe(true);
    expect(hitsAt(0.3)).toBe(true);
    // Above the head and below the feet do not.
    expect(hitsAt(1.9)).toBe(false);
    expect(hitsAt(-0.1)).toBe(false);
    // And the capsule itself is never drawn.
    expect((soldier.material as THREE.Material).visible).toBe(false);
  });
});


describe('crouched pose (T-2.20)', () => {
  it('lowers the visible body while leaving the hit root untouched', () => {
    const soldier = createHumanoidPlaceholder('local');
    soldier.position.set(2, HUMANOID_ROOT_LIFT_M, 3);
    const rootBefore = {
      position: soldier.position.toArray(),
      quaternion: soldier.quaternion.toArray(),
      geometry: soldier.geometry,
    };
    const head = soldier.children.find((c) => c.name === 'head');
    if (!head) throw new Error('head missing');
    const standingY = head.position.y;

    setHumanoidPose(soldier, 'crouched');

    expect(humanoidPose(soldier)).toBe('crouched');
    expect(head.position.y).toBeCloseTo(standingY - 0.25, 9);
    expect(soldier.position.toArray()).toEqual(rootBefore.position);
    expect(soldier.quaternion.toArray()).toEqual(rootBefore.quaternion);
    expect(soldier.geometry).toBe(rootBefore.geometry);
  });

  const snapshot = (root: THREE.Object3D) => root.children.map((c) => ({ name: c.name, p: c.position.toArray(), q: c.quaternion.toArray() }));

  it('restores the exact standing pose after crouching', () => {
    const soldier = createHumanoidPlaceholder('remote');
    const standing = snapshot(soldier);
    setHumanoidPose(soldier, 'crouched');
    expect(snapshot(soldier)).not.toEqual(standing);
    setHumanoidPose(soldier, 'standing');
    expect(snapshot(soldier)).toEqual(standing);
  });
});

describe('downed pose (T-2.14)', () => {
  const snapshot = (root: THREE.Object3D) =>
    root.children.map((c) => ({ name: c.name, p: c.position.toArray(), q: c.quaternion.toArray() }));

  it('lays the parts down along the facing, on the ground, and leaves the root exactly alone', () => {
    const soldier = createHumanoidPlaceholder('remote');
    soldier.position.set(3, 0.9, -2);
    soldier.rotation.y = 0.7;
    const rootBefore = { p: soldier.position.toArray(), q: soldier.quaternion.toArray(), g: soldier.geometry };
    const standing = snapshot(soldier);

    setHumanoidPose(soldier, 'downed');
    expect(humanoidPose(soldier)).toBe('downed');
    // Root: same position, same orientation, same geometry object. The hit
    // capsule the server resolves against has not moved.
    expect(soldier.position.toArray()).toEqual(rootBefore.p);
    expect(soldier.quaternion.toArray()).toEqual(rootBefore.q);
    expect(soldier.geometry).toBe(rootBefore.g);

    const head = soldier.children.find((c) => c.name === 'head');
    const boot = soldier.children.find((c) => c.name === 'boot-left');
    if (!head || !boot) throw new Error('parts missing');
    // The body lies along local Z, head forward, feet back...
    expect(head.position.z).toBeGreaterThan(0.5);
    expect(boot.position.z).toBeLessThan(-0.5);
    // ...at roughly the downed lift above the feet, which sit 0.9 below the root.
    const feetY = -HUMANOID_ROOT_LIFT_M;
    expect(Math.abs(head.position.y - (feetY + DOWNED_BODY_LIFT_M))).toBeLessThan(0.15);
    expect(Math.abs(boot.position.y - (feetY + DOWNED_BODY_LIFT_M))).toBeLessThan(0.15);
    // Every part moved from where it stood.
    expect(snapshot(soldier)).not.toEqual(standing);
  });

  it('restores the standing pose exactly, and is idempotent either way', () => {
    const soldier = createHumanoidPlaceholder('local');
    const standing = snapshot(soldier);
    setHumanoidPose(soldier, 'downed');
    const downed = snapshot(soldier);
    setHumanoidPose(soldier, 'downed');
    expect(snapshot(soldier)).toEqual(downed);
    setHumanoidPose(soldier, 'standing');
    expect(snapshot(soldier)).toEqual(standing);
    expect(humanoidPose(soldier)).toBe('standing');
    setHumanoidPose(soldier, 'standing');
    expect(snapshot(soldier)).toEqual(standing);
    // And a second cycle lands on the same downed pose: no drift.
    setHumanoidPose(soldier, 'downed');
    expect(snapshot(soldier)).toEqual(downed);
  });

  it('reads as standing until told otherwise', () => {
    expect(humanoidPose(createHumanoidPlaceholder('remote'))).toBe('standing');
  });
});

