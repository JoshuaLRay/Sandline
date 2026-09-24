/**
 * Loads the generated period weapons (T-4.36) and provides them to
 * `weaponModels.ts`. Every `weapon-*` asset in the manifest is loaded once
 * and held for the page's life. Its material becomes Lambert (diffuse only,
 * T-2.32) with the atlas smoothly filtered, and every held model is a clone
 * sharing the one geometry and material.
 */
import * as THREE from 'three';
import { ASSET_MANIFEST } from '@sandline/shared';
import type { AssetLoader } from '../assets/loader.ts';
import { provideWeaponAssets } from './weaponModels.ts';

export async function loadWeaponAssets(loader: AssetLoader): Promise<number> {
  const ids = ASSET_MANIFEST.assets.filter((a) => a.class === 'weapon').map((a) => a.id);
  const loaded = new Map<string, THREE.Object3D>();
  await Promise.all(
    ids.map(async (id) => {
      const asset = await loader.load(id);
      if (asset.fallback) {
        asset.release();
        return;
      }
      asset.object.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const map = (o.material as THREE.MeshStandardMaterial).map;
        if (map) {
          map.magFilter = THREE.LinearFilter;
          map.minFilter = THREE.LinearMipmapLinearFilter;
          map.anisotropy = 4;
        }
        o.material = new THREE.MeshLambertMaterial({ map, name: id });
      });
      loaded.set(id, asset.object);
    }),
  );
  provideWeaponAssets(loaded);
  return loaded.size;
}
