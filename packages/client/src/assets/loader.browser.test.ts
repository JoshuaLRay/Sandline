/**
 * The asset loader in a real browser with a real WebGL2 context (T-4.05):
 * the committed soldier through three's GLTFLoader, meshopt and KTX2 decoders,
 * drawn, then released — and the renderer's memory counters back where they
 * started. Headless Chromium draws with SwiftShader, so this runs in CI.
 * Run with `pnpm test:parity-browsers` (the `assets-browsers` project).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ASSET_MANIFEST } from '@sandline/shared';
import { AssetLoader, gltfParser } from './loader.ts';
import { loadDetailedSkin, provideDetailedSkin } from '../character/assetSoldier.ts';
import { HUMANOID_HIT_RADIUS } from '../character/humanoidPlaceholder.ts';
import { createHumanoidSoldier, setSoldierPalette, soldierSkin } from '../character/humanoidSoldier.ts';

describe('the asset loader on a GPU (T-4.05)', () => {
  it('loads the soldier with its decoders, draws it, and gives the memory back', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const renderer = new THREE.WebGLRenderer({ canvas });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 1, 4);
    scene.add(new THREE.AmbientLight());
    // Warm-up: the first standard material a renderer draws makes its DFG
    // lookup table, which the renderer keeps for its lifetime. That is the
    // renderer's, not the asset's, so it belongs in the baseline.
    const warm = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    scene.add(warm);
    renderer.render(scene, camera);
    warm.removeFromParent();
    warm.geometry.dispose();
    warm.material.dispose();
    renderer.render(scene, camera);
    const before = { ...renderer.info.memory };

    const warnings: string[] = [];
    const loader = new AssetLoader({
      baseUrl: '/',
      renderer,
      // The test runner pre-bundles three, which moves the loader away from the
      // transcoder its default path is relative to; the page's build does not.
      parse: gltfParser({ renderer, transcoderPath: new URL('../../node_modules/three/examples/jsm/libs/basis/', import.meta.url).href }),
      warn: (m) => warnings.push(m),
    });
    const a = await loader.load('soldier');
    const b = await loader.load('soldier');
    expect(warnings).toEqual([]);
    expect(a.fallback).toBe(false);
    const skin = a.object.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh;
    expect(skin.skeleton.bones.length).toBe(17);
    const map = (skin.material as THREE.MeshStandardMaterial).map!;
    expect((map as THREE.CompressedTexture).isCompressedTexture).toBe(true);
    scene.add(a.object, b.object);
    renderer.render(scene, camera);
    const loaded = { ...renderer.info.memory };
    expect(loaded.geometries).toBeGreaterThan(before.geometries);
    expect(loaded.textures).toBeGreaterThan(before.textures);

    a.release();
    renderer.render(scene, camera);
    // One use gone: its own skeleton's bone texture with it, and nothing
    // shared — the geometry and the atlas stay for the other.
    expect(renderer.info.memory).toEqual({ geometries: loaded.geometries, textures: loaded.textures - 1 });
    b.release();
    renderer.render(scene, camera);
    console.log(`memory before ${JSON.stringify(before)}, loaded ${JSON.stringify(loaded)}, after ${JSON.stringify(renderer.info.memory)}`);
    expect(renderer.info.memory).toEqual(before);
    renderer.dispose();
  });

  it('loads the detailed soldier and puts it on a live rig, in model space after dequantizing (T-4.08)', async () => {
    const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });
    const loader = new AssetLoader({
      baseUrl: '/',
      parse: gltfParser({ renderer, transcoderPath: new URL('../../node_modules/three/examples/jsm/libs/basis/', import.meta.url).href }),
    });
    const skin = await loadDetailedSkin(loader);
    expect(skin).not.toBeNull();
    const entry = ASSET_MANIFEST.assets.find((a) => a.id === 'soldier-dcu')!;
    expect(skin!.geometry.index!.count / 3).toBe(entry.triangles);
    expect(skin!.geometry.groups.map((g) => g.materialIndex)).toEqual([0, 1]);
    // Positions are back in the rig's model space: feet on the ground, helmet at 1.9 m, inside the capsule.
    const p = skin!.geometry.getAttribute('position');
    let minY = Infinity;
    let maxY = -Infinity;
    let radius = 0;
    for (let i = 0; i < p.count; i++) {
      minY = Math.min(minY, p.getY(i));
      maxY = Math.max(maxY, p.getY(i));
      radius = Math.max(radius, Math.hypot(p.getX(i), p.getZ(i)));
    }
    expect(minY).toBeCloseTo(0, 2);
    expect(maxY).toBeGreaterThan(1.88);
    expect(radius).toBeLessThanOrEqual(HUMANOID_HIT_RADIUS + 0.002);
    expect((skin!.material.map as THREE.CompressedTexture).isCompressedTexture).toBe(true);
    expect(skin!.material.map!.magFilter).toBe(THREE.LinearFilter);
    const soldier = createHumanoidSoldier('local');
    setSoldierPalette(soldier, 'slot-2');
    expect(soldierSkin(soldier).geometry).toBe(skin!.geometry);
    const scene = new THREE.Scene();
    scene.add(soldier);
    renderer.render(scene, new THREE.PerspectiveCamera());
    provideDetailedSkin(null);
    renderer.dispose();
  });
});
