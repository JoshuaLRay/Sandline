import * as THREE from 'three';
import { MAX_SUPPLY_CACHES, type SupplyCacheDef } from '@sandline/shared';
import { supplyEmpty } from '../ui/supplyModel.ts';

/** Two shared draw calls for up to 64 host-owned boxes. Depletion never removes scenery. */
export class SupplyModels {
  private readonly body = new THREE.InstancedMesh(new THREE.BoxGeometry(.8, .45, .5),
    new THREE.MeshStandardMaterial({ color: 0x59684b, roughness: .9 }), MAX_SUPPLY_CACHES);
  private readonly lid = new THREE.InstancedMesh(new THREE.BoxGeometry(.86, .08, .56),
    new THREE.MeshStandardMaterial({ roughness: .85 }), MAX_SUPPLY_CACHES);
  private key = '';
  constructor(scene: THREE.Scene) {
    this.body.name = 'supply cache bodies'; this.lid.name = 'supply cache lids';
    this.body.count = this.lid.count = 0;
    this.body.castShadow = this.lid.castShadow = true;
    scene.add(this.body, this.lid);
  }
  update(caches: readonly SupplyCacheDef[]): void {
    const key = JSON.stringify(caches.map(cache => [cache.id, cache.feet, supplyEmpty(cache)]));
    if (key === this.key) return;
    this.key = key;
    this.body.count = this.lid.count = caches.length;
    const matrix = new THREE.Matrix4();
    caches.forEach((cache, i) => {
      const { x, y, z } = cache.feet;
      this.body.setMatrixAt(i, matrix.makeTranslation(x, y + .225, z));
      this.lid.setMatrixAt(i, matrix.makeTranslation(x, y + .49, z));
      this.lid.setColorAt(i, new THREE.Color(supplyEmpty(cache) ? 0x55594f : 0xc5aa67));
    });
    this.body.instanceMatrix.needsUpdate = this.lid.instanceMatrix.needsUpdate = true;
    if (this.lid.instanceColor) this.lid.instanceColor.needsUpdate = true;
    this.body.computeBoundingSphere(); this.lid.computeBoundingSphere();
  }
  clear(): void { this.update([]); }
  get count(): number { return this.body.count; }
}
