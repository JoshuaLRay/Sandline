/**
 * T-4.07 draw-call probe. Chromium/SwiftShader is deterministic enough for
 * renderer.info.render.calls to be a CI gate. The production kit-authored
 * mission and a deliberately dense synthetic field both fly a small camera
 * path and must stay below ADR-013's 300 draw calls per frame.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { requireWorld } from '@sandline/shared';
import { instanceAsset } from './instances.ts';
import { LevelPieces } from './levelPieces.ts';
import { AssetLoader, gltfParser } from './loader.ts';

const DRAW_CALL_BUDGET = 300;

function renderer(): THREE.WebGLRenderer {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const renderer = new THREE.WebGLRenderer({ canvas });
  renderer.setSize(960, 540, false);
  return renderer;
}

function camera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(60, 960 / 540, 0.1, 250);
}

function fly(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  points: readonly { at: readonly [number, number, number]; look: readonly [number, number, number] }[],
  update: () => void,
): { calls: number; triangles: number } {
  let calls = 0;
  let triangles = 0;
  for (const point of points) {
    camera.position.set(...point.at);
    camera.lookAt(...point.look);
    camera.updateMatrixWorld(true);
    update();
    renderer.render(scene, camera);
    calls = Math.max(calls, renderer.info.render.calls);
    triangles = Math.max(triangles, renderer.info.render.triangles);
  }
  return { calls, triangles };
}

describe('draw-call budget (T-4.07)', () => {
  it('keeps the T-4.13 kit-authored mission below 300 calls along a camera path', { timeout: 120_000 }, async () => {
    const draw = renderer();
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
    const view = camera();
    const warnings: string[] = [];
    const loader = new AssetLoader({
      baseUrl: '/',
      renderer: draw,
      parse: gltfParser({ renderer: draw, transcoderPath: new URL('../../node_modules/three/examples/jsm/libs/basis/', import.meta.url).href }),
      warn: (message) => warnings.push(message),
    });
    const pieces = new LevelPieces(scene, loader);
    await pieces.show(requireWorld('mission-01'));

    const peak = fly(
      draw,
      scene,
      view,
      [
        { at: [0, 2, -8], look: [0, 1, 24] },
        { at: [-20, 4, 28], look: [-12, 1, 55] },
        { at: [20, 4, 45], look: [8, 1, 75] },
        { at: [0, 8, 72], look: [0, 1, 88] },
      ],
      () => pieces.update(view),
    );
    console.log(`draw budget mission-01: max ${peak.calls} calls, ${peak.triangles} triangles`);
    expect(warnings).toEqual([]);
    expect(peak.calls).toBeGreaterThan(0);
    expect(peak.calls).toBeLessThan(DRAW_CALL_BUDGET);

    pieces.clear();
    draw.dispose();
  });

  it('keeps 1,200 repeated two-LOD props below 300 calls', () => {
    const draw = renderer();
    const scene = new THREE.Scene();
    const view = camera();
    const material = new THREE.MeshBasicMaterial();
    const highGeometry = new THREE.BoxGeometry(1.5, 1.5, 1.5, 2, 2, 2);
    const lowGeometry = new THREE.PlaneGeometry(1.5, 1.5);
    const source = new THREE.Group();
    source.name = 'synthetic-prop';
    source.add(new THREE.Mesh(highGeometry, material));
    const far = new THREE.Group();
    far.name = 'synthetic-prop_LOD1';
    far.add(new THREE.Mesh(lowGeometry, material));
    source.add(far);

    const placements = Array.from({ length: 1200 }, (_, i) => ({
      x: (i % 40) * 1.8 - 36,
      y: 0.75,
      z: -4 - Math.floor(i / 40) * 2.2,
      rot: (i % 4) * 90,
    }));
    const batch = instanceAsset(source, placements, 2);
    scene.add(batch.object);
    const peak = fly(
      draw,
      scene,
      view,
      [
        { at: [0, 3, 3], look: [0, 1, -30] },
        { at: [-20, 5, -20], look: [0, 1, -45] },
        { at: [20, 7, -50], look: [0, 1, -60] },
      ],
      () => batch.update(view),
    );
    const counts = batch.counts();
    console.log(`draw budget synthetic: max ${peak.calls} calls, ${peak.triangles} triangles; LOD counts ${counts.join('/')}`);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(placements.length);
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[1]).toBeGreaterThan(0);
    expect(peak.calls).toBeGreaterThan(0);
    expect(peak.calls).toBeLessThan(DRAW_CALL_BUDGET);

    batch.dispose();
    highGeometry.dispose();
    lowGeometry.dispose();
    material.dispose();
    draw.dispose();
  });
});
