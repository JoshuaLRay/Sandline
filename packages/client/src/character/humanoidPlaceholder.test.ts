import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createHumanoidPlaceholder } from './humanoidPlaceholder.ts';

describe('humanoid placeholder (T-2.06)', () => {
  it('returns one hittable mesh root with the expected soldier silhouette parts', () => {
    const soldier = createHumanoidPlaceholder('local');

    expect(soldier).toBeInstanceOf(THREE.Mesh);
    expect(soldier.geometry).toBeInstanceOf(THREE.BoxGeometry);
    expect(soldier.children.map((child) => child.name)).toEqual([
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
