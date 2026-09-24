/**
 * The detailed soldier (T-4.08): current, on the rig's skeleton, inside the
 * server's hit capsule, weighted cleanly, within budget, every body UV in its
 * atlas region.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSET_MANIFEST, checkBudgets } from '@sandline/shared';
import { HUMANOID_BONES } from '../../../../client/src/character/humanoidRig.ts';
import { HUMANOID_HIT_RADIUS } from '../../../../client/src/character/humanoidPlaceholder.ts';
import { JOINTS } from '../../../../client/src/character/humanoidSoldier.ts';
import { createIO, sha256 } from '../../assets/pipeline.ts';
import { CHARACTERS } from './index.ts';
import { buildDetailedSoldier } from './soldier.ts';
import { region, type RegionName } from './soldierAtlas.ts';

const REPO = new URL('../../../../../', import.meta.url);

describe('the detailed soldier (T-4.08)', () => {
  const skin = buildDetailedSoldier();
  const verts = skin.positions.length / 3;

  for (const c of CHARACTERS) {
    it(`'${c.id}' is committed exactly as its generator writes it — else run pnpm gen:art && pnpm gen:assets`, { timeout: 60_000 }, async () => {
      const io = await createIO();
      const fresh = await io.writeBinary(c.document());
      const committed = new Uint8Array(readFileSync(new URL(`assets/src/${c.id}.glb`, REPO)));
      expect(sha256(committed)).toBe(sha256(fresh));
    });
  }

  it('is on the rig: its bones are the rig’s, at the rig’s joints, in its order', async () => {
    const io = await createIO();
    const doc = await io.readBinary(new Uint8Array(readFileSync(new URL('assets/src/soldier-dcu.glb', REPO))));
    const joints = doc.getRoot().listSkins()[0]!.listJoints();
    expect(joints.map((j) => j.getName())).toEqual([...HUMANOID_BONES]);
    for (const j of joints) {
      const world = j.getWorldTranslation();
      const want = JOINTS[j.getName() as keyof typeof JOINTS];
      for (let k = 0; k < 3; k++) expect(world[k]).toBeCloseTo(want[k]!, 6);
    }
  });

  it('is a much more detailed soldier than the code-built one, and within the character budget', () => {
    const tris = (skin.indices[0].length + skin.indices[1].length) / 3;
    expect(tris).toBeGreaterThan(3000);
    const entry = ASSET_MANIFEST.assets.find((a) => a.id === 'soldier-dcu')!;
    expect(entry).toMatchObject({ class: 'character', bones: 17, materials: 2, triangles: tris });
    expect(entry.textures).toEqual([{ width: 1024, height: 1024, format: 'ktx2' }]);
    expect(checkBudgets({ version: 1, assets: [entry] })).toEqual([]);
  });

  it('stays inside the capsule the server shoots at, and fills it (T-2.31)', () => {
    let worst = 0;
    let top = 0;
    for (let i = 0; i < verts; i++) {
      worst = Math.max(worst, Math.sqrt(skin.positions[i * 3]! ** 2 + skin.positions[i * 3 + 2]! ** 2));
      top = Math.max(top, skin.positions[i * 3 + 1]!);
    }
    expect(worst).toBeLessThanOrEqual(HUMANOID_HIT_RADIUS);
    expect(worst).toBeGreaterThan(HUMANOID_HIT_RADIUS * 0.8);
    // Feet on the ground, the helmet's crown a little over 1.9 m.
    expect(Math.min(...skin.positions.filter((_, i) => i % 3 === 1))).toBeCloseTo(0, 6);
    expect(top).toBeGreaterThan(1.88);
    expect(top).toBeLessThan(1.95);
  });

  it('weights every vertex to real bones, summing to one, and bends the knees and elbows on two', () => {
    let blended = 0;
    for (let v = 0; v < verts; v++) {
      const w = skin.weights.slice(v * 4, v * 4 + 4);
      expect(w.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 5);
      for (let k = 0; k < 4; k++) if (w[k]! > 0) expect(skin.joints[v * 4 + k]).toBeLessThan(HUMANOID_BONES.length);
      if (w[1]! > 0) blended++;
    }
    expect(blended / verts).toBeGreaterThan(0.1);
  });

  it('keeps every body UV inside an atlas region, so filtering never bleeds one part into another', () => {
    const rects = (['face', 'helmet', 'blouse', 'trousers', 'vest', 'pack', 'pouch', 'boot', 'glove', 'belt', 'skin', 'goggle', 'strap', 'cuff'] as RegionName[]).map(region);
    const used = new Set(skin.indices[0]);
    for (const v of used) {
      const [u, w] = [skin.uvs[v * 2]!, skin.uvs[v * 2 + 1]!];
      expect(rects.some((r) => u >= r.u0 - 1e-6 && u <= r.u1 + 1e-6 && w >= r.v0 - 1e-6 && w <= r.v1 + 1e-6), `uv ${u}, ${w}`).toBe(true);
    }
  });

  it('has unit normals everywhere', () => {
    for (let v = 0; v < verts; v++) {
      const l = Math.sqrt(skin.normals[v * 3]! ** 2 + skin.normals[v * 3 + 1]! ** 2 + skin.normals[v * 3 + 2]! ** 2);
      expect(l).toBeCloseTo(1, 3);
    }
  });
});
