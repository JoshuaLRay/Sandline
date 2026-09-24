import { describe, expect, it } from 'vitest';
import { ASSET_MANIFEST, type AssetEntry } from './assets.ts';
import { ASSET_BUDGETS, AssetBudgetError, checkBudgets, parseAssetBudgets } from './budgets.ts';

const H = 'a'.repeat(64);
const asset = (over: Partial<AssetEntry> = {}): AssetEntry => ({
  id: 'crate',
  class: 'prop',
  source: 'assets/src/crate.glb',
  file: 'assets/crate.glb',
  inputHash: H,
  hash: H,
  bytes: 1000,
  triangles: 500,
  bones: 0,
  materials: 1,
  textures: [{ width: 256, height: 256, format: 'ktx2' }],
  lods: 1,
  collision: [],
  ...over,
});
const check = (...assets: AssetEntry[]) => checkBudgets({ version: 1, assets });

describe('asset budgets (T-4.03)', () => {
  it('passes the committed set', () => {
    expect(checkBudgets(ASSET_MANIFEST)).toEqual([]);
  });

  it('passes an asset inside every limit of its class', () => {
    expect(check(asset())).toEqual([]);
  });

  it('fails an over-budget asset with its name, its number and the limit', () => {
    const limit = ASSET_BUDGETS.classes['prop']!.triangles;
    expect(check(asset({ id: 'fat-crate', triangles: limit + 1 }))).toEqual([
      `asset 'fat-crate' (prop): ${limit + 1} triangles, over the budget of ${limit}`,
    ]);
    const character = ASSET_BUDGETS.classes['character']!;
    const lines = check(asset({ id: 'hero', class: 'character', triangles: 16000, bones: 70, materials: 3 }));
    expect(lines).toEqual([
      `asset 'hero' (character): 16000 triangles, over the budget of ${character.triangles}`,
      `asset 'hero' (character): 70 bones, over the budget of ${character.bones}`,
      `asset 'hero' (character): 3 materials, over the budget of ${character.materials}`,
    ]);
  });

  it('fails textures that are too big, too many, not KTX2 or not a power of two', () => {
    expect(check(asset({ textures: [{ width: 1024, height: 512, format: 'ktx2' }] }))).toEqual([
      "asset 'crate' (prop): 1024 texels on a side of texture 0, over the budget of 512",
    ]);
    expect(check(asset({ textures: [{ width: 256, height: 256, format: 'png' }] }))).toEqual(["asset 'crate' (prop): texture 0 is png, not KTX2"]);
    expect(check(asset({ textures: [{ width: 300, height: 256, format: 'ktx2' }] }))).toEqual([
      "asset 'crate' (prop): texture 0 is 300×256, not a power of two",
    ]);
    const two = { width: 64, height: 64, format: 'ktx2' as const };
    expect(check(asset({ textures: [two, two] }))).toEqual(["asset 'crate' (prop): 2 textures, over the budget of 1"]);
  });

  it('fails a class with no budget, and a download over the ceiling', () => {
    expect(check(asset({ class: 'vehicle' }))[0]).toMatch(/class 'vehicle' has no budget/);
    const half = Math.ceil(ASSET_BUDGETS.initialDownloadBytes / 2) + 1;
    expect(check(asset({ id: 'a', bytes: half }), asset({ id: 'b', bytes: half }))).toEqual([
      `initial download: ${half * 2} bytes, over the budget of ${ASSET_BUDGETS.initialDownloadBytes}`,
    ]);
  });

  it('refuses a malformed budget file by name', () => {
    expect(() => parseAssetBudgets({ classes: {}, initialDownloadBytes: 1 })).toThrow(/no classes/);
    expect(() => parseAssetBudgets({ classes: { prop: { triangles: 1 } }, initialDownloadBytes: 1 })).toThrow(/missing 'bones'/);
    expect(() => parseAssetBudgets({ classes: {}, initialDownloadBytes: 1, extra: 1 })).toThrow(AssetBudgetError);
    expect(() =>
      parseAssetBudgets({ classes: { prop: { triangles: -1, bones: 0, materials: 1, textureSize: 1, textures: 1 } }, initialDownloadBytes: 1 }),
    ).toThrow(/triangles/);
  });
});
