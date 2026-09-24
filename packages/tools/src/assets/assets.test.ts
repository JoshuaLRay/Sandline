/**
 * The asset pipeline and its committed output (T-4.02).
 *
 * The committed web copies and manifest are what `pnpm gen:assets` writes,
 * byte for byte; each entry's numbers are the file's; a source edited
 * without a re-run fails here by name; and the test asset (the code-built
 * soldier) survives compression with its geometry, rig and texture intact.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { Document, type Node } from '@gltf-transform/core';
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ASSET_MANIFEST, parseAssetManifest } from '@sandline/shared';
import { HUMANOID_BONES } from '../../../client/src/character/humanoidRig.ts';
import { createIO, inputHash, processAsset, sha256, statsOf, statsOfBytes } from './pipeline.ts';

const REPO = new URL('../../../../', import.meta.url);
const read = (path: string): Uint8Array => new Uint8Array(readFileSync(new URL(path, REPO)));
const WEB = (file: string): string => `packages/client/public/${file}`;

describe('the committed assets (T-4.02)', () => {
  it('lists every source under assets/src/, and nothing else is in the web folder', () => {
    const sources = readdirSync(new URL('assets/src/', REPO)).filter((f) => /\.(glb|gltf)$/.test(f)).sort();
    expect(ASSET_MANIFEST.assets.map((a) => a.source.replace('assets/src/', ''))).toEqual(sources);
    const copies = readdirSync(new URL('packages/client/public/assets/', REPO)).filter((f) => f.endsWith('.glb')).sort();
    expect(copies).toEqual(ASSET_MANIFEST.assets.map((a) => a.file.replace('assets/', '')).sort());
    // The manifest on disk is the parsed one: nothing the parser drops.
    expect(parseAssetManifest(JSON.parse(readFileSync(new URL('packages/shared/src/data/assets/manifest.json', REPO), 'utf8')))).toEqual(ASSET_MANIFEST);
  });

  for (const entry of ASSET_MANIFEST.assets) {
    describe(`'${entry.id}'`, () => {
      it('is not stale: its source, the settings and the tools hash to what was processed', () => {
        expect(inputHash(read(entry.source)), `'${entry.id}' is stale — run pnpm gen:assets`).toBe(entry.inputHash);
      });

      it('is the file the manifest describes: hash, size and every count', async () => {
        const web = read(WEB(entry.file));
        expect(sha256(web)).toBe(entry.hash);
        expect(web.length).toBe(entry.bytes);
        const { class: kind, triangles, bones, materials, textures, lods, collision } = entry;
        expect(await statsOfBytes(web)).toEqual({ class: kind, triangles, bones, materials, textures, lods, collision });
      });

      // A 1024² character atlas takes several seconds to encode (T-4.08).
      it('is exactly what a re-run writes', { timeout: 60_000 }, async () => {
        expect(sha256(await processAsset(read(entry.source)))).toBe(entry.hash);
      });
    });
  }

  it('goes stale when a source changes, even by one byte', () => {
    const entry = ASSET_MANIFEST.assets[0]!;
    const source = read(entry.source);
    source[source.length - 1] = source[source.length - 1]! ^ 1;
    expect(inputHash(source)).not.toBe(entry.inputHash);
  });
});

/** Every vertex in bind pose, in the asset's metres, with the name of the joint that carries it most. */
function bindVertices(doc: Document): { p: THREE.Vector3; joint: string }[] {
  const out: { p: THREE.Vector3; joint: string }[] = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    const skin = node.getSkin();
    if (!mesh || !skin) continue;
    const joints = skin.listJoints();
    const ibm = skin.getInverseBindMatrices()!;
    // In bind pose a joint's world matrix times its inverse bind is the
    // matrix that places the stored vertex: the identity for the source,
    // the dequantization for the web copy (quantize folds it in there).
    const place = joints.map((j: Node, i) =>
      new THREE.Matrix4().fromArray(j.getWorldMatrix()).multiply(new THREE.Matrix4().fromArray(ibm.getElement(i, [] as number[]))),
    );
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')!;
      const jnt = prim.getAttribute('JOINTS_0')!;
      const wgt = prim.getAttribute('WEIGHTS_0')!;
      for (let v = 0; v < pos.getCount(); v++) {
        const js = jnt.getElement(v, [] as number[]);
        const ws = wgt.getElement(v, [] as number[]);
        const k = ws.indexOf(Math.max(...ws));
        const p = new THREE.Vector3().fromArray(pos.getElement(v, [] as number[])).applyMatrix4(place[js[k]!]!);
        out.push({ p, joint: joints[js[k]!]!.getName() });
      }
    }
  }
  return out;
}

describe('the test asset round-trips (T-4.02)', () => {
  let source: Document;
  let web: Document;
  beforeAll(async () => {
    const io = await createIO();
    source = await io.readBinary(read('assets/src/soldier.glb'));
    web = await io.readBinary(read(WEB('assets/soldier.glb')));
  });

  it('keeps its triangles, rig, material and texture size, and gets smaller', () => {
    const a = statsOf(source);
    const b = statsOf(web);
    expect(b.triangles).toBe(a.triangles);
    expect(b.bones).toBe(HUMANOID_BONES.length);
    expect(b.materials).toBe(a.materials);
    expect(b.textures).toEqual([{ width: 256, height: 256, format: 'ktx2' }]);
    expect(a.textures).toEqual([{ width: 256, height: 256, format: 'png' }]);
    expect(web.getRoot().listSkins()[0]!.listJoints().map((j) => j.getName())).toEqual([...HUMANOID_BONES]);
    expect(read(WEB('assets/soldier.glb')).length).toBeLessThan(read('assets/src/soldier.glb').length / 2);
    const used = web.getRoot().listExtensionsUsed().map((e) => e.extensionName).sort();
    expect(used).toEqual(expect.arrayContaining(['EXT_meshopt_compression', 'KHR_mesh_quantization', 'KHR_texture_basisu']));
  });

  it('puts every vertex back within a millimetre of the source, on the same bone', () => {
    const a = bindVertices(source);
    const b = bindVertices(web);
    expect(a.length).toBeGreaterThan(0);
    // Deduplication may merge vertices, so each side is matched to its nearest on the other.
    let worst = 0;
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      for (const v of from) {
        let best = Infinity;
        let joint = '';
        for (const w of to) {
          const d = v.p.distanceToSquared(w.p);
          if (d < best) [best, joint] = [d, w.joint];
        }
        worst = Math.max(worst, Math.sqrt(best));
        expect(joint).toBe(v.joint);
      }
    }
    console.log(`round-trip: worst vertex ${(worst * 1000).toFixed(3)} mm over ${a.length} → ${b.length} vertices`);
    expect(worst).toBeLessThan(0.001);
  });
});

describe('what a source declares (T-4.02)', () => {
  /** A one-box prop: its mesh, a far LOD, and its collision in the scene's extras. */
  function prop(collision: unknown): Document {
    const doc = new Document();
    doc.createBuffer();
    const scene = doc.createScene('crate').setExtras({ sandline: { class: 'prop', collision } });
    const wood = doc.createMaterial('wood');
    const meshOf = (name: string, geometry: THREE.BufferGeometry) =>
      doc.createMesh(name).addPrimitive(
        doc
          .createPrimitive()
          .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(geometry.getAttribute('position').array)))
          .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(geometry.getIndex()!.array)))
          .setMaterial(wood),
      );
    // Twelve triangles near, two far: a card facing the camera.
    scene.addChild(doc.createNode('crate').setMesh(meshOf('crate', new THREE.BoxGeometry(1, 1, 1))));
    scene.addChild(doc.createNode('crate_LOD1').setMesh(meshOf('crate far', new THREE.PlaneGeometry(1, 1))));
    return doc;
  }

  it('carries collision boxes and LOD levels into the manifest numbers', async () => {
    const io = await createIO();
    const web = await processAsset(await io.writeBinary(prop([[-0.5, 0, -0.5, 0.5, 1, 0.5]])));
    const stats = await statsOfBytes(web);
    expect(stats.collision).toEqual([{ min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }]);
    expect(stats.lods).toBe(2);
    expect(stats.triangles).toBe(14);
    expect(stats.textures).toEqual([]);
  });

  it('refuses a collision box that is not six numbers or is inside out', () => {
    expect(() => statsOf(prop([[0, 0, 0, 1, 1]]))).toThrow(/collision box 0/);
    expect(() => statsOf(prop([[0, 0, 0, 1, -1, 1]]))).toThrow(/min must be below/);
    expect(() => statsOf(prop('box'))).toThrow(/array of boxes/);
  });

  it('refuses a source with no budget class, or one budgets.json does not have', () => {
    const doc = prop([]);
    doc.getRoot().listScenes()[0]!.setExtras({ sandline: {} });
    expect(() => statsOf(doc)).toThrow(/sandline.class: expected one of/);
    doc.getRoot().listScenes()[0]!.setExtras({ sandline: { class: 'vehicle' } });
    expect(() => statsOf(doc)).toThrow(/got "vehicle"/);
  });

  it('refuses a texture it cannot encode', async () => {
    const doc = prop([]);
    doc.getRoot().listMaterials()[0]!.setBaseColorTexture(doc.createTexture('jpeg').setMimeType('image/jpeg').setImage(new Uint8Array([1, 2, 3])));
    const io = await createIO();
    await expect(processAsset(await io.writeBinary(doc))).rejects.toThrow(/pipeline takes PNG/);
  });

  it('has a source on disk for every entry', () => {
    for (const a of ASSET_MANIFEST.assets) expect(existsSync(new URL(a.source, REPO)), a.source).toBe(true);
  });
});
