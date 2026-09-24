import { describe, expect, it } from 'vitest';
import type { AssetEntry, AssetManifest } from './assets.ts';
import { ASSET_PACKS, AssetPackError, parseAssetPacks } from './packs.ts';

const asset = (id: string): AssetEntry => ({
  id,
  class: 'prop',
  source: `assets/src/${id}.glb`,
  inputHash: 'a'.repeat(64),
  file: `assets/${id}.glb`,
  hash: 'b'.repeat(64),
  bytes: 10,
  triangles: 2,
  bones: 0,
  materials: 1,
  textures: [],
  lods: 1,
  collision: [],
});
const manifest: AssetManifest = { version: 1, assets: [asset('a'), asset('b')] };

describe('asset packs (T-4.06)', () => {
  it('parses the committed pack data', () => {
    expect(ASSET_PACKS.initial).toContain('soldier-dcu');
    expect(ASSET_PACKS.levels['mission-01']).toContain('ground-road-4m');
  });

  it('refuses unknown, duplicate and malformed asset ids', () => {
    expect(() => parseAssetPacks({ initial: ['missing'], levels: { range: [] } }, manifest)).toThrow(/unknown asset 'missing'/);
    expect(() => parseAssetPacks({ initial: ['a', 'a'], levels: { range: [] } }, manifest)).toThrow(/appears twice/);
    expect(() => parseAssetPacks({ initial: ['a'], levels: { range: ['b', 1] } }, manifest)).toThrow(AssetPackError);
  });
});
