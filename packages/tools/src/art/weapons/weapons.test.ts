/**
 * The period weapons (T-4.36): each committed as its generator writes it,
 * within the weapon budget, and fitted to the hold `weaponModels.ts` gives
 * its loadout id, so the hands, the sight and the viewmodel land where they
 * always did.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSET_MANIFEST, checkBudgets } from '@sandline/shared';
import { createWeaponModel, weaponAssetId } from '../../../../client/src/weapons/weaponModels.ts';
import { createIO, sha256 } from '../../assets/pipeline.ts';
import { weaponRegion } from './atlas.ts';
import { weaponDocuments } from './index.ts';
import { WEAPONS, buildWeapon } from './weapons.ts';

const REPO = new URL('../../../../../', import.meta.url);

/** Loadout id → the side it is drawn for, for every generated model. */
const HOLDS: [string, 'squad' | 'enemy'][] = [
  ['carbine', 'squad'],
  ['marksman', 'squad'],
  ['breacher', 'squad'],
  ['sidearm', 'squad'],
  ['frag', 'squad'],
  ['rocket', 'squad'],
  ['lmg', 'squad'],
  ['carbine', 'enemy'],
  ['lmg', 'enemy'],
  ['rocket', 'enemy'],
];

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5). */
function closestOnTriangle(p: V, a: V, b: V, c: V): V {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v];
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w];
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}

/** How far p is from the mesh's surface. */
function nearest(mesh: { positions: number[]; indices: number[] }, p: readonly number[]): number {
  const P = (i: number): V => [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!];
  const q = p as V;
  let best = Infinity;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const c = closestOnTriangle(q, P(mesh.indices[t]!), P(mesh.indices[t + 1]!), P(mesh.indices[t + 2]!));
    best = Math.min(best, Math.hypot(c[0] - q[0], c[1] - q[1], c[2] - q[2]));
  }
  return best;
}

describe('the period weapons (T-4.36)', () => {
  it('draws every loadout id for both sides with a generated model, ten in all', () => {
    const ids = new Set(HOLDS.map(([id, side]) => weaponAssetId(id, side)));
    expect(ids.size).toBe(Object.keys(WEAPONS).length);
    for (const id of ids) expect(Object.keys(WEAPONS).map((k) => `weapon-${k}`)).toContain(id);
    // An enemy's carbine is not the squad's.
    expect(weaponAssetId('carbine', 'enemy')).not.toBe(weaponAssetId('carbine', 'squad'));
    // An item the enemy has no model of its own for is drawn as the squad's.
    expect(weaponAssetId('sidearm', 'enemy')).toBe(weaponAssetId('sidearm', 'squad'));
  });

  for (const w of weaponDocuments()) {
    it(`'${w.id}' is committed exactly as its generator writes it — else run pnpm gen:art && pnpm gen:assets`, { timeout: 30_000 }, async () => {
      const io = await createIO();
      expect(sha256(new Uint8Array(readFileSync(new URL(`assets/src/${w.id}.glb`, REPO))))).toBe(sha256(await io.writeBinary(w.document())));
    });
  }

  for (const [id, side] of HOLDS) {
    const asset = weaponAssetId(id, side);
    it(`'${asset}' (${side} ${id}) fits its hold: a grip under the right hand, the sight where the eye looks, within budget`, () => {
      const mesh = buildWeapon(asset.replace('weapon-', ''));
      const spec = createWeaponModel(id).spec;
      // The right hand closes round something within a hand's width of its grip point.
      expect(nearest(mesh, spec.gripRight)).toBeLessThan(0.05);
      // A squad weapon has something to look along at its sight point (a grenade's "sight" is the grenade).
      // Enemies are never looked through: an AK's rear sight sits forward, where a real one's does.
      if (side === 'squad') expect(nearest(mesh, spec.sight)).toBeLessThan(0.03);
      const entry = ASSET_MANIFEST.assets.find((a) => a.id === asset)!;
      expect(entry, `${asset} is not in the manifest`).toBeDefined();
      expect(entry.class).toBe('weapon');
      expect(entry.triangles).toBe(mesh.indices.length / 3);
      expect(checkBudgets({ version: 1, assets: [entry] })).toEqual([]);
    });
  }

  it('keeps every UV inside a region of the weapons atlas', () => {
    const rects = (['steel', 'polymer', 'laminate', 'walnut', 'olive', 'rail', 'warhead', 'brass', 'glass', 'rubber', 'webbing', 'label'] as const).map(weaponRegion);
    for (const key of Object.keys(WEAPONS)) {
      const { uvs } = buildWeapon(key);
      for (let i = 0; i < uvs.length; i += 2) {
        const [u, v] = [uvs[i]!, uvs[i + 1]!];
        expect(rects.some((r) => u >= r.u0 - 1e-6 && u <= r.u1 + 1e-6 && v >= r.v0 - 1e-6 && v <= r.v1 + 1e-6), `${key} uv ${u},${v}`).toBe(true);
      }
    }
  });

  it('winds every triangle to face its normal', () => {
    for (const key of Object.keys(WEAPONS)) {
      const m = buildWeapon(key);
      let wrong = 0;
      for (let t = 0; t < m.indices.length; t += 3) {
        const [a, b, c] = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!];
        const P = (i: number) => [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!];
        const [pa, pb, pc] = [P(a), P(b), P(c)];
        const e1 = [pb[0]! - pa[0]!, pb[1]! - pa[1]!, pb[2]! - pa[2]!];
        const e2 = [pc[0]! - pa[0]!, pc[1]! - pa[1]!, pc[2]! - pa[2]!];
        const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
        const vn = [0, 1, 2].map((k) => m.normals[a * 3 + k]! + m.normals[b * 3 + k]! + m.normals[c * 3 + k]!);
        if (n[0]! * vn[0]! + n[1]! * vn[1]! + n[2]! * vn[2]! < 0) wrong++;
      }
      expect(wrong, key).toBe(0);
    }
  });
});
