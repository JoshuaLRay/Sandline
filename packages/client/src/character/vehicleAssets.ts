/**
 * Loads the generated vehicles (U-126) and provides them to `tankModel.ts`. Every `vehicle` asset in the manifest
 * is loaded once (it is in the initial pack) and held for the page's life. As with the weapons
 * (`weapons/weaponAssets.ts`), its material becomes Lambert (diffuse only, T-2.32) with the atlas smoothly
 * filtered, and every tank drawn is a clone sharing the one geometry and material. An asset that fails to load
 * provides nothing, and the tank keeps its code-built stand-in.
 */
import * as THREE from 'three';
import { ASSET_MANIFEST } from '@sandline/shared';
import type { AssetLoader } from '../assets/loader.ts';
import { provideVehicleAssets } from './tankModel.ts';

export async function loadVehicleAssets(loader: Pick<AssetLoader, 'load'>, manifest = ASSET_MANIFEST): Promise<number> {
  const ids = manifest.assets.filter((a) => a.class === 'vehicle').map((a) => a.id);
  const loaded = new Map<string, THREE.Object3D>();
  await Promise.all(
    ids.map(async (id) => {
      const asset = await loader.load(id);
      if (asset.fallback) {
        asset.release();
        return;
      }
      // The hull and the turret share one material in the file; they share one here too.
      const lambert = new Map<THREE.Material, THREE.MeshLambertMaterial>();
      asset.object.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const source = o.material as THREE.MeshStandardMaterial;
        let material = lambert.get(source);
        if (!material) {
          const map = source.map;
          if (map) {
            map.magFilter = THREE.LinearFilter;
            map.minFilter = THREE.LinearMipmapLinearFilter;
            map.anisotropy = 4;
          }
          material = new THREE.MeshLambertMaterial({ map, name: id });
          lambert.set(source, material);
        }
        o.material = material;
      });
      loaded.set(id, asset.object);
    }),
  );
  provideVehicleAssets(loaded);
  return loaded.size;
}
