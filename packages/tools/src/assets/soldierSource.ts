/**
 * The pipeline's first input (T-4.02): the code-built soldier (T-2.22),
 * written out as a glTF the way any other tool would hand one over.
 *
 * `pnpm gen:assets` must not care what made its inputs, so the test asset is
 * the one thing in the game that already looks like an asset: one skinned
 * mesh, its 17-bone rig, one material and the generated atlas (T-2.35).
 * This writes `assets/src/soldier.glb` once and the file is committed as an
 * input; the soldier in the page is still the code (until T-4.08).
 *
 * What is written, and what is not:
 *   - the skin in model space, feet at y = 0, facing +Z (the rig's frame);
 *   - the bones as nodes in `HUMANOID_BONES` order, each at its joint, with
 *     an inverse bind matrix that is the negated joint (the bind pose is
 *     the identity, humanoidSoldier.ts);
 *   - the 'local' palette's atlas as a PNG, point-sampled;
 *   - the material as metal/rough, fully rough and not metallic, which is
 *     the nearest glTF has to the page's Lambert (the loader chooses);
 *   - NOT the rifle, which belongs to the held item (weaponModels.ts), and
 *     NOT the invisible hit capsule, which is the server's.
 *
 * Run: pnpm export:soldier
 */
import { Document, type Node } from '@gltf-transform/core';
import { PNG } from 'pngjs';
import * as THREE from 'three';
import { HUMANOID_BONES } from '../../../client/src/character/humanoidRig.ts';
import { createHumanoidSoldier, soldierSkin } from '../../../client/src/character/humanoidSoldier.ts';
import { ATLAS_SIZE, PALETTES, paintSoldierAtlas } from '../../../client/src/character/soldierTexture.ts';

const NEAREST = 9728;
const NEAREST_MIPMAP_LINEAR = 9986;
const CLAMP_TO_EDGE = 33071;

/** The atlas as a PNG, rows in the order the page uploads them (flipY false both sides). */
export function soldierAtlasPng(): Uint8Array {
  const png = new PNG({ width: ATLAS_SIZE, height: ATLAS_SIZE });
  png.data = Buffer.from(paintSoldierAtlas(PALETTES.local));
  return new Uint8Array(PNG.sync.write(png));
}

export function soldierSourceDocument(): Document {
  const root = createHumanoidSoldier('local');
  const skin = soldierSkin(root);
  const geometry = skin.geometry;

  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene('soldier').setExtras({ sandline: { class: 'character' } });
  doc.getRoot().setDefaultScene(scene);

  // -- The rig: one node per bone, at its joint relative to its parent. --
  const byBone = new Map<THREE.Bone, Node>();
  const modelSpace = new Map<THREE.Bone, THREE.Vector3>();
  for (const bone of skin.skeleton.bones) {
    const node = doc.createNode(bone.name).setTranslation([bone.position.x, bone.position.y, bone.position.z]);
    byBone.set(bone, node);
    const parent = bone.parent instanceof THREE.Bone ? bone.parent : null;
    modelSpace.set(bone, parent ? modelSpace.get(parent)!.clone().add(bone.position) : bone.position.clone());
    if (parent) byBone.get(parent)!.addChild(node);
    else scene.addChild(node);
  }
  const ordered = HUMANOID_BONES.map((name) => {
    const bone = skin.skeleton.bones.find((b) => b.name === name);
    if (!bone) throw new Error(`soldier has no bone '${name}'`);
    return bone;
  });
  const ibm = new Float32Array(ordered.length * 16);
  ordered.forEach((bone, i) => {
    const p = modelSpace.get(bone)!;
    ibm.set(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z).elements, i * 16);
  });
  const gltfSkin = doc
    .createSkin('soldier')
    .setSkeleton(byBone.get(ordered[0]!)!)
    .setInverseBindMatrices(doc.createAccessor('inverse binds').setType('MAT4').setArray(ibm));
  for (const bone of ordered) gltfSkin.addJoint(byBone.get(bone)!);

  // -- The material and its atlas. --
  const texture = doc.createTexture('soldier atlas').setMimeType('image/png').setImage(soldierAtlasPng()).setURI('soldier-atlas.png');
  const material = doc.createMaterial('soldier').setBaseColorTexture(texture).setMetallicFactor(0).setRoughnessFactor(1);
  material
    .getBaseColorTextureInfo()!
    .setMagFilter(NEAREST)
    .setMinFilter(NEAREST_MIPMAP_LINEAR)
    .setWrapS(CLAMP_TO_EDGE)
    .setWrapT(CLAMP_TO_EDGE);

  // -- The skin's geometry, as the page welds it. --
  const attribute = (name: string, type: 'VEC2' | 'VEC3' | 'VEC4', array: Float32Array | Uint16Array) =>
    doc.createAccessor(name).setType(type).setArray(array);
  const joints = geometry.getAttribute('skinIndex');
  const jointArray = new Uint16Array(joints.count * 4);
  for (let i = 0; i < jointArray.length; i++) jointArray[i] = joints.array[i]!;
  const prim = doc
    .createPrimitive()
    .setMaterial(material)
    .setAttribute('POSITION', attribute('position', 'VEC3', new Float32Array(geometry.getAttribute('position').array)))
    .setAttribute('NORMAL', attribute('normal', 'VEC3', new Float32Array(geometry.getAttribute('normal').array)))
    .setAttribute('TEXCOORD_0', attribute('uv', 'VEC2', new Float32Array(geometry.getAttribute('uv').array)))
    .setAttribute('JOINTS_0', attribute('joints', 'VEC4', jointArray))
    .setAttribute('WEIGHTS_0', attribute('weights', 'VEC4', new Float32Array(geometry.getAttribute('skinWeight').array)));
  const index = geometry.getIndex();
  if (index) prim.setIndices(doc.createAccessor('indices').setType('SCALAR').setArray(new Uint32Array(index.array)));
  const mesh = doc.createMesh('soldier').addPrimitive(prim);
  scene.addChild(doc.createNode('soldier').setMesh(mesh).setSkin(gltfSkin));
  return doc;
}
