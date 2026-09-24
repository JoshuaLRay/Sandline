/**
 * A level's kit pieces, drawn (T-4.10): each `World.pieces` entry loaded
 * through the asset loader (T-4.05), placed at its position and quarter turn
 * (`rotation.y` in radians, the level format's convention, T-4.09), and
 * released when the world changes. The pieces' collision boxes are still in
 * the scene, invisible, for aim convergence and the camera arm; this is only
 * what the eye sees.
 *
 * A world change while pieces are still loading is safe: each `show` bumps a
 * generation, and a load that finishes for an older one is released at once.
 */
import * as THREE from 'three';
import type { World } from '@sandline/shared';
import type { AssetLoader, LoadedAsset } from './loader.ts';

export class LevelPieces {
  private held: LoadedAsset[] = [];
  private labels: THREE.Sprite[] = [];
  private generation = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly loader: AssetLoader,
  ) {}

  /** Draws `world`'s pieces, replacing whatever was drawn; with `labels`, each piece's asset id floats over it. */
  async show(world: World, labels = false): Promise<void> {
    this.clear();
    const generation = ++this.generation;
    await Promise.all(
      world.pieces.map(async (p) => {
        const asset = await this.loader.load(p.piece);
        if (generation !== this.generation) {
          asset.release();
          return;
        }
        asset.object.position.set(p.x, p.y, p.z);
        asset.object.rotation.y = (p.rot * Math.PI) / 180;
        asset.object.traverse((o) => {
          o.castShadow = true;
          o.receiveShadow = true;
        });
        this.scene.add(asset.object);
        this.held.push(asset);
        if (labels) {
          const top = new THREE.Box3().setFromObject(asset.object).max.y;
          const sprite = label(p.rot ? `${p.piece} ${p.rot}°` : p.piece);
          sprite.position.set(p.x, Math.max(top, 0.5) + 0.5, p.z);
          this.scene.add(sprite);
          this.labels.push(sprite);
        }
      }),
    );
  }

  clear(): void {
    this.generation++;
    for (const a of this.held.splice(0)) a.release();
    for (const s of this.labels.splice(0)) {
      s.removeFromParent();
      s.material.map?.dispose();
      s.material.dispose();
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
