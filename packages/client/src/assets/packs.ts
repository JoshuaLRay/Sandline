/**
 * Runtime asset packs (T-4.06).
 *
 * A pack is a retained reference to every manifest asset it names. The first
 * load fetches through T-4.05's AssetLoader; later loads of the same pack
 * return the already-held promise/reference set. Because the pack keeps one
 * reference alive, changing away from a level and back cannot download it
 * again even though LevelPieces releases its own rendering references.
 */
import { ASSET_PACKS, type AssetPacks } from '@sandline/shared';
import type { AssetLoader, LoadedAsset } from './loader.ts';

export interface PackProgress {
  readonly pack: string;
  readonly loadedAssets: number;
  readonly totalAssets: number;
  readonly loadedBytes: number;
  readonly totalBytes: number;
}

type PackAssetLoader = Pick<AssetLoader, 'load' | 'manifestEntry'>;

export class PackLoader {
  private readonly held = new Map<string, LoadedAsset[]>();
  private readonly loading = new Map<string, Promise<void>>();

  constructor(
    private readonly loader: PackAssetLoader,
    private readonly packs: AssetPacks = ASSET_PACKS,
  ) {}

  loadInitial(progress?: (state: PackProgress) => void): Promise<void> {
    return this.loadPack('initial', this.packs.initial, progress);
  }

  loadLevel(worldId: string, progress?: (state: PackProgress) => void): Promise<void> {
    const ids = this.packs.levels[worldId];
    if (!ids) return Promise.reject(new Error(`no asset pack for level '${worldId}'`));
    return this.loadPack(`level:${worldId}`, ids, progress);
  }

  isLoaded(pack: string): boolean {
    return this.held.has(pack);
  }

  private loadPack(pack: string, ids: readonly string[], progress?: (state: PackProgress) => void): Promise<void> {
    const sizes = ids.map((id) => {
      const entry = this.loader.manifestEntry(id);
      if (!entry) throw new Error(`asset pack '${pack}' names '${id}', which is not in the manifest`);
      return entry.bytes;
    });
    const totalBytes = sizes.reduce((sum, bytes) => sum + bytes, 0);
    const done = (): void => progress?.({
      pack,
      loadedAssets: ids.length,
      totalAssets: ids.length,
      loadedBytes: totalBytes,
      totalBytes,
    });

    if (this.held.has(pack)) {
      done();
      return Promise.resolve();
    }
    const underway = this.loading.get(pack);
    if (underway) return underway.then(done);

    progress?.({ pack, loadedAssets: 0, totalAssets: ids.length, loadedBytes: 0, totalBytes });
    const loaded: LoadedAsset[] = [];
    let loadedAssets = 0;
    let loadedBytes = 0;
    const promise = Promise.all(ids.map(async (id, index) => {
      const asset = await this.loader.load(id);
      loaded.push(asset);
      loadedAssets++;
      loadedBytes += sizes[index] ?? 0;
      progress?.({ pack, loadedAssets, totalAssets: ids.length, loadedBytes, totalBytes });
    })).then(() => {
      this.held.set(pack, loaded);
    }).catch((error: unknown) => {
      for (const asset of loaded) asset.release();
      throw error;
    }).finally(() => {
      this.loading.delete(pack);
    });
    this.loading.set(pack, promise);
    return promise;
  }
}
