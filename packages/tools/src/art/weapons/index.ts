/**
 * Every generated weapon as the glTF source `pnpm gen:art` writes (T-4.36):
 * `assets/src/weapon-<key>.glb`, one mesh in aim space, one material on the
 * shared weapons atlas, smoothly filtered, `sandline.class: weapon`.
 */
import { Document } from '@gltf-transform/core';
import { weaponAtlasPng } from './atlas.ts';
import type { BuiltMesh } from './mesh.ts';
import { WEAPONS, buildWeapon } from './weapons.ts';

const LINEAR = 9729;
const LINEAR_MIPMAP_LINEAR = 9987;
const CLAMP_TO_EDGE = 33071;

export function weaponDocument(key: string, mesh: BuiltMesh, atlas: Uint8Array): Document {
  const id = `weapon-${key}`;
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene(id).setExtras({ sandline: { class: 'weapon' } });
  doc.getRoot().setDefaultScene(scene);
  const texture = doc.createTexture('weapons atlas').setMimeType('image/png').setImage(atlas);
  const material = doc.createMaterial('weapons').setBaseColorTexture(texture).setMetallicFactor(0).setRoughnessFactor(1);
  material.getBaseColorTextureInfo()!.setMagFilter(LINEAR).setMinFilter(LINEAR_MIPMAP_LINEAR).setWrapS(CLAMP_TO_EDGE).setWrapT(CLAMP_TO_EDGE);
  const acc = (name: string, type: 'VEC2' | 'VEC3' | 'SCALAR', a: Float32Array | Uint16Array) => doc.createAccessor(name).setType(type).setArray(a);
  const prim = doc
    .createPrimitive()
    .setMaterial(material)
    .setAttribute('POSITION', acc('position', 'VEC3', new Float32Array(mesh.positions)))
    .setAttribute('NORMAL', acc('normal', 'VEC3', new Float32Array(mesh.normals)))
    .setAttribute('TEXCOORD_0', acc('uv', 'VEC2', new Float32Array(mesh.uvs)))
    .setIndices(acc('indices', 'SCALAR', new Uint16Array(mesh.indices)));
  scene.addChild(doc.createNode(id).setMesh(doc.createMesh(id).addPrimitive(prim)));
  return doc;
}

export const WEAPON_KEYS: readonly string[] = Object.keys(WEAPONS);

export function weaponDocuments(): { id: string; document(): Document }[] {
  return WEAPON_KEYS.map((key) => ({ id: `weapon-${key}`, document: () => weaponDocument(key, buildWeapon(key), weaponAtlasPng()) }));
}
