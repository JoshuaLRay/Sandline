/**
 * A level's kit pieces, drawn through the asset loader (T-4.10) and batched
 * by asset id (T-4.07). Every id is loaded once; all of its placements are
 * static InstancedMeshes sharing the loader template's geometry and material.
 * LOD is refreshed from projected screen size immediately before each frame.
 *
 * A world change while pieces are still loading is safe: each `show` bumps a
 * generation, and a load that finishes for an older one is released at once.
 */
import * as THREE from 'three';
import type { PlacedPiece, World } from '@sandline/shared';
import { instanceAsset, type InstancedAsset } from './instances.ts';
import type { AssetLoader, LoadedAsset } from './loader.ts';

export class LevelPieces {
  private held: LoadedAsset[] = [];
  private batches: InstancedAsset[] = [];
  private labels: THREE.Sprite[] = [];
  private generation = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly loader: AssetLoader,
  ) {}

  /** Draws `world`'s pieces, replacing whatever was drawn; with `labels`, each placement's asset id floats over it. */
  async show(world: World, labels = false): Promise<void> {
    this.clear();
    const generation = ++this.generation;
    const byAsset = new Map<string, PlacedPiece[]>();
    for (const piece of world.pieces) {
      const list = byAsset.get(piece.piece);
      if (list) list.push(piece);
      else byAsset.set(piece.piece, [piece]);
    }

    await Promise.all(
      [...byAsset].map(async ([id, placements]) => {
        const asset = await this.loader.load(id);
        if (generation !== this.generation) {
          asset.release();
          return;
        }

        asset.object.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.castShadow = true;
          object.receiveShadow = true;
        });

        const top = labels ? new THREE.Box3().setFromObject(asset.object).max.y : 0;
        const batch = instanceAsset(asset.object, placements, this.loader.manifestEntry(id)?.lods ?? 1);
        this.scene.add(batch.object);
        this.held.push(asset);
        this.batches.push(batch);

        if (labels) {
          for (const piece of placements) {
            const sprite = label(piece.rot ? `${piece.piece} ${piece.rot}°` : piece.piece);
            sprite.position.set(piece.x, piece.y + Math.max(top, 0.5) + 0.5, piece.z);
            this.scene.add(sprite);
            this.labels.push(sprite);
          }
        }
      }),
    );
  }

  /** Reassign each placement to the LOD appropriate to this frame's camera. */
  update(camera: THREE.PerspectiveCamera): void {
    for (const batch of this.batches) batch.update(camera);
  }

  clear(): void {
    this.generation++;
    for (const batch of this.batches.splice(0)) batch.dispose();
    for (const asset of this.held.splice(0)) asset.release();
    for (const sprite of this.labels.splice(0)) {
      sprite.removeFromParent();
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }
  }
}

/** A text label that always faces the camera. */
function label(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(20, 18, 14, 0.7)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f0e6cc';
  ctx.font = '32px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: true }));
  sprite.scale.set(2.4, 0.3, 1);
  return sprite;
}
