import { describe, expect, it } from 'vitest';
import type { AssetEntry } from '@sandline/shared';
import type { LoadedAsset } from './loader.ts';
import { PackLoader, type PackProgress } from './packs.ts';

const entries = new Map<string, AssetEntry>([
  ['soldier', { id: 'soldier', class: 'character', source: '', inputHash: 'a'.repeat(64), file: '', hash: 'b'.repeat(64), bytes: 60, triangles: 1, bones: 1, materials: 1, textures: [], lods: 1, collision: [] }],
  ['wall', { id: 'wall', class: 'kit', source: '', inputHash: 'a'.repeat(64), file: '', hash: 'b'.repeat(64), bytes: 40, triangles: 1, bones: 0, materials: 1, textures: [], lods: 1, collision: [] }],
]);

function fakeLoader() {
  const loads = new Map<string, number>();
  return {
    loads,
    manifestEntry(id: string) {
      return entries.get(id);
    },
    async load(id: string): Promise<LoadedAsset> {
      loads.set(id, (loads.get(id) ?? 0) + 1);
      return { id, object: {} as LoadedAsset['object'], fallback: false, release() {} };
    },
  };
}

describe('PackLoader (T-4.06)', () => {
  it('retains a level pack so selecting it twice does not download twice', async () => {
    const loader = fakeLoader();
    const packs = new PackLoader(loader, { initial: ['soldier'], levels: { range: ['wall'] } });
    await packs.loadLevel('range');
    await packs.loadLevel('range');
    expect(loader.loads.get('wall')).toBe(1);
    expect(packs.isLoaded('level:range')).toBe(true);
  });

  it('reports byte progress through the final asset', async () => {
    const loader = fakeLoader();
    const packs = new PackLoader(loader, { initial: ['soldier', 'wall'], levels: { range: [] } });
    const seen: PackProgress[] = [];
    await packs.loadInitial((state) => seen.push(state));
    expect(seen[0]).toMatchObject({ loadedAssets: 0, totalAssets: 2, loadedBytes: 0, totalBytes: 100 });
    expect(seen.at(-1)).toMatchObject({ loadedAssets: 2, totalAssets: 2, loadedBytes: 100, totalBytes: 100 });
  });
});
