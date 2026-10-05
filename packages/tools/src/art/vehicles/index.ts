/**
 * Every generated vehicle as the glTF source `pnpm gen:art` writes (U-126): `assets/src/vehicle-<archetype>.glb`.
 * One material on the vehicle atlas, smoothly filtered, `sandline.class: vehicle`. The hull is the root node, in
 * the archetype's frame (origin at its feet, +Z forward). The turret is its child node `turret`, placed at its
 * pivot, so the page turns it with one rotation. The turret mesh's furthest point forward is the drawn muzzle,
 * where the page puts the flash.
 *
 * `turret` is a bare pivot, and its mesh hangs under it as `turret-mesh`. The pipeline quantizes geometry: it
 * gives a mesh's node a scale and offset that decode the positions, and moves a mesh off any node that has
 * children. A mesh on the pivot itself would lose the pivot to that offset and turn about the wrong point.
 */
import { Document } from '@gltf-transform/core';
import { getEnemy } from '@sandline/shared';
import { vehicleAtlasPng } from './atlas.ts';
import type { BuiltMesh } from './mesh.ts';
import { type TankMeshes, buildTank } from './tank.ts';

const LINEAR = 9729;
const LINEAR_MIPMAP_LINEAR = 9987;
const CLAMP_TO_EDGE = 33071;

export const TURRET_NODE = 'turret';

export function vehicleDocument(id: string, tank: TankMeshes, atlas: Uint8Array): Document {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene(id).setExtras({ sandline: { class: 'vehicle' } });
  doc.getRoot().setDefaultScene(scene);
  const texture = doc.createTexture('vehicle atlas').setMimeType('image/png').setImage(atlas);
  const material = doc.createMaterial('vehicle').setBaseColorTexture(texture).setMetallicFactor(0).setRoughnessFactor(1);
  material.getBaseColorTextureInfo()!.setMagFilter(LINEAR).setMinFilter(LINEAR_MIPMAP_LINEAR).setWrapS(CLAMP_TO_EDGE).setWrapT(CLAMP_TO_EDGE);
  const mesh = (name: string, m: BuiltMesh) => {
    const acc = (what: string, type: 'VEC2' | 'VEC3' | 'SCALAR', a: Float32Array | Uint16Array | Uint32Array) => doc.createAccessor(`${name} ${what}`).setType(type).setArray(a);
    const indices = m.positions.length / 3 > 65535 ? new Uint32Array(m.indices) : new Uint16Array(m.indices);
    const primitive = doc
      .createPrimitive()
      .setMaterial(material)
      .setAttribute('POSITION', acc('position', 'VEC3', new Float32Array(m.positions)))
      .setAttribute('NORMAL', acc('normal', 'VEC3', new Float32Array(m.normals)))
      .setAttribute('TEXCOORD_0', acc('uv', 'VEC2', new Float32Array(m.uvs)))
      .setIndices(acc('indices', 'SCALAR', indices));
    return doc.createMesh(name).addPrimitive(primitive);
  };
  const turret = doc
    .createNode(TURRET_NODE)
    .setTranslation([...tank.pivot])
    .addChild(doc.createNode(`${TURRET_NODE}-mesh`).setMesh(mesh(TURRET_NODE, tank.turret)));
  const hull = doc.createNode(id).setMesh(mesh(id, tank.hull)).addChild(turret);
  scene.addChild(hull);
  return doc;
}

/** The vehicle archetypes that have a model: each `enemies.json` row with a `vehicle` block is drawn from one. */
export const VEHICLE_ARCHETYPES: readonly string[] = ['tank'];

export function vehicleDocuments(): { id: string; document(): Document }[] {
  return VEHICLE_ARCHETYPES.map((archetype) => ({
    id: `vehicle-${archetype}`,
    document: () => {
      const tank = buildTank(getEnemy(archetype));
      return vehicleDocument(`vehicle-${archetype}`, tank, vehicleAtlasPng({ x: tank.pivot[0], z: tank.pivot[2], r: tank.domeRadius }));
    },
  }));
}
