/**
 * The asset loader (T-4.05): a manifest id in, a scene object out, through
 * three's own glTF loader and decoders so no runtime dependency is new
 * (rule 3). The pipeline (T-4.02) writes meshopt geometry and KTX2 textures,
 * so those are the two decoders wired; Draco is not, because nothing emits it.
 *
 * ONE COPY, MANY USES. The first load of an id fetches, checks and parses it
 * into a template; every load hands out a clone that shares the template's
 * geometry, materials and textures (skinned ones get their own skeleton), and
 * counts a reference. `release()` gives the reference back; the last one
 * disposes the template's geometry, materials and textures, so the GPU gives
 * them back too. A load while the first is still in flight waits for it.
 *
 * NEVER A BLANK SCENE. An id the manifest does not have, a fetch that fails,
 * bytes whose hash is not the manifest's (a truncated or stale copy), or a
 * parse that throws all give the asset's grey box instead, with a warning:
 * the collision boxes the manifest lists, or a one-metre box when it lists
 * none. A soldier missing its model is a grey box on the range, not a hole.
 *
 * PRE-WARMED. Given a renderer, the first load compiles the template's
 * shaders before it is handed out, so the first frame it appears in does not
 * stall on a shader compile.
 */
import * as THREE from 'three';
import { type GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ASSET_MANIFEST, type AssetEntry, type AssetManifest, type CollisionBox } from '@sandline/shared';

export interface LoadedAsset {
  readonly id: string;
  /** This use's own object: add it to the scene, move it, pose it. */
  readonly object: THREE.Object3D;
  /** True when this is the grey box standing in for an asset that did not load. */
  readonly fallback: boolean;
  /** Gives the reference back. Idempotent. The last one disposes the shared resources. */
  release(): void;
}

/** Turns a web copy's bytes into its scene. The default is three's GLTFLoader. */
export type AssetParser = (bytes: ArrayBuffer, entry: AssetEntry) => Promise<THREE.Object3D>;

export interface AssetLoaderOptions {
  /** Where the page's `assets/…` files live, ending in '/'. The page's own directory by default. */
  baseUrl?: string;
  manifest?: AssetManifest;
  fetchBytes?: (url: string) => Promise<ArrayBuffer>;
  parse?: AssetParser;
  /** Pre-warm: compile each template's shaders on first load. */
  renderer?: Pick<THREE.WebGLRenderer, 'compileAsync'>;
  warn?: (message: string) => void;
}

interface Entry {
  refs: number;
  ready: Promise<{ template: THREE.Object3D; fallback: boolean }>;
}

async function defaultFetch(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.arrayBuffer();
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const b of digest) hex += b.toString(16).padStart(2, '0');
  return hex;
}

const FALLBACK_MATERIAL_COLOR = 0x7a7a72;

/**
 * The stand-in: the asset's collision boxes, or a metre cube, in flat grey.
 * Its own geometry and material, disposed like any template's.
 */
export function greyBoxFor(id: string, entry: AssetEntry | undefined): THREE.Object3D {
  const group = new THREE.Group();
  group.name = `fallback:${id}`;
  const material = new THREE.MeshLambertMaterial({ color: FALLBACK_MATERIAL_COLOR });
  const boxes: CollisionBox[] = entry?.collision.length ? entry.collision : [{ min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }];
  for (const b of boxes) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]), material);
    mesh.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    group.add(mesh);
  }
  return group;
}

/** Every geometry, material and texture under `root`, once each. */
export function resourcesOf(root: THREE.Object3D): { geometries: Set<THREE.BufferGeometry>; materials: Set<THREE.Material>; textures: Set<THREE.Texture> } {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const m = mesh.material;
    if (!m) return;
    for (const material of Array.isArray(m) ? m : [m]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  return { geometries, materials, textures };
}

function disposeTemplate(root: THREE.Object3D): void {
  const { geometries, materials, textures } = resourcesOf(root);
  for (const g of geometries) g.dispose();
  for (const t of textures) t.dispose();
  for (const m of materials) m.dispose();
  root.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose();
  });
}

export class AssetLoader {
  private readonly entries = new Map<string, Entry>();
  private readonly baseUrl: string;
  private readonly manifest: AssetManifest;
  private readonly fetchBytes: (url: string) => Promise<ArrayBuffer>;
  private readonly parse: AssetParser;
  private readonly renderer: AssetLoaderOptions['renderer'];
  private readonly warn: (message: string) => void;
  private readonly prewarmCamera = new THREE.PerspectiveCamera();

  constructor(options: AssetLoaderOptions = {}) {
    this.baseUrl = options.baseUrl ?? './';
    this.manifest = options.manifest ?? ASSET_MANIFEST;
    this.fetchBytes = options.fetchBytes ?? defaultFetch;
    this.parse = options.parse ?? gltfParser();
    this.renderer = options.renderer;
    this.warn = options.warn ?? ((m) => console.warn(m));
  }

  /** References held on `id` right now; 0 when nothing holds it (and it is not cached). */
  refs(id: string): number {
    return this.entries.get(id)?.refs ?? 0;
  }

  /** Ids with a template cached. */
  cached(): string[] {
    return [...this.entries.keys()];
  }

  async load(id: string): Promise<LoadedAsset> {
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { refs: 0, ready: this.build(id) };
      this.entries.set(id, entry);
    }
    entry.refs++;
    const held = entry;
    const { template, fallback } = await held.ready;
    const object = cloneSkinned(template);
    let released = false;
    return {
      id,
      object,
      fallback,
      release: () => {
        if (released) return;
        released = true;
        object.removeFromParent();
        object.traverse((o) => {
          // The clone's own skeleton (SkeletonUtils gives each clone one) has
          // a bone texture of its own once drawn; everything else is shared.
          if (o instanceof THREE.SkinnedMesh && o.skeleton !== undefined) o.skeleton.dispose();
        });
        if (--held.refs > 0) return;
        if (this.entries.get(id) === held) this.entries.delete(id);
        disposeTemplate(template);
      },
    };
  }

  private async build(id: string): Promise<{ template: THREE.Object3D; fallback: boolean }> {
    const entry = this.manifest.assets.find((a) => a.id === id);
    let template: THREE.Object3D;
    let fallback = false;
    try {
      if (!entry) throw new Error('not in the manifest');
      const bytes = await this.fetchBytes(this.baseUrl + entry.file);
      const hash = await sha256Hex(bytes);
      if (hash !== entry.hash) throw new Error(`${bytes.byteLength} bytes do not hash to the manifest's (stale or truncated copy)`);
      template = await this.parse(bytes, entry);
      template.name ||= id;
    } catch (err) {
      this.warn(`asset '${id}' did not load (${err instanceof Error ? err.message : String(err)}); drawing its grey box`);
      template = greyBoxFor(id, entry);
      fallback = true;
    }
    if (this.renderer) {
      try {
        await this.renderer.compileAsync(template, this.prewarmCamera);
      } catch (err) {
        this.warn(`asset '${id}': shader pre-warm failed (${err instanceof Error ? err.message : String(err)})`);
      }
    }
    return { template, fallback };
  }
}

/**
 * three's GLTFLoader with the pipeline's decoders: meshopt always; KTX2 when
 * given the renderer it must detect GPU formats against. The Basis
 * transcoder KTX2 runs in a worker is three's own: with no path given, the
 * loader finds it by `import.meta.url`, which Vite bundles with the page.
 */
export function gltfParser(ktx2?: { renderer: THREE.WebGLRenderer; transcoderPath?: string }): AssetParser {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  if (ktx2) {
    const ktx2Loader = new KTX2Loader();
    // A directory: the loader appends the file names, so it must end in '/'.
    if (ktx2.transcoderPath) ktx2Loader.setTranscoderPath(ktx2.transcoderPath.replace(/\/?$/, '/'));
    loader.setKTX2Loader(ktx2Loader.detectSupport(ktx2.renderer));
  }
  return async (bytes) => {
    const gltf: GLTF = await loader.parseAsync(bytes, '');
    return gltf.scene;
  };
}
