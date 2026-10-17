import { expect, it } from 'vitest';
import * as THREE from 'three';
import { surfaceChunks } from './surfaceChunks.ts';

it('preserves camera/weapon hits, misses and both roof faces across chunk boundaries', () => {
  const positions = [0,8,0, 96,8,0, 96,8,96, 0,8,96,
    0,12,0, 96,12,0, 96,12,96, 0,12,96,
    48,8,0, 48,12,0, 48,12,96, 48,8,96];
  const indices = [0,1,2, 0,2,3, 4,5,6, 4,6,7, 8,9,10, 8,10,11];
  const original = new THREE.BufferGeometry();
  original.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  original.setIndex(indices);
  const before = [new THREE.Mesh(original, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))];
  const after = surfaceChunks({ positions, indices, normals: positions.map(() => 0), colours: positions.map(() => 1) });
  expect(after.length).toBeGreaterThan(1);
  for (const x of [1, 47.9, 48.1, 95, 100]) for (const z of [1, 47, 95]) {
    for (const [y, dy] of [[20, -1], [10, -1], [10, 1]] as const) {
      const ray = new THREE.Raycaster(new THREE.Vector3(x,y,z), new THREE.Vector3(0,dy,0));
      const a = ray.intersectObjects(before)[0]?.distance ?? null;
      expect(ray.intersectObjects(after)[0]?.distance ?? null).toEqual(a);
    }
  }
  for (const x of [1, 95]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x,10,40), new THREE.Vector3(x < 48 ? 1 : -1,0,0));
    expect(ray.intersectObjects(after)[0]?.distance).toEqual(ray.intersectObjects(before)[0]?.distance);
  }
});
