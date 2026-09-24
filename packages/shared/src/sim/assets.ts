/**
 * The asset manifest (T-4.02), `data/assets/manifest.json`: one entry per
 * web copy `pnpm gen:assets` wrote, with what the budgets (T-4.03) and the
 * loader (T-4.05) need to know about it without opening it.
 *
 * Generated, never edited by hand. The tools' tests check every entry
 * against its file and its source, so a number here is a number in the file.
 * Validated by hand as the other data files are, unknown keys refused by
 * name. Shared because the budgets and the level check read it headless and
 * the page reads it to know what to fetch.
 */
import RAW_MANIFEST from '../data/assets/manifest.json' with { type: 'json' };

/** An axis-aligned box in the asset's own metres (§7.11 rule 1). */
export interface CollisionBox {
  min: [number, number, number];
  max: [number, number, number];
}

export interface AssetTexture {
  width: number;
  height: number;
  format: 'ktx2' | 'png';
}

export interface AssetEntry {
  /** The source's file name without its extension. */
  id: string;
  /** The source, from the repository root: `assets/src/<id>.glb`. */
  source: string;
  /** The web copy, relative to the page: `assets/<id>.glb`. */
  file: string;
  /** SHA-256 of the source, the pipeline's settings and its tools' versions. */
  inputHash: string;
  /** SHA-256 of the web copy. */
  hash: string;
  bytes: number;
  triangles: number;
  /** Distinct joints across every skin. */
  bones: number;
  materials: number;
  textures: AssetTexture[];
  /** 1 + the highest `_LOD<n>` a node is named with; 1 when it has none. */
  lods: number;
  collision: CollisionBox[];
}

export interface AssetManifest {
  version: 1;
  assets: AssetEntry[];
}

export class AssetManifestError extends Error {}

type Obj = Record<string, unknown>;

function obj(where: string, v: unknown, keys: readonly string[]): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new AssetManifestError(`${where}: expected an object`);
  const o = v as Obj;
  for (const k of Object.keys(o)) if (!keys.includes(k) && k !== '$comment') throw new AssetManifestError(`${where}: unknown key '${k}'`);
  for (const k of keys) if (!(k in o)) throw new AssetManifestError(`${where}: missing '${k}'`);
  return o;
}

function count(where: string, v: unknown, min = 0): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min) throw new AssetManifestError(`${where}: expected an integer ≥ ${min}`);
  return v;
}

function str(where: string, v: unknown, pattern?: RegExp): string {
  if (typeof v !== 'string' || v.length === 0) throw new AssetManifestError(`${where}: expected a string`);
  if (pattern && !pattern.test(v)) throw new AssetManifestError(`${where}: '${v}' does not match ${pattern}`);
  return v;
}

function vec3(where: string, v: unknown): [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new AssetManifestError(`${where}: expected three numbers`);
  }
  return [v[0] as number, v[1] as number, v[2] as number];
}

const HASH = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9-]*$/;
const ENTRY_KEYS = ['id', 'source', 'file', 'inputHash', 'hash', 'bytes', 'triangles', 'bones', 'materials', 'textures', 'lods', 'collision'] as const;

export function parseAssetManifest(raw: unknown): AssetManifest {
  const top = obj('manifest', raw, ['version', 'assets']);
  if (top['version'] !== 1) throw new AssetManifestError(`manifest: version ${String(top['version'])} is not 1`);
  if (!Array.isArray(top['assets'])) throw new AssetManifestError('manifest.assets: expected an array');
  const seen = new Set<string>();
  const assets = top['assets'].map((v, i): AssetEntry => {
    const e = obj(`assets[${i}]`, v, ENTRY_KEYS);
    const id = str(`assets[${i}].id`, e['id'], ID);
    const where = `asset '${id}'`;
    if (seen.has(id)) throw new AssetManifestError(`${where}: listed twice`);
    seen.add(id);
    if (!Array.isArray(e['textures'])) throw new AssetManifestError(`${where}.textures: expected an array`);
    if (!Array.isArray(e['collision'])) throw new AssetManifestError(`${where}.collision: expected an array`);
    return {
      id,
      source: str(`${where}.source`, e['source'], /^assets\/src\/[^/]+\.(glb|gltf)$/),
      file: str(`${where}.file`, e['file'], /^assets\/[^/]+\.glb$/),
      inputHash: str(`${where}.inputHash`, e['inputHash'], HASH),
      hash: str(`${where}.hash`, e['hash'], HASH),
      bytes: count(`${where}.bytes`, e['bytes'], 1),
      triangles: count(`${where}.triangles`, e['triangles']),
      bones: count(`${where}.bones`, e['bones']),
      materials: count(`${where}.materials`, e['materials']),
      textures: e['textures'].map((t, j) => {
        const o = obj(`${where}.textures[${j}]`, t, ['width', 'height', 'format']);
        if (o['format'] !== 'ktx2' && o['format'] !== 'png') throw new AssetManifestError(`${where}.textures[${j}].format: expected 'ktx2' or 'png'`);
        return { width: count(`${where}.textures[${j}].width`, o['width'], 1), height: count(`${where}.textures[${j}].height`, o['height'], 1), format: o['format'] };
      }),
      lods: count(`${where}.lods`, e['lods'], 1),
      collision: e['collision'].map((b, j) => {
        const o = obj(`${where}.collision[${j}]`, b, ['min', 'max']);
        const min = vec3(`${where}.collision[${j}].min`, o['min']);
        const max = vec3(`${where}.collision[${j}].max`, o['max']);
        if (!(min[0] < max[0] && min[1] < max[1] && min[2] < max[2])) throw new AssetManifestError(`${where}.collision[${j}]: every min must be below its max`);
        return { min, max };
      }),
    };
  });
  return { version: 1, assets };
}

/** The committed manifest. */
export const ASSET_MANIFEST: AssetManifest = parseAssetManifest(RAW_MANIFEST);

export function assetById(id: string): AssetEntry | undefined {
  return ASSET_MANIFEST.assets.find((a) => a.id === id);
}
