/**
 * The enemy fighter (T-4.35): the same checks as the soldier's (T-4.08) —
 * current, on the rig, inside the capsule, weighted cleanly, within budget,
 * every UV in its atlas region — and a silhouette that is not the squad's:
 * no helmet, no vest, loose cloth.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSET_MANIFEST, checkBudgets } from '@sandline/shared';
import { HUMANOID_BONES } from '../../../../client/src/character/humanoidRig.ts';
import { HUMANOID_HIT_RADIUS } from '../../../../client/src/character/humanoidPlaceholder.ts';
import { JOINTS } from '../../../../client/src/character/humanoidSoldier.ts';
import { createIO } from '../../assets/pipeline.ts';
import { FIGHTER_PARTS, buildFighter } from './fighter.ts';
import { FIGHTER_REGIONS, fighterRegion } from './fighterAtlas.ts';
import { buildDetailedSoldier } from './soldier.ts';
import type { BuiltSkin } from './skin.ts';

const REPO = new URL('../../../../../', import.meta.url);
const parts = buildFighter();
const all = FIGHTER_PARTS.map((p) => parts[p]);
const points = (skin: BuiltSkin): [number, number, number][] =>
  Array.from({ length: skin.positions.length / 3 }, (_, i) => [skin.positions[i * 3]!, skin.positions[i * 3 + 1]!, skin.positions[i * 3 + 2]!]);
/** What a fighter wearing `headgear` is made of. */
const worn = (headgear: 'pakol' | 'turban', gunner = false): BuiltSkin[] => [parts.body, parts.cloth, parts[headgear], ...(gunner ? [parts.bandolier] : [])];

describe('the enemy fighter (T-4.35)', () => {
  it('is on the rig: one node a part, every one on the rig’s bones at the rig’s joints', async () => {
    const io = await createIO();
    const doc = await io.readBinary(new Uint8Array(readFileSync(new URL('assets/src/fighter.glb', REPO))));
    const skins = doc.getRoot().listSkins();
    expect(skins).toHaveLength(1);
    const joints = skins[0]!.listJoints();
    expect(joints.map((j) => j.getName())).toEqual([...HUMANOID_BONES]);
    for (const j of joints) {
      const world = j.getWorldTranslation();
      const want = JOINTS[j.getName() as keyof typeof JOINTS];
      for (let k = 0; k < 3; k++) expect(world[k]).toBeCloseTo(want[k]!, 6);
    }
    const partNodes = doc.getRoot().listNodes().filter((n) => n.getMesh());
    expect(partNodes.map((n) => n.getName())).toEqual(FIGHTER_PARTS.map((p) => `fighter-${p}`));
    for (const n of partNodes) expect(n.getSkin()).toBe(skins[0]);
  });

  it('is as detailed as the soldier, on one atlas, within the character budget', () => {
    const tris = all.reduce((s, p) => s + p.indices[0].length / 3, 0);
    expect(tris).toBeGreaterThan(3000);
    for (const p of all) expect(p.indices[1]).toEqual([]);
    const entry = ASSET_MANIFEST.assets.find((a) => a.id === 'fighter')!;
    expect(entry).toMatchObject({ class: 'character', bones: 17, materials: 1, triangles: tris });
    expect(entry.textures).toEqual([{ width: 1024, height: 1024, format: 'ktx2' }]);
    expect(checkBudgets({ version: 1, assets: [entry] })).toEqual([]);
  });

  it('stays inside the capsule the server shoots at, feet on the ground, whatever it wears (T-2.31)', () => {
    for (const p of all) {
      for (const [x, , z] of points(p)) expect(Math.hypot(x, z)).toBeLessThanOrEqual(HUMANOID_HIT_RADIUS);
    }
    expect(Math.min(...points(parts.body).map((p) => p[1]))).toBeCloseTo(0, 6);
    // The pakol sits lower than the turban; neither is higher than the helmet's crown.
    const top = (s: BuiltSkin) => Math.max(...points(s).map((p) => p[1]));
    expect(top(parts.pakol)).toBeLessThan(top(parts.turban));
    expect(top(parts.turban)).toBeLessThan(1.95);
  });

  it('weights every vertex to real bones, summing to one, and blends across the joints', () => {
    for (const p of all) {
      const verts = p.positions.length / 3;
      for (let v = 0; v < verts; v++) {
        const w = p.weights.slice(v * 4, v * 4 + 4);
        expect(w.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 5);
        for (let k = 0; k < 4; k++) if (w[k]! > 0) expect(p.joints[v * 4 + k]).toBeLessThan(HUMANOID_BONES.length);
      }
    }
    const cloth = parts.cloth;
    let blended = 0;
    for (let v = 0; v < cloth.weights.length / 4; v++) if (cloth.weights[v * 4 + 1]! > 0) blended++;
    expect(blended / (cloth.weights.length / 4)).toBeGreaterThan(0.2);
  });

  it('keeps every UV inside one of its atlas regions, and has unit normals', () => {
    const rects = FIGHTER_REGIONS.map(fighterRegion);
    for (const p of all) {
      for (const v of new Set(p.indices[0])) {
        const [u, w] = [p.uvs[v * 2]!, p.uvs[v * 2 + 1]!];
        expect(rects.some((r) => u >= r.u0 - 1e-6 && u <= r.u1 + 1e-6 && w >= r.v0 - 1e-6 && w <= r.v1 + 1e-6), `uv ${u}, ${w}`).toBe(true);
      }
      for (let v = 0; v < p.normals.length / 3; v++) expect(Math.hypot(p.normals[v * 3]!, p.normals[v * 3 + 1]!, p.normals[v * 3 + 2]!)).toBeCloseTo(1, 3);
    }
  });

  describe('reads as the other side before its colour does (the silhouette)', () => {
    const soldier = points(buildDetailedSoldier());
    /** The widest half-width (|x|) and the deepest front (z) of the points in a band of heights. */
    const band = (pts: [number, number, number][], lo: number, hi: number) => {
      const inBand = pts.filter(([, y]) => y >= lo && y <= hi);
      return { wide: Math.max(0, ...inBand.map(([x]) => Math.abs(x))), front: Math.max(0, ...inBand.map(([, , z]) => z)), count: inBand.length };
    };

    it('wears no helmet: the head is narrower where the soldier’s helmet flares', () => {
      const helmet = band(soldier, 1.7, 1.8).wide;
      for (const headgear of ['pakol', 'turban'] as const) {
        const head = band(worn(headgear).flatMap(points), 1.7, 1.8).wide;
        expect(head, headgear).toBeLessThan(helmet - 0.015);
      }
    });

    it('wears no vest: the chest stands out less than the soldier’s vest and pouches', () => {
      const vest = band(soldier, 1.2, 1.4).front;
      const chest = band(worn('pakol').flatMap(points), 1.3, 1.4).front;
      expect(chest).toBeLessThan(vest - 0.02);
    });

    it('is loose cloth: the kameez hangs between the legs, where the soldier has daylight', () => {
      const between = (pts: [number, number, number][]) => pts.filter(([x, y]) => Math.abs(x) < 0.012 && y > 0.6 && y < 0.75).length;
      expect(between(soldier)).toBe(0);
      expect(between(points(parts.cloth))).toBeGreaterThan(0);
      // And flares wider than the soldier's hips at the knee.
      expect(band(points(parts.cloth), 0.55, 0.65).wide).toBeGreaterThan(band(soldier, 0.55, 0.65).wide);
    });

    it('the gunner is told apart by his bandolier, across the chest', () => {
      const plain = band(worn('pakol').flatMap(points), 1.05, 1.45);
      const gunner = band(worn('pakol', true).flatMap(points), 1.05, 1.45);
      expect(gunner.count).toBeGreaterThan(plain.count);
      expect(parts.bandolier.indices[0].length).toBeGreaterThan(0);
    });
  });
});
