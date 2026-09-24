import { describe, expect, it } from 'vitest';
import { ASSET_MANIFEST } from './assets.ts';
import { checkBudgets } from './budgets.ts';
import { KIT, KitDataError, checkKit, parseKit } from './kit.ts';

describe('the slice kit (T-4.10)', () => {
  it('has §4.1’s ~25 pieces, all in the manifest, all within budget, each with the cover its collision makes', () => {
    expect(KIT.length).toBeGreaterThanOrEqual(24);
    expect(KIT.length).toBeLessThanOrEqual(28);
    expect(checkKit(KIT, ASSET_MANIFEST)).toEqual([]);
    const entries = KIT.map((p) => ASSET_MANIFEST.assets.find((a) => a.id === p.id)!);
    expect(checkBudgets({ version: 1, assets: entries })).toEqual([]);
  });

  it('covers what §4.1 asks for: full, low and broken walls, a door and a window, a shell, sandbags, crates, a fence, rubble and ground', () => {
    const ids = KIT.map((p) => p.id).join(' ');
    for (const want of ['wall-plaster', 'wall-low', 'wall-broken', 'wall-door', 'wall-window', 'roof-slab', 'stairs', 'sandbags', 'crate', 'fence', 'rubble', 'ground-']) {
      expect(ids, want).toContain(want);
    }
  });

  it('refuses a cover class the collision does not make, and a piece the manifest lacks', () => {
    const lying = KIT.map((p) => (p.id === 'wall-low-4m' ? { ...p, cover: 'high' as const } : p));
    expect(checkKit(lying, ASSET_MANIFEST)).toEqual(["kit 'wall-low-4m': 'high' cover but stands 1.1 m"]);
    expect(checkKit([{ id: 'tank', cover: 'low', about: '' }], ASSET_MANIFEST)).toEqual(["kit 'tank': not in the manifest"]);
    expect(checkKit([{ id: 'soldier', cover: 'none', about: '' }], ASSET_MANIFEST)[0]).toMatch(/is a character/);
  });

  it('refuses a malformed kit file by name', () => {
    expect(() => parseKit({ pieces: [{ id: 'a', cover: 'medium', about: '' }] })).toThrow(/cover must be/);
    expect(() => parseKit({ pieces: [{ id: 'a', cover: 'low', about: '' }, { id: 'a', cover: 'low', about: '' }] })).toThrow(/twice/);
    expect(() => parseKit({ pieces: [{ id: 'a', cover: 'low', about: '', mass: 3 }] })).toThrow(KitDataError);
  });
});
