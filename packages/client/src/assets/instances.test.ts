import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { instanceAsset } from './instances.ts';

function template(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'crate';
  const material = new THREE.MeshBasicMaterial();
  const near = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material);
  near.name = 'crate';
  const farRoot = new THREE.Group();
  farRoot.name = 'crate_LOD1';
  const far = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  far.name = 'crate-card';
  farRoot.add(far);
  root.add(near, farRoot);
  return root;
}

describe('static level instancing (T-4.07)', () => {
  it('puts repeated placements into shared instance buffers and keeps LOD per placement', () => {
    const root = template();
    const batch = instanceAsset(
      root,
      [
        { x: 0, y: 0, z: -5, rot: 0 },
        { x: 0, y: 0, z: -60, rot: 90 },
      ],
      2,
    );
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 200);
    camera.position.set(0, 1, 0);
    camera.updateMatrixWorld(true);
    batch.update(camera);

    expect(batch.counts()).toEqual([1, 1]);
    const meshes = batch.object.children as THREE.InstancedMesh[];
    expect(meshes).toHaveLength(2);
    expect(meshes.map((mesh) => mesh.count).sort()).toEqual([1, 1]);
    expect(meshes.every((mesh) => mesh.isInstancedMesh)).toBe(true);

    batch.dispose();
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      for (const material of Array.isArray(o.material) ? o.material : [o.material]) material.dispose();
    });
  });

  it('makes many repeated copies one InstancedMesh when the source has one mesh', () => {
    const root = new THREE.Group();
    root.name = 'barrier';
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    const placements = Array.from({ length: 128 }, (_, i) => ({ x: i % 16, y: 0, z: -5 - Math.floor(i / 16), rot: 0 }));
    const batch = instanceAsset(root, placements, 1);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
    camera.updateMatrixWorld(true);
    batch.update(camera);
    expect(batch.object.children).toHaveLength(1);
    expect((batch.object.children[0] as THREE.InstancedMesh).count).toBe(128);
    expect(batch.counts()).toEqual([128]);
    batch.dispose();
    const mesh = root.children[0] as THREE.Mesh;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });
});
