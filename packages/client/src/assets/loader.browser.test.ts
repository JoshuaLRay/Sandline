/**
 * The asset loader in a real browser with a real WebGL2 context (T-4.05):
 * the committed soldier through three's GLTFLoader, meshopt and KTX2 decoders,
 * drawn, then released — and the renderer's memory counters back where they
 * started. Headless Chromium draws with SwiftShader, so this runs in CI.
 * Run with `pnpm test:parity-browsers` (the `assets-browsers` project).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AssetLoader, gltfParser } from './loader.ts';

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
});
