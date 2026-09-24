/**
 * Static level instancing (T-4.07).
 *
 * One loaded asset template becomes one InstancedMesh per source mesh and LOD
 * level. Every placement of that asset shares its geometry and material, while
 * the instance matrices carry the level file's position and quarter turn.
 *
 * LOD remains per placement: on update each placement is assigned a level from
 * its projected screen size and copied into that level's instance buffers.
 * This avoids the common batching bug where one nearby crate forces every far
 * crate in the same batch to use LOD0.
 */
import * as THREE from 'three';
import { availableLodLevel, lodLevelForScreenFraction, lodLevelOf, screenFractionForSphere } from './lod.ts';

export interface InstancePlacement {
  x: number;
  y: number;
  z: number;
  rot: number;
}

interface SourceMesh {
  level: number;
  local: THREE.Matrix4;
  instance: THREE.InstancedMesh;
}

export interface InstancedAsset {
  readonly object: THREE.Group;
  /** Reassign placement matrices to LOD instance buffers for this camera. */
  update(camera: THREE.PerspectiveCamera): void;
  /** Placement count at each LOD after the last update; useful to the probe. */
  counts(): readonly number[];
  /** Removes the batch and releases only its own instance-side GPU state. */
  dispose(): void;
}

const unitScale = new THREE.Vector3(1, 1, 1);
const yAxis = new THREE.Vector3(0, 1, 0);

/** Build a static batch from one loader clone and every placement of its id. */
export function instanceAsset(
  template: THREE.Object3D,
  placements: readonly InstancePlacement[],
  declaredLods: number,
): InstancedAsset {
  template.updateMatrixWorld(true);
  const rootInverse = template.matrixWorld.clone().invert();
  const sources: SourceMesh[] = [];
  const available = new Set<number>();

  template.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object instanceof THREE.SkinnedMesh) {
      throw new Error(`asset '${template.name || '(unnamed)'}' is skinned; level pieces must be static`);
    }
    const level = lodLevelOf(object, template);
    available.add(level);
    const local = rootInverse.clone().multiply(object.matrixWorld);
    const instance = new THREE.InstancedMesh(object.geometry, object.material, placements.length);
    instance.name = `instances:${template.name || 'asset'}:${object.name || 'mesh'}`;
    instance.count = 0;
    instance.castShadow = object.castShadow;
    instance.receiveShadow = object.receiveShadow;
    instance.renderOrder = object.renderOrder;
    instance.layers.mask = object.layers.mask;
    // A level-sized batch spans many frustum cells. Three culls InstancedMesh
    // as one aggregate anyway; keeping it uncullable avoids rebuilding a
    // bounding sphere each time placements move between LOD buffers.
    instance.frustumCulled = false;
    instance.userData['lodLevel'] = level;
    sources.push({ level, local, instance });
  });

  const object = new THREE.Group();
  object.name = `instances:${template.name || 'asset'}`;
  for (const source of sources) object.add(source.instance);

  const placementMatrices = placements.map((placement) => {
    const quaternion = new THREE.Quaternion().setFromAxisAngle(yAxis, THREE.MathUtils.degToRad(placement.rot));
    return new THREE.Matrix4().compose(new THREE.Vector3(placement.x, placement.y, placement.z), quaternion, unitScale);
  });

  // Bounds in template-root space. Generated level pieces have no root scale,
  // and placement itself is translation + yaw only, so one radius serves all.
  const box = new THREE.Box3().setFromObject(template);
  const rootCentreWorld = box.getCenter(new THREE.Vector3());
  const centre = rootCentreWorld.applyMatrix4(rootInverse);
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
  const centres = placementMatrices.map((matrix) => centre.clone().applyMatrix4(matrix));
  const levels = Math.max(1, Math.floor(declaredLods), ...[...available].map((level) => level + 1));
  const availableLevels = [...available].sort((a, b) => a - b);
  const countsByLevel = new Array<number>(levels).fill(0);
  const cameraPosition = new THREE.Vector3();
  const composed = new THREE.Matrix4();

  function update(camera: THREE.PerspectiveCamera): void {
    camera.getWorldPosition(cameraPosition);
    const byLevel: number[][] = Array.from({ length: levels }, () => []);
    for (let i = 0; i < centres.length; i += 1) {
      const distance = cameraPosition.distanceTo(centres[i]!);
      const fraction = screenFractionForSphere(radius, distance, camera.fov);
      const wanted = lodLevelForScreenFraction(fraction, levels);
      const level = availableLodLevel(wanted, availableLevels);
      byLevel[level]!.push(i);
    }

    countsByLevel.fill(0);
    for (let level = 0; level < levels; level += 1) countsByLevel[level] = byLevel[level]!.length;

    for (const source of sources) {
      const selected = byLevel[source.level] ?? [];
      source.instance.count = selected.length;
      for (let slot = 0; slot < selected.length; slot += 1) {
        composed.multiplyMatrices(placementMatrices[selected[slot]!]!, source.local);
        source.instance.setMatrixAt(slot, composed);
      }
      source.instance.instanceMatrix.needsUpdate = true;
    }
  }

  return {
    object,
    update,
    counts: () => countsByLevel,
    dispose(): void {
      object.removeFromParent();
      for (const source of sources) {
        const disposable = source.instance as THREE.InstancedMesh & { dispose?: () => void };
        disposable.dispose?.();
      }
    },
  };
}
