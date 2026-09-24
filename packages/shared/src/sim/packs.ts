/**
 * Asset pack data (T-4.06). The initial pack is fetched with the menu and
 * contains the playable soldier plus every weapon. A level pack is fetched
 * after that level is chosen and before its first playable frame.
 *
 * Pure data validation belongs in shared so CI/tools and the browser consume
 * exactly the same grouping without either platform reading files at runtime.
 */
import RAW_PACKS from '../data/assets/packs.json' with { type: 'json' };
import { ASSET_MANIFEST, type AssetManifest } from './assets.ts';

export interface AssetPacks {
  readonly initial: readonly string[];
  readonly levels: Readonly<Record<string, readonly string[]>>;
}

export class AssetPackError extends Error {}

function object(where: string, value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AssetPackError(`${where}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(where: string, value: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (key !== '$comment' && !allowed.includes(key)) throw new AssetPackError(`${where}: unknown key '${key}'`);
  }
  for (const key of allowed) if (!(key in value)) throw new AssetPackError(`${where}: missing '${key}'`);
}

function ids(where: string, value: unknown, manifest: AssetManifest): readonly string[] {
  if (!Array.isArray(value)) throw new AssetPackError(`${where}: expected a list`);
  const known = new Set(manifest.assets.map((asset) => asset.id));
  const seen = new Set<string>();
  return Object.freeze(value.map((id, index) => {
    if (typeof id !== 'string' || id === '') throw new AssetPackError(`${where}[${index}]: expected an asset id`);
    if (!known.has(id)) throw new AssetPackError(`${where}[${index}]: unknown asset '${id}'`);
    if (seen.has(id)) throw new AssetPackError(`${where}: asset '${id}' appears twice`);
    seen.add(id);
    return id;
  }));
}

export function parseAssetPacks(raw: unknown, manifest: AssetManifest = ASSET_MANIFEST): AssetPacks {
  const top = object('asset packs', raw);
  exactKeys('asset packs', top, ['initial', 'levels']);
  const levelsRaw = object('asset packs.levels', top['levels']);
  const levels: Record<string, readonly string[]> = {};
  for (const [world, value] of Object.entries(levelsRaw)) {
    if (world === '$comment') continue;
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(world)) throw new AssetPackError(`asset packs.levels: invalid world id '${world}'`);
    levels[world] = ids(`asset packs.levels.${world}`, value, manifest);
  }
  if (Object.keys(levels).length === 0) throw new AssetPackError('asset packs.levels: no level packs');
  return Object.freeze({
    initial: ids('asset packs.initial', top['initial'], manifest),
    levels: Object.freeze(levels),
  });
}

export const ASSET_PACKS: AssetPacks = parseAssetPacks(RAW_PACKS);
