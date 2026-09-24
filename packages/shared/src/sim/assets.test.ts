import { describe, expect, it } from 'vitest';
import { ASSET_MANIFEST, AssetManifestError, assetById, parseAssetManifest } from './assets.ts';

const H = 'a'.repeat(64);
const entry = (over: Record<string, unknown> = {}) => ({
  id: 'crate',
  class: 'prop',
  source: 'assets/src/crate.glb',
  file: 'assets/crate.glb',
  inputHash: H,
  hash: H,
  bytes: 10,
  triangles: 12,
  bones: 0,
  materials: 1,
  textures: [{ width: 64, height: 64, format: 'ktx2' }],
  lods: 1,
  collision: [{ min: [0, 0, 0], max: [1, 1, 1] }],
  ...over,
});
const parse = (...assets: unknown[]) => parseAssetManifest({ version: 1, assets });

describe('the asset manifest (T-4.02)', () => {
  it('parses the committed manifest, the soldier in it', () => {
    expect(assetById('soldier')).toMatchObject({ bones: 17, materials: 1, file: 'assets/soldier.glb' });
    expect(ASSET_MANIFEST.version).toBe(1);
  });

  it('takes a well-formed entry as written', () => {
    expect(parse(entry()).assets[0]).toEqual(entry());
  });

  it('refuses what it does not know, and what is missing, by name', () => {
    expect(() => parse(entry({ colour: 'red' }))).toThrow(/unknown key 'colour'/);
    const { lods: _, ...noLods } = entry();
    void _;
    expect(() => parse(noLods)).toThrow(/missing 'lods'/);
    expect(() => parseAssetManifest({ version: 2, assets: [] })).toThrow(AssetManifestError);
  });

  it('refuses bad values', () => {
    expect(() => parse(entry({ hash: 'abc' }))).toThrow(/hash/);
    expect(() => parse(entry({ triangles: 1.5 }))).toThrow(/triangles/);
    expect(() => parse(entry({ bytes: 0 }))).toThrow(/bytes/);
    expect(() => parse(entry({ file: 'elsewhere/crate.glb' }))).toThrow(/file/);
    expect(() => parse(entry({ textures: [{ width: 64, height: 64, format: 'jpeg' }] }))).toThrow(/format/);
    expect(() => parse(entry({ collision: [{ min: [0, 0, 0], max: [1, 0, 1] }] }))).toThrow(/min must be below/);
    expect(() => parse(entry(), entry())).toThrow(/listed twice/);
  });
});
