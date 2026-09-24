import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { availableLodLevel, lodLevelForScreenFraction, lodLevelOf, screenFractionForSphere } from './lod.ts';

describe('screen-size LOD selection (T-4.07)', () => {
  it('keeps one-level assets at LOD0 and walks farther levels as screen size halves', () => {
    expect(lodLevelForScreenFraction(0.001, 1)).toBe(0);
    expect(lodLevelForScreenFraction(0.2, 3)).toBe(0);
    expect(lodLevelForScreenFraction(0.1, 3)).toBe(1);
    expect(lodLevelForScreenFraction(0.05, 3)).toBe(2);
  });

  it('responds to perspective screen size rather than a fixed world distance', () => {
    const narrow = screenFractionForSphere(1, 20, 40);
    const wide = screenFractionForSphere(1, 20, 90);
    expect(narrow).toBeGreaterThan(wide);
    expect(screenFractionForSphere(1, 10, 60)).toBeGreaterThan(screenFractionForSphere(1, 30, 60));
  });

  it('reads a _LOD suffix from a mesh or its ancestor and falls back across a missing level', () => {
    const root = new THREE.Group();
    const near = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    near.name = 'crate';
    const farRoot = new THREE.Group();
    farRoot.name = 'crate_LOD2';
    const far = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
    farRoot.add(far);
    root.add(near, farRoot);
    expect(lodLevelOf(near, root)).toBe(0);
    expect(lodLevelOf(far, root)).toBe(2);
    expect(availableLodLevel(1, [0, 2])).toBe(0);
    expect(availableLodLevel(2, [0, 2])).toBe(2);
  });
});
