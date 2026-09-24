/**
 * The asset loader's bookkeeping (T-4.05), headless: reference counts, reuse,
 * disposal at the last release, pre-warm, and the grey-box fallback for
 * every way an asset can fail to arrive. The real decoders and a real GPU's
 * memory counters are `loader.browser.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ASSET_MANIFEST, type AssetEntry, type AssetManifest } from '@sandline/shared';
import { AssetLoader, type AssetParser, greyBoxFor, resourcesOf } from './loader.ts';

const REPO = new URL('../../../../', import.meta.url);
const soldierBytes = (): ArrayBuffer => {
  const b = readFileSync(new URL('packages/client/public/assets/soldier.glb', REPO));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** A parser that builds a small textured, skinned scene and counts every dispose. */
function fakeParser() {
  const disposed: string[] = [];
  let parses = 0;
  const parse: AssetParser = async () => {
    parses++;
    const texture = new THREE.Texture();
    texture.addEventListener('dispose', () => disposed.push('texture'));
    const material = new THREE.MeshLambertMaterial({ map: texture });
    material.addEventListener('dispose', () => disposed.push('material'));
    const geometry = new THREE.BoxGeometry();
    geometry.addEventListener('dispose', () => disposed.push('geometry'));
    const bone = new THREE.Bone();
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.add(bone);
    mesh.bind(new THREE.Skeleton([bone]));
    const root = new THREE.Group();
    root.add(mesh);
    return root;
  };
  return { parse, disposed, parses: () => parses };
}

const loaderWith = (parse: AssetParser, extra: Partial<ConstructorParameters<typeof AssetLoader>[0]> = {}) =>
  new AssetLoader({ fetchBytes: async () => soldierBytes(), parse, warn: () => {}, ...extra });

describe('the asset loader (T-4.05)', () => {
  it('parses an id once, hands every load its own object, and shares the resources', async () => {
    const fake = fakeParser();
    const loader = loaderWith(fake.parse);
    const [a, b] = await Promise.all([loader.load('soldier'), loader.load('soldier')]);
    const c = await loader.load('soldier');
    expect(fake.parses()).toBe(1);
    expect(loader.refs('soldier')).toBe(3);
    expect(a.fallback).toBe(false);
    expect(a.object).not.toBe(b.object);
    const ra = resourcesOf(a.object);
    const rc = resourcesOf(c.object);
    expect([...ra.geometries]).toEqual([...rc.geometries]);
    expect([...ra.textures]).toEqual([...rc.textures]);
    // Each skinned clone poses its own skeleton.
    const skinOf = (o: THREE.Object3D) => o.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh;
    expect(skinOf(a.object).skeleton).not.toBe(skinOf(b.object).skeleton);
    expect(skinOf(a.object).skeleton.bones[0]).not.toBe(skinOf(b.object).skeleton.bones[0]);
  });

  it('disposes geometry, material and texture at the last release, not before, and parses again after', async () => {
    const fake = fakeParser();
    const loader = loaderWith(fake.parse);
    const a = await loader.load('soldier');
    const b = await loader.load('soldier');
    const scene = new THREE.Scene();
    scene.add(a.object);
    a.release();
    a.release(); // idempotent
    expect(a.object.parent).toBeNull();
    expect(loader.refs('soldier')).toBe(1);
    expect(fake.disposed).toEqual([]);
    b.release();
    expect(fake.disposed.sort()).toEqual(['geometry', 'material', 'texture']);
    expect(loader.cached()).toEqual([]);
    await loader.load('soldier');
    expect(fake.parses()).toBe(2);
  });

  it('pre-warms shaders once per template when given a renderer', async () => {
    const compileAsync = vi.fn(async () => undefined);
    const loader = loaderWith(fakeParser().parse, { renderer: { compileAsync } as never });
    await loader.load('soldier');
    await loader.load('soldier');
    expect(compileAsync).toHaveBeenCalledTimes(1);
  });

  describe('falls back to the grey box, with a warning, never a blank', () => {
    const run = async (loader: AssetLoader, id = 'soldier') => {
      const got = await loader.load(id);
      expect(got.fallback).toBe(true);
      expect(got.object.getObjectByProperty('isMesh', true)).toBeDefined();
      return got;
    };

    it('for an id the manifest does not have', async () => {
      const warn = vi.fn();
      await run(loaderWith(fakeParser().parse, { warn }), 'tank');
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/asset 'tank' did not load \(not in the manifest\)/));
    });

    it('for a fetch that fails', async () => {
      const warn = vi.fn();
      await run(loaderWith(fakeParser().parse, { warn, fetchBytes: async () => Promise.reject(new Error('404 Not Found')) }));
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/404 Not Found/));
    });

    it('for bytes that are not the manifest’s (truncated or stale)', async () => {
      const warn = vi.fn();
      const parse = vi.fn(fakeParser().parse);
      await run(loaderWith(parse, { warn, fetchBytes: async () => soldierBytes().slice(0, 1000) }));
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/1000 bytes do not hash/));
      expect(parse).not.toHaveBeenCalled();
    });

    it('for a parse that throws — here the real GLTFLoader, given KTX2 textures and no KTX2 decoder', async () => {
      const warn = vi.fn();
      await run(new AssetLoader({ fetchBytes: async () => soldierBytes(), warn }));
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/asset 'soldier' did not load/));
    });

    it('shaped by the manifest’s collision boxes when it lists some, and disposed like any asset', async () => {
      const entry: AssetEntry = { ...ASSET_MANIFEST.assets[0]!, id: 'crate', collision: [{ min: [0, 0, 0], max: [2, 1, 1] }] };
      const manifest: AssetManifest = { version: 1, assets: [entry] };
      const loader = loaderWith(fakeParser().parse, { manifest, fetchBytes: async () => Promise.reject(new Error('offline')) });
      const got = await run(loader, 'crate');
      const box = new THREE.Box3().setFromObject(got.object);
      expect(box.min.toArray()).toEqual([0, 0, 0]);
      expect(box.max.toArray()).toEqual([2, 1, 1]);
      const { geometries } = resourcesOf(got.object);
      const disposed = vi.fn();
      for (const g of geometries) g.addEventListener('dispose', disposed);
      got.release();
      expect(disposed).toHaveBeenCalledTimes(1);
      expect(new THREE.Box3().setFromObject(greyBoxFor('x', undefined)).max.toArray()).toEqual([0.5, 1, 0.5]);
    });
  });
});
