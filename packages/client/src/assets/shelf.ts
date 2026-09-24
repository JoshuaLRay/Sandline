/**
 * `?assets` (T-4.05): every asset in the manifest, loaded through the real
 * loader and decoders and stood in a row behind the spawn line, so the
 * pipeline can be checked on the deployed site. Turn round from the spawn:
 * the row is at z = −10, facing the line. A grey box in the row is an
 * asset that did not load, and the console says why.
 */
import * as THREE from 'three';
import { ASSET_MANIFEST } from '@sandline/shared';
import { AssetLoader, type LoadedAsset, gltfParser } from './loader.ts';

const SHELF_Z = -10;
const SPACING_M = 1.5;

export async function showAssetShelf(scene: THREE.Scene, renderer: THREE.WebGLRenderer): Promise<LoadedAsset[]> {
  const loader = new AssetLoader({ renderer, parse: gltfParser({ renderer }) });
  const ids = ASSET_MANIFEST.assets.map((a) => a.id);
  const loaded = await Promise.all(ids.map((id) => loader.load(id)));
  const first = -((ids.length - 1) * SPACING_M) / 2;
  loaded.forEach((asset, i) => {
    asset.object.position.set(first + i * SPACING_M, 0, SHELF_Z);
    asset.object.traverse((o) => {
      o.castShadow = true;
      // A skinned mesh in bind pose never moves its bounds; culling it by
      // the rest pose is right here, and a loaded asset has no stale box.
      if (o instanceof THREE.SkinnedMesh) o.frustumCulled = false;
    });
    scene.add(asset.object);
  });
  console.info(`?assets: ${loaded.map((a) => `${a.id}${a.fallback ? ' (grey box)' : ''}`).join(', ')}`);
  return loaded;
}
