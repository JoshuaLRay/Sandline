/**
 * The asset pipeline (T-4.02): a source glTF in, a web copy and its manifest
 * entry out. `gen-assets.ts` runs it over `assets/src/`; the tests run the
 * same functions to prove a re-run is byte-identical and the manifest
 * matches the file.
 *
 * WHAT A WEB COPY IS.
 *   - Geometry: deduplicated, pruned, reordered for the vertex cache,
 *     quantized and compressed with EXT_meshopt_compression. Meshopt rather
 *     than Draco because its decoder is small, ships inside `three`'s
 *     examples (no new runtime dependency, rule 3) and is fast enough to
 *     run on the main thread.
 *   - Textures: KTX2 (KHR_texture_basisu), UASTC with Zstandard
 *     supercompression and mipmaps. UASTC, not ETC1S: the look is
 *     point-sampled texels (T-2.35), and ETC1S's codebooks smear exactly
 *     that detail.
 *
 * REPRODUCIBLE. Every step is single-threaded and seeded by nothing but its
 * input, so the same source gives the same bytes; the input hash covers the
 * source bytes, these settings and the tools' versions, so a change to any
 * of them makes the committed copy stale (`assets.test.ts`).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type Document, Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { read as readKtx } from 'ktx-parse';
import { ktx2 } from 'ktx2-encoder/gltf-transform';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { PNG } from 'pngjs';
import type { AssetEntry, CollisionBox } from '@sandline/shared';

/**
 * A dev dependency's version, from this package's own `node_modules` (pnpm
 * links each one there). Read from disk because not every package exports
 * its package.json, and the test runner has no `import.meta.resolve`.
 */
function versionOf(pkg: string): string {
  const json = JSON.parse(readFileSync(new URL(`../../node_modules/${pkg}/package.json`, import.meta.url), 'utf8')) as { version: string };
  return json.version;
}

/** Every setting that decides the output bytes. Part of the input hash. */
export const PIPELINE = {
  version: 1,
  meshopt: { level: 'medium' as const },
  ktx2: {
    isUASTC: true,
    needSupercompression: true,
    generateMipmap: true,
    isInputSRGB: true,
    isSetKTX2SRGBTransferFunc: true,
    isPerceptual: true,
  },
};

/** The tools that write the bytes. A version bump changes the output, so it is hashed. */
export function toolVersions(): Record<string, string> {
  return Object.fromEntries(
    ['@gltf-transform/core', '@gltf-transform/functions', 'meshoptimizer', 'ktx2-encoder'].map((p) => [p, versionOf(p)]),
  );
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** What decides a web copy: the source, the settings, the tools. */
export function inputHash(source: Uint8Array): string {
  return sha256(JSON.stringify({ source: sha256(source), pipeline: PIPELINE, tools: toolVersions() }));
}

export async function createIO(): Promise<NodeIO> {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
}

/** PNG to raw RGBA for the Basis encoder. The only source format it takes in Node. */
async function decodePng(bytes: Uint8Array): Promise<{ width: number; height: number; data: Uint8Array }> {
  const png = PNG.sync.read(Buffer.from(bytes));
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
}

/**
 * The Basis encoder's WebAssembly prints its progress to stdout whether or
 * not debug is asked for. The pipeline's own output is one line an asset;
 * this keeps it that.
 */
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
}

/** A source glTF (GLB or JSON with embedded buffers) in; the web copy's GLB bytes out. */
export async function processAsset(source: Uint8Array): Promise<Uint8Array> {
  const io = await createIO();
  const doc = await io.readBinary(source);
  // Warnings and errors only: prune's inventory of what it removed is not news.
  doc.setLogger(new Logger(Logger.Verbosity.WARN));
  for (const texture of doc.getRoot().listTextures()) {
    if (texture.getMimeType() !== 'image/png' && texture.getMimeType() !== 'image/ktx2') {
      throw new Error(`texture '${texture.getName()}' is ${texture.getMimeType()}; the pipeline takes PNG`);
    }
    // A web copy is one file: no external URIs.
    texture.setURI('');
  }
  await quietly(() =>
    doc.transform(
      dedup(),
      prune({ keepExtras: true }),
      ktx2({ ...PIPELINE.ktx2, imageDecoder: decodePng }),
      meshopt({ encoder: MeshoptEncoder, level: PIPELINE.meshopt.level }),
    ),
  );
  return io.writeBinary(doc);
}

/* -- What is in a file ----------------------------------------------------- */

export type AssetStats = Omit<AssetEntry, 'id' | 'source' | 'file' | 'inputHash' | 'hash' | 'bytes'>;

/** A node named `…_LOD<n>` is level n of the node without the suffix (T-4.07 draws them). */
const LOD_SUFFIX = /_LOD(\d+)$/;

/**
 * Collision boxes are declared on the scene's extras, in the asset's own
 * metres, axis-aligned (§7.11 rule 1): `{ "sandline": { "collision":
 * [[minX, minY, minZ, maxX, maxY, maxZ], …] } }`. A kit piece is placed at
 * a 90° turn only, so the boxes stay axis-aligned wherever it goes.
 */
export function collisionOf(doc: Document): CollisionBox[] {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const extras = (scene?.getExtras() ?? {}) as { sandline?: { collision?: unknown } };
  const raw = extras.sandline?.collision;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('scene extras sandline.collision: expected an array of boxes');
  return raw.map((b, i) => {
    if (!Array.isArray(b) || b.length !== 6 || !b.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      throw new Error(`collision box ${i}: expected [minX, minY, minZ, maxX, maxY, maxZ]`);
    }
    const [minX, minY, minZ, maxX, maxY, maxZ] = b as number[];
    if (!(minX! < maxX! && minY! < maxY! && minZ! < maxZ!)) throw new Error(`collision box ${i}: every min must be below its max`);
    return { min: [minX!, minY!, minZ!], max: [maxX!, maxY!, maxZ!] };
  });
}

/** Counts what the budgets (T-4.03) are checked against, from the document itself. */
export function statsOf(doc: Document): AssetStats {
  const root = doc.getRoot();
  let triangles = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) throw new Error(`mesh '${mesh.getName()}': only triangle lists are supported`);
      const indices = prim.getIndices();
      triangles += (indices ? indices.getCount() : prim.getAttribute('POSITION')!.getCount()) / 3;
    }
  }
  const bones = new Set(root.listSkins().flatMap((s) => s.listJoints())).size;
  const textures = root.listTextures().map((t) => {
    const image = t.getImage();
    if (!image) throw new Error(`texture '${t.getName()}' has no image`);
    if (t.getMimeType() === 'image/ktx2') {
      const k = readKtx(image);
      return { width: k.pixelWidth, height: k.pixelHeight, format: 'ktx2' as const };
    }
    const png = PNG.sync.read(Buffer.from(image));
    return { width: png.width, height: png.height, format: 'png' as const };
  });
  let lods = 1;
  for (const node of root.listNodes()) {
    const m = LOD_SUFFIX.exec(node.getName());
    if (m) lods = Math.max(lods, Number(m[1]) + 1);
  }
  return { triangles, bones, materials: root.listMaterials().length, textures, lods, collision: collisionOf(doc) };
}

/** Reads a GLB (compressed or not) and counts it. */
export async function statsOfBytes(glb: Uint8Array): Promise<AssetStats> {
  const io = await createIO();
  return statsOf(await io.readBinary(glb));
}
