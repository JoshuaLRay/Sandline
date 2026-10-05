/**
 * U-123: picking an order on screen keeps the floor pointed at. Real three.js
 * raycasts against meshes built from the same boxes the pick's feet are found
 * on: ground y0, a slab y5.5..8, a bridge y14..16, all over x/z (0, 0).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { boxFrom, type WorldBox } from '@sandline/shared';
import { PICK_FALLBACK_M, pickFeet, pickOrder, screenRay } from './orderPick.ts';

const specs = [
  { id: 'surface', x: 0, y: 5.5, z: 0, w: 16, d: 16, h: 2.5 },
  { id: 'bridge', x: 0, y: 14, z: 0, w: 10, d: 10, h: 2 },
  { id: 'wall', x: 6, y: 8, z: 0, w: 0.3, d: 4, h: 3 },
];
const boxes: WorldBox[] = specs.map((s) => boxFrom(s, 'cover'));
const world = { boxes, groundY: 0 };

function stackedScene(): THREE.Object3D[] {
  const meshes: THREE.Object3D[] = specs.map((s) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d));
    mesh.position.set(s.x, s.y + s.h / 2, s.z);
    mesh.updateMatrixWorld();
    return mesh;
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2));
  ground.updateMatrixWorld();
  return [...meshes, ground];
}

function along(from: THREE.Vector3, to: THREE.Vector3): THREE.Raycaster {
  const ray = new THREE.Raycaster(from, to.clone().sub(from).normalize());
  ray.far = 300;
  return ray;
}

describe('order picks (U-123)', () => {
  const scene = stackedScene();

  it('sends identical x/z at y0, y8 and y16 as three floors, from where each can be seen', () => {
    const target = (y: number) => new THREE.Vector3(0, y, 0);
    // From the basement, from the deck under the bridge, and from above the bridge.
    expect(pickOrder(along(new THREE.Vector3(-6, 1.6, 0), target(0)), scene, undefined, world).feet.y).toBe(0);
    expect(pickOrder(along(new THREE.Vector3(-6, 9.6, 0), target(8)), scene, undefined, world).feet.y).toBe(8);
    expect(pickOrder(along(new THREE.Vector3(-6, 22, 0), target(16)), scene, undefined, world).feet.y).toBe(16);
  });

  it('sends a wall’s face to its foot and a ceiling to the floor beneath, keeping the hit for a mark', () => {
    const wall = pickOrder(along(new THREE.Vector3(0, 9.6, 0), new THREE.Vector3(5.85, 10, 0)), scene, undefined, world);
    expect(wall.point.y).toBeGreaterThan(9);
    expect(wall.feet.y).toBe(8);
    const ceiling = pickOrder(along(new THREE.Vector3(-3, 1.6, 0), new THREE.Vector3(2, 5.5, 0)), scene, undefined, world);
    expect(ceiling.point.y).toBeCloseTo(5.5, 5);
    expect(ceiling.feet.y).toBe(0);
    const bridgeUnderside = pickOrder(along(new THREE.Vector3(-3, 9.6, 0), new THREE.Vector3(2, 14, 0)), scene, undefined, world);
    expect(bridgeUnderside.feet.y).toBe(8);
  });

  it('ignores the viewer’s own body and falls back near, on the floor under the ray, no higher than the eye', () => {
    const body = scene[0]!;
    const through = pickOrder(along(new THREE.Vector3(-20, 1.6, 0), new THREE.Vector3(0, 1, 0)), scene, body, world);
    expect(through.object).not.toBe(body);
    // A ray that met nothing: the floor under a point PICK_FALLBACK_M along it, looked for from no higher than the eye.
    const level = pickFeet(null, { x: -25, y: 9.6, z: 0 }, { x: 1, y: 0, z: 0 }, world);
    expect(level.x).toBeCloseTo(-25 + PICK_FALLBACK_M, 9);
    expect(level.y).toBe(8);
    // Upward, over the deck and under the bridge: the deck, not the bridge overhead or the ground beneath.
    const sky = { x: 1, y: 0.2, z: 0 };
    expect(pickFeet(null, { x: -25, y: 9.6, z: 0 }, sky, world)).toMatchObject({ y: 8 });
    // The same tap carried past the deck's edge: the ground.
    expect(pickFeet(null, { x: -14, y: 9.6, z: 0 }, sky, world)).toMatchObject({ y: 0 });
    const empty = pickOrder(along(new THREE.Vector3(-25, 9.6, 0), new THREE.Vector3(5, 40, 0)), [], undefined, world);
    expect(empty.object).toBeNull();
    expect(empty.point).toEqual(empty.feet);
  });

  it('casts a screen tap from the camera through that pixel', () => {
    const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 500);
    camera.position.set(0, 30, 0.001);
    camera.lookAt(0, 0, 0);
    const rect = { left: 10, top: 20, width: 400, height: 200 };
    const centre = pickOrder(screenRay(camera, rect, 210, 120, 300), scene, undefined, world);
    expect(centre.feet.y).toBe(16);
    expect(Math.hypot(centre.feet.x, centre.feet.z)).toBeLessThan(0.1);
  });
});
