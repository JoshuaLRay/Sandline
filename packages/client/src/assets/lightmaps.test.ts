import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bakeStaticPieceAo } from './lightmaps.ts';

function fixture(): {
  root: THREE.Group;
  floor: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
} {
  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff });

  // A horizontal quad reaches from 5 cm to 2 m away from an upright wall.
  // Its +Y hemisphere sees that wall at the near edge but not beyond the
  // bake radius at the far edge.
  const floor = new THREE.BufferGeometry();
  floor.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        0.05, 0, -0.5,
        2, 0, -0.5,
        2, 0, 0.5,
        0.05, 0, 0.5,
      ],
      3,
    ),
  );
  floor.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  floor.setIndex([0, 2, 1, 0, 3, 2]);
  root.add(new THREE.Mesh(floor, material));

  const wall = new THREE.BufferGeometry();
  wall.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        0, 0, -1,
        0, 1.5, -1,
        0, 1.5, 1,
        0, 0, 1,
      ],
      3,
    ),
  );
  wall.setAttribute('normal', new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
  wall.setIndex([0, 1, 2, 0, 2, 3]);
  root.add(new THREE.Mesh(wall, material));

  return { root, floor, material };
}

describe('static piece AO fallback (T-4.12)', () => {
  it('darkens a vertex beside an occluder more than one outside the bake radius', () => {
    const { root, floor, material } = fixture();
    const baked = bakeStaticPieceAo(root);
    const colour = floor.getAttribute('color');

    const near = (colour.getX(0) + colour.getX(3)) / 2;
    const far = (colour.getX(1) + colour.getX(2)) / 2;

    expect(baked.meshes).toBe(2);
    expect(baked.vertices).toBe(8);
    expect(near).toBeLessThan(far);
    expect(far).toBeGreaterThan(0.9);
    expect(material.vertexColors).toBe(true);
  });

  it('is idempotent on shared template geometry', () => {
    const { root, floor } = fixture();
    bakeStaticPieceAo(root);
    const first = floor.getAttribute('color');

    expect(bakeStaticPieceAo(root)).toEqual({ meshes: 0, vertices: 0 });
    expect(floor.getAttribute('color')).toBe(first);
  });
});
