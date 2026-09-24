/**
 * A built character as the glTF source `pnpm gen:art` writes (T-4.08): the
 * rig's 17 bones as nodes at their joints (`HUMANOID_BONES` order, the bind
 * pose the identity, so each inverse bind matrix is the joint negated), one
 * skinned mesh of two primitives, the atlas material and the accent, and
 * `sandline.class: character` for the budgets.
 */
import { Document, type Node } from '@gltf-transform/core';
import { HUMANOID_BONES } from '../../../../client/src/character/humanoidRig.ts';
import { JOINTS, PARENT } from '../../../../client/src/character/humanoidSoldier.ts';
import type { BuiltSkin } from './skin.ts';

const LINEAR = 9729;
const LINEAR_MIPMAP_LINEAR = 9987;
const CLAMP_TO_EDGE = 33071;

export function characterDocument(id: string, skin: BuiltSkin, atlasPng: Uint8Array): Document {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene(id).setExtras({ sandline: { class: 'character' } });
  doc.getRoot().setDefaultScene(scene);

  const nodes = new Map<string, Node>();
  for (const name of HUMANOID_BONES) {
    const joint = JOINTS[name];
    const parent = PARENT[name];
    const at: readonly [number, number, number] = parent ? JOINTS[parent] : [0, 0, 0];
    const node = doc.createNode(name).setTranslation([joint[0] - at[0], joint[1] - at[1], joint[2] - at[2]]);
    nodes.set(name, node);
    if (parent) nodes.get(parent)!.addChild(node);
    else scene.addChild(node);
  }
  const ibm = new Float32Array(HUMANOID_BONES.length * 16);
  HUMANOID_BONES.forEach((name, i) => {
    const [x, y, z] = JOINTS[name];
    ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
  });
  const gltfSkin = doc
    .createSkin(id)
    .setSkeleton(nodes.get('hips')!)
    .setInverseBindMatrices(doc.createAccessor('inverse binds').setType('MAT4').setArray(ibm));
  for (const name of HUMANOID_BONES) gltfSkin.addJoint(nodes.get(name)!);

  const texture = doc.createTexture(`${id} atlas`).setMimeType('image/png').setImage(atlasPng);
  const body = doc.createMaterial(id).setBaseColorTexture(texture).setMetallicFactor(0).setRoughnessFactor(1);
  body.getBaseColorTextureInfo()!.setMagFilter(LINEAR).setMinFilter(LINEAR_MIPMAP_LINEAR).setWrapS(CLAMP_TO_EDGE).setWrapT(CLAMP_TO_EDGE);
  const accent = doc.createMaterial('accent').setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(1);

  const acc = (name: string, type: 'VEC2' | 'VEC3' | 'VEC4' | 'SCALAR', array: Float32Array | Uint16Array) => doc.createAccessor(name).setType(type).setArray(array);
  const position = acc('position', 'VEC3', new Float32Array(skin.positions));
  const normal = acc('normal', 'VEC3', new Float32Array(skin.normals));
  const uv = acc('uv', 'VEC2', new Float32Array(skin.uvs));
  const joints = acc('joints', 'VEC4', new Uint16Array(skin.joints));
  const weights = acc('weights', 'VEC4', new Float32Array(skin.weights));
  const mesh = doc.createMesh(id);
  skin.indices.forEach((indices, m) => {
    if (indices.length === 0) return;
    mesh.addPrimitive(
      doc
        .createPrimitive()
        .setMaterial(m === 0 ? body : accent)
        .setAttribute('POSITION', position)
        .setAttribute('NORMAL', normal)
        .setAttribute('TEXCOORD_0', uv)
        .setAttribute('JOINTS_0', joints)
        .setAttribute('WEIGHTS_0', weights)
        .setIndices(acc(`indices ${m}`, 'SCALAR', new Uint16Array(indices))),
    );
  });
  scene.addChild(doc.createNode(id).setMesh(mesh).setSkin(gltfSkin));
  return doc;
}
