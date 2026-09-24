/**
 * A generated piece and the glTF source it is written as (T-4.04, ADR-018).
 *
 * A piece is a recipe: an id, a budget class (T-4.03), a family atlas, and a
 * `build` that draws it with a `MeshBuilder`. `pieceDocument` turns it into
 * the glTF that `pnpm gen:art` writes to `assets/src/<id>.glb`. From there
 * it is an input like any other: `pnpm gen:assets` processes it and the
 * budgets check it.
 *
 * What the source carries:
 *   - one mesh, one material (the family's), point-sampled up close like the
 *     soldier (T-2.35) and mipmapped far off;
 *   - `sandline.class` and `sandline.collision` on the scene's extras, the
 *     collision straight from the boxes the builder was told collide;
 *   - the family atlas as a PNG, which the pipeline turns into KTX2.
 */
import { Document } from '@gltf-transform/core';
import { type AtlasFamily, atlasPng } from './atlas.ts';
import { type BuiltMesh, MeshBuilder } from './mesh.ts';

export interface Piece {
  id: string;
  class: 'kit' | 'prop' | 'weapon' | 'character';
  family: AtlasFamily;
  /** Metres each surface's cell covers. */
  tileM: Readonly<Record<string, number>>;
  build(b: MeshBuilder): void;
}

const NEAREST = 9728;
const LINEAR_MIPMAP_LINEAR = 9987;
const CLAMP_TO_EDGE = 33071;

export function buildPiece(piece: Piece): BuiltMesh {
  const b = new MeshBuilder(piece.family, piece.tileM);
  piece.build(b);
  return b.build();
}

export function pieceDocument(piece: Piece): Document {
  const mesh = buildPiece(piece);
  if (mesh.indices.length === 0) throw new Error(`piece '${piece.id}' built no triangles`);
  const doc = new Document();
  doc.createBuffer();
  const collision = mesh.collision.map((c) => [...c.min, ...c.max]);
  const scene = doc.createScene(piece.id).setExtras({ sandline: { class: piece.class, collision } });
  doc.getRoot().setDefaultScene(scene);

  const texture = doc.createTexture(`${piece.family.id} atlas`).setMimeType('image/png').setImage(atlasPng(piece.family));
  const material = doc.createMaterial(piece.family.id).setBaseColorTexture(texture).setMetallicFactor(0).setRoughnessFactor(1);
  material
    .getBaseColorTextureInfo()!
    .setMagFilter(NEAREST)
    .setMinFilter(LINEAR_MIPMAP_LINEAR)
    .setWrapS(CLAMP_TO_EDGE)
    .setWrapT(CLAMP_TO_EDGE);

  const accessor = (name: string, type: 'VEC2' | 'VEC3' | 'SCALAR', array: Float32Array | Uint16Array | Uint32Array) =>
    doc.createAccessor(name).setType(type).setArray(array);
  const vertexCount = mesh.positions.length / 3;
  const prim = doc
    .createPrimitive()
    .setMaterial(material)
    .setAttribute('POSITION', accessor('position', 'VEC3', new Float32Array(mesh.positions)))
    .setAttribute('NORMAL', accessor('normal', 'VEC3', new Float32Array(mesh.normals)))
    .setAttribute('TEXCOORD_0', accessor('uv', 'VEC2', new Float32Array(mesh.uvs)))
    .setIndices(accessor('indices', 'SCALAR', vertexCount < 65536 ? new Uint16Array(mesh.indices) : new Uint32Array(mesh.indices)));
  scene.addChild(doc.createNode(piece.id).setMesh(doc.createMesh(piece.id).addPrimitive(prim)));
  return doc;
}
