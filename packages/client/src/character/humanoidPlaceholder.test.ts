import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_HITBOX } from '@sandline/server';
import {
  HUMANOID_HIT_HALF_HEIGHT,
  HUMANOID_HIT_RADIUS,
  createHumanoidPlaceholder,
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
