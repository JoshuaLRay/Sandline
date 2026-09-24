/**
 * The detailed soldier from the asset pipeline (T-4.08; ADR-018, ADR-020).
 *
 * THE RIG STAYS; THE SKIN CHANGES. `soldier-dcu` is generated on the
 * code-built soldier's skeleton, the same 17 bones at the same joints in the
 * same order with the same identity bind pose (tools/src/art/characters/).
 * So a live soldier made by `createHumanoidSoldier` takes it by swapping its
 * skinned mesh's geometry and materials, and nothing else changes: bones,
 * poses, gait, aim, reload, hit reactions, the IK hold, foot placement, the
 * rifle and the hit capsule are all the rig's, as they were. The swap
 * happens in `setSoldierPalette`, which the page already calls whenever a
 * soldier's side or slot might have changed. A squad soldier gets the
 * detailed skin; an enemy the fighter (T-4.35, below).
 *
 * ONE GEOMETRY AND ONE ATLAS FOR THE SQUAD; A MARKING PER SLOT. The geometry
 * and the atlas material are shared by every squad soldier. The second
 * material, the armband and helmet band, takes the palette's `accent`, so a
 * slot changing hands (ADR-001) is a material swap on the live entity, as it
 * always was.
 *
 * DEQUANTIZED ONCE. The pipeline quantizes positions and folds the
 * dequantization into the inverse bind matrices (gltf-transform). The rig
 * binds with its own, so the loaded positions are put back into model space
 * here: the transform is any joint's world matrix times its loaded inverse
 * bind, identical for every joint.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AssetLoader } from '../assets/loader.ts';
import { PALETTES, type PaletteName } from './soldierTexture.ts';
import RAW_FIGHTER_LOOK from './fighterLook.json' with { type: 'json' };

export const DETAILED_SOLDIER_ASSET = 'soldier-dcu';

export interface DetailedSkin {
  /** Model space, feet at y = 0; group 0 the atlas, group 1 the accent. */
  geometry: THREE.BufferGeometry;
  material: THREE.MeshLambertMaterial;
}

let provided: DetailedSkin | null = null;

/** The detailed skin every squad soldier wears from now on; null goes back to the code-built skin. */
export function provideDetailedSkin(skin: DetailedSkin | null): void {
  provided = skin;
}

export function detailedSkin(): DetailedSkin | null {
  return provided;
}

const accents = new Map<PaletteName, THREE.MeshLambertMaterial>();

/** The squad marking's material for a palette, shared by every soldier wearing it. */
export function accentMaterial(palette: PaletteName): THREE.MeshLambertMaterial {
  let m = accents.get(palette);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: new THREE.Color(PALETTES[palette].accent) });
    m.name = `accent ${palette}`;
    accents.set(palette, m);
  }
  return m;
}

/** A float copy of an attribute, so a quantized one can be transformed without overflowing its integers. */
function floatCopy(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number): THREE.Float32BufferAttribute {
  const out = new Float32Array(attribute.count * size);
  for (let i = 0; i < attribute.count; i++) for (let k = 0; k < size; k++) out[i * size + k] = attribute.getComponent(i, k);
  return new THREE.Float32BufferAttribute(out, size);
}

/** The detailed skin from a loaded `soldier-dcu`: its primitives merged into one geometry in model space. */
export function detailedSkinFromLoaded(root: THREE.Object3D): DetailedSkin {
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) meshes.push(o);
  });
  if (meshes.length === 0) throw new Error(`${DETAILED_SOLDIER_ASSET}: no skinned mesh`);
  root.updateMatrixWorld(true);
  const parts = meshes.map((mesh) => {
    const bone = mesh.skeleton.bones[0]!;
    const toModel = new THREE.Matrix4().multiplyMatrices(bone.matrixWorld, mesh.skeleton.boneInverses[0]!);
    const g = new THREE.BufferGeometry();
    const src = mesh.geometry;
    g.setAttribute('position', floatCopy(src.getAttribute('position'), 3).applyMatrix4(toModel));
    g.setAttribute('normal', floatCopy(src.getAttribute('normal'), 3));
    // The accent has no texture, so the pipeline drops its UVs as unused; merging needs them, so they are zeros.
    const uv = src.getAttribute('uv');
    g.setAttribute('uv', uv ? floatCopy(uv, 2) : new THREE.Float32BufferAttribute(new Float32Array(src.getAttribute('position').count * 2), 2));
    const joints = src.getAttribute('skinIndex');
    const j = new Uint16Array(joints.count * 4);
    for (let i = 0; i < joints.count; i++) for (let k = 0; k < 4; k++) j[i * 4 + k] = joints.getComponent(i, k);
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(j, 4));
    g.setAttribute('skinWeight', floatCopy(src.getAttribute('skinWeight'), 4));
    g.setIndex(Array.from({ length: src.index!.count }, (_, i) => src.index!.getX(i)));
    return { g, accent: (mesh.material as THREE.Material).name === 'accent' };
  });
  // The atlas part first, the accent second: the group index is the material index.
  parts.sort((a, b) => Number(a.accent) - Number(b.accent));
  const geometry = mergeGeometries(parts.map((p) => p.g), true);
  if (!geometry) throw new Error(`${DETAILED_SOLDIER_ASSET}: its parts do not merge`);
  geometry.computeBoundingSphere();
  const atlasMesh = meshes.find((m) => (m.material as THREE.Material).name !== 'accent')!;
  const map = (atlasMesh.material as THREE.MeshStandardMaterial).map;
  if (map) {
    // Smooth, as the PS2 filtered (T-4.08): point sampling read as Roblox.
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.anisotropy = 4;
  }
  const material = new THREE.MeshLambertMaterial({ map });
  material.name = DETAILED_SOLDIER_ASSET;
  return { geometry, material };
}

/** The skin built from raw arrays (tests, and anything that has the generator's output in hand). */
export function detailedSkinFromArrays(built: {
  positions: number[];
  normals: number[];
  uvs: number[];
  joints: number[];
  weights: number[];
  indices: [number[], number[]];
}): DetailedSkin {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(built.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(built.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(built.uvs, 2));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(built.joints, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(built.weights, 4));
  geometry.setIndex([...built.indices[0], ...built.indices[1]]);
  geometry.addGroup(0, built.indices[0].length, 0);
  geometry.addGroup(built.indices[0].length, built.indices[1].length, 1);
  geometry.computeBoundingSphere();
  const material = new THREE.MeshLambertMaterial();
  material.name = DETAILED_SOLDIER_ASSET;
  return { geometry, material };
}

/**
 * Loads the detailed skin and provides it. Resolves null, leaving the
 * code-built skin in place, when the asset did not load (the loader has
 * already warned why).
 */
export async function loadDetailedSkin(loader: AssetLoader): Promise<DetailedSkin | null> {
  const asset = await loader.load(DETAILED_SOLDIER_ASSET);
  if (asset.fallback) {
    asset.release();
    return null;
  }
  // Held for the page's life: every squad soldier shares it.
  const skin = detailedSkinFromLoaded(asset.object);
  provideDetailedSkin(skin);
  return skin;
}

/* -- The enemy fighter (T-4.35) ------------------------------------------------ */

export const FIGHTER_ASSET = 'fighter';

/**
 * The fighter's parts, in the order of its material groups: each is a node
 * named `fighter-<part>` in the asset (tools/src/art/characters/fighter.ts).
 */
export const FIGHTER_PARTS = ['body', 'cloth', 'pakol', 'turban', 'bandolier'] as const;
export type FighterPart = (typeof FIGHTER_PARTS)[number];

export interface FighterVariant {
  headgear: 'pakol' | 'turban';
  /** Multiplies the pale-painted kameez, sleeves and trousers. */
  cloth: string;
  /** Multiplies the pale-painted headgear. */
  head: string;
}

class FighterLookError extends Error {}

export function parseFighterLook(raw: unknown): FighterVariant[] {
  const variants = (raw as { variants?: unknown } | null)?.variants;
  if (!Array.isArray(variants) || variants.length === 0) throw new FighterLookError('fighterLook: variants must be a non-empty list');
  const hex = /^#[0-9a-f]{6}$/i;
  return variants.map((v, i) => {
    const o = v as Record<string, unknown>;
    if (o['headgear'] !== 'pakol' && o['headgear'] !== 'turban') throw new FighterLookError(`fighterLook.variants[${i}].headgear must be pakol or turban`);
    for (const k of ['cloth', 'head'] as const) {
      if (typeof o[k] !== 'string' || !hex.test(o[k] as string)) throw new FighterLookError(`fighterLook.variants[${i}].${k} must be a #rrggbb colour`);
    }
    return { headgear: o['headgear'], cloth: o['cloth'] as string, head: o['head'] as string };
  });
}

export const FIGHTER_VARIANTS: readonly FighterVariant[] = Object.freeze(parseFighterLook(RAW_FIGHTER_LOOK));

/** Which variant a fighter wears: its netId round the list, so it keeps its look for its life. */
export function fighterVariantFor(netId: number): number {
  const n = FIGHTER_VARIANTS.length;
  return ((Math.trunc(netId) % n) + n) % n;
}

export interface FighterSkin {
  /** Model space, feet at y = 0; one group a part, in `FIGHTER_PARTS` order. */
  geometry: THREE.BufferGeometry;
  /** The atlas, untinted: the body and the bandolier. */
  material: THREE.MeshLambertMaterial;
}

let fighter: FighterSkin | null = null;

/** The fighter skin every enemy wears from now on; null goes back to the code-built skin. */
export function provideFighterSkin(skin: FighterSkin | null): void {
  fighter = skin;
  fighterMaterialCache.clear();
}

export function fighterSkin(): FighterSkin | null {
  return fighter;
}

/** Drawn for a part a fighter does not wear: three skips a group whose material is invisible. */
const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
HIDDEN.name = 'fighter hidden part';

const fighterMaterialCache = new Map<string, THREE.Material[]>();

/**
 * The material for each of the fighter's groups, for a variant and whether
 * he carries the MG: shared by every fighter who looks the same.
 */
export function fighterMaterials(variant: number, gunner: boolean): THREE.Material[] {
  if (!fighter) throw new Error('fighterMaterials: no fighter skin');
  const key = `${variant}|${gunner}`;
  let list = fighterMaterialCache.get(key);
  if (!list) {
    const look = FIGHTER_VARIANTS[variant] ?? FIGHTER_VARIANTS[0]!;
    const atlas = fighter.material;
    const tinted = (hex: string, name: string) => {
      const m = new THREE.MeshLambertMaterial({ map: atlas.map, color: new THREE.Color(hex) });
      m.name = name;
      return m;
    };
    const head = tinted(look.head, `fighter ${look.headgear} ${variant}`);
    list = [
      atlas,
      tinted(look.cloth, `fighter cloth ${variant}`),
      look.headgear === 'pakol' ? head : HIDDEN,
      look.headgear === 'turban' ? head : HIDDEN,
      gunner ? atlas : HIDDEN,
    ];
    fighterMaterialCache.set(key, list);
  }
  return list;
}

/** A skinned part's geometry in model space, as `detailedSkinFromLoaded` makes each of the soldier's. */
function modelSpacePart(mesh: THREE.SkinnedMesh): THREE.BufferGeometry {
  const bone = mesh.skeleton.bones[0]!;
  const toModel = new THREE.Matrix4().multiplyMatrices(bone.matrixWorld, mesh.skeleton.boneInverses[0]!);
  const g = new THREE.BufferGeometry();
  const src = mesh.geometry;
  g.setAttribute('position', floatCopy(src.getAttribute('position'), 3).applyMatrix4(toModel));
  g.setAttribute('normal', floatCopy(src.getAttribute('normal'), 3));
  g.setAttribute('uv', floatCopy(src.getAttribute('uv'), 2));
  const joints = src.getAttribute('skinIndex');
  const j = new Uint16Array(joints.count * 4);
  for (let i = 0; i < joints.count; i++) for (let k = 0; k < 4; k++) j[i * 4 + k] = joints.getComponent(i, k);
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(j, 4));
  g.setAttribute('skinWeight', floatCopy(src.getAttribute('skinWeight'), 4));
  g.setIndex(Array.from({ length: src.index!.count }, (_, i) => src.index!.getX(i)));
  return g;
}

/** The fighter skin from a loaded `fighter`: its parts merged in `FIGHTER_PARTS` order, one group each. */
export function fighterSkinFromLoaded(root: THREE.Object3D): FighterSkin {
  root.updateMatrixWorld(true);
  const byName = new Map<string, THREE.SkinnedMesh>();
  root.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    // A node's mesh may be named after it or be its child: walk up to the part's name.
    for (let n: THREE.Object3D | null = o; n; n = n.parent) {
      if (n.name.startsWith('fighter-')) {
        byName.set(n.name, o);
        break;
      }
    }
  });
  const parts = FIGHTER_PARTS.map((part) => {
    const mesh = byName.get(`fighter-${part}`);
    if (!mesh) throw new Error(`${FIGHTER_ASSET}: no part 'fighter-${part}'`);
    return mesh;
  });
  const geometry = mergeGeometries(parts.map(modelSpacePart), true);
  if (!geometry) throw new Error(`${FIGHTER_ASSET}: its parts do not merge`);
  geometry.computeBoundingSphere();
  const map = (parts[0]!.material as THREE.MeshStandardMaterial).map;
  if (map) {
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.anisotropy = 4;
  }
  const material = new THREE.MeshLambertMaterial({ map });
  material.name = FIGHTER_ASSET;
  return { geometry, material };
}

/**
 * Loads the fighter and provides it. Resolves null, leaving enemies in the
 * code-built skin, when the asset did not load (the loader has warned why).
 */
export async function loadFighterSkin(loader: AssetLoader): Promise<FighterSkin | null> {
  const asset = await loader.load(FIGHTER_ASSET);
  if (asset.fallback) {
    asset.release();
    return null;
  }
  const skin = fighterSkinFromLoaded(asset.object);
  provideFighterSkin(skin);
  return skin;
}
