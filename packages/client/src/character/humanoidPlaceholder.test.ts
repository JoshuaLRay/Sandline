import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createHumanoidPlaceholder } from './humanoidPlaceholder.ts';

describe('humanoid placeholder (T-2.06)', () => {
  it('keeps a full-body hittable proxy behind the expected soldier silhouette', () => {
    const soldier = createHumanoidPlaceholder('local');

    expect(soldier).toBeInstanceOf(THREE.Mesh);
    expect(soldier.geometry).toBeInstanceOf(THREE.CapsuleGeometry);
    expect(soldier.geometry.parameters.radius).toBeCloseTo(0.35, 6);
    expect(soldier.geometry.parameters.height).toBeCloseTo(1.1, 6);

    const material = soldier.material as THREE.MeshBasicMaterial;
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBe(0);

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

    // The client aim ray intentionally tests only the root, not descendants.
    // Aiming at the visible head must therefore still find the full-body proxy.
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(0, 0.62, -3),
      new THREE.Vector3(0, 0, 1),
    );
    expect(raycaster.intersectObject(soldier, false).length).toBeGreaterThan(0);
  });

  it('uses the same hitbox and silhouette dimensions for local and remote soldiers', () => {
    const local = createHumanoidPlaceholder('local');
    const remote = createHumanoidPlaceholder('remote');

    expect(local.geometry.parameters).toEqual(remote.geometry.parameters);
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
});
