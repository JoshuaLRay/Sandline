/**
 * The period weapons (T-4.36): each committed as its generator writes it,
 * within the weapon budget, and fitted to the hold `weaponModels.ts` gives
 * its loadout id, so the hands, the sight and the viewmodel land where they
 * always did.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSET_MANIFEST, checkBudgets } from '@sandline/shared';
import { createWeaponModel, weaponAssetId, weaponMuzzle } from '../../../../client/src/weapons/weaponModels.ts';
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

/** The nearest hit of the ray o + t·d (d unit) on the mesh, or null (Möller–Trumbore). */
function rayMesh(mesh: { positions: number[]; indices: number[] }, o: V, d: V, maxT: number): number | null {
  const P = (i: number): V => [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!];
  const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let best: number | null = null;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = P(mesh.indices[t]!);
    const e1 = sub(P(mesh.indices[t + 1]!), a);
    const e2 = sub(P(mesh.indices[t + 2]!), a);
    const p = cross(d, e2);
    const det = dot(e1, p);
    if (Math.abs(det) < 1e-12) continue;
    const s = sub(o, a);
    const u = dot(s, p) / det;
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1);
    const v = dot(d, q) / det;
    if (v < 0 || u + v > 1) continue;
    const hit = dot(e2, q) / det;
    if (hit > 0 && hit < maxT && (best === null || hit < best)) best = hit;
  }
  return best;
}

/** The squad's sighted weapons, and where along the bore each front post stands. */
const SIGHTED: [string, number][] = [
  ['carbine', 0.573],
  ['breacher', 0.87],
  ['sidearm', 0.482],
  ['rocket', 0.492],
  ['lmg', 0.857],
];

describe('the sight line (QA: ADS art obstructs aim)', () => {
  for (const [id, post] of SIGHTED) {
    it(`'${weaponAssetId(id, 'squad')}' is looked through: an open aperture, and the post's tip on the screen's centre`, () => {
      const mesh = buildWeapon(weaponAssetId(id, 'squad').replace('weapon-', ''));
      const { sight, eyeRelief } = createWeaponModel(id).spec;
      const eye: V = [sight[0], sight[1], sight[2] - eyeRelief];
      const along: V = [0, 0, 1];
      const toPost = post - eye[2];
      // Round the line, 3 mm out, nothing between the eye and the front sight: the rear sight is open.
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const from: V = [eye[0] + Math.cos(a) * 0.003, eye[1] + Math.sin(a) * 0.003, eye[2]];
        expect(rayMesh(mesh, from, along, toPost - 0.012), `${id}: something across the line at ${k * 45}°`).toBeNull();
      }
      // Just over the line, nothing at all: the post's tip is the top of the sight picture.
      expect(rayMesh(mesh, [eye[0], eye[1] + 0.001, eye[2]], along, 2), `${id}: something over the post`).toBeNull();
      // Just under it, the post — not the rear sight, not the receiver.
      const under = rayMesh(mesh, [eye[0], eye[1] - 0.0015, eye[2]], along, 2);
      expect(under, `${id}: no post under the line`).not.toBeNull();
      expect(eye[2] + under!).toBeGreaterThan(post - 0.012);
      expect(eye[2] + under!).toBeLessThan(post + 0.012);
    });
  }
});

/** The guns, as each side holds them: every one a tracer can leave. */
const GUNS = HOLDS.filter(([id]) => id !== 'frag' && id !== 'rocket');

describe('the barrel\'s tip (U-003: the shot leaves the gun you see)', () => {
  for (const [id, side] of GUNS) {
    const asset = weaponAssetId(id, side);
    it(`'${asset}' (${side} ${id}) ends at its muzzle point: the bore's front, on the mesh`, () => {
      const mesh = buildWeapon(asset.replace('weapon-', ''));
      const m = weaponMuzzle(id, side);
      // On the barrel's front face, not in the air ahead of it or down inside it.
      expect(nearest(mesh, m)).toBeLessThan(0.015);
      // Nothing round the bore line reaches further forward: this is the front.
      let front = -Infinity;
      for (let i = 0; i < mesh.positions.length; i += 3) {
        if (Math.hypot(mesh.positions[i]! - m[0], mesh.positions[i + 1]! - m[1]) < 0.03) front = Math.max(front, mesh.positions[i + 2]!);
      }
      expect(front).toBeGreaterThan(m[2] - 0.01);
      expect(front).toBeLessThan(m[2] + 0.005);
    });
  }
});

/**
 * U-004: the AR's rear sight is a ghost ring, not a porthole. The sight
 * picture round the aim point is open: every ray from the eye within
 * OPEN_DEG of the sight line reaches the front sight unobstructed, so the
 * rear ring frames the post instead of hiding the target round it.
 */
const OPEN_DEG = 2.5;
describe('the AR sight picture is open (U-004)', () => {
  it(`'${weaponAssetId('carbine', 'squad')}': nothing within ${OPEN_DEG}° of the sight line between the eye and the front sight`, () => {
    const mesh = buildWeapon(weaponAssetId('carbine', 'squad').replace('weapon-', ''));
    const { sight, eyeRelief } = createWeaponModel('carbine').spec;
    const eye: V = [sight[0], sight[1], sight[2] - eyeRelief];
    // Up to just short of the front sight's ears, 0.569 m along the bore.
    const reach = 0.565 - eye[2];
    const t = Math.tan((OPEN_DEG * Math.PI) / 180);
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const d: V = [Math.cos(a) * t, Math.sin(a) * t, 1];
      const n = Math.hypot(d[0], d[1], d[2]);
      const dir: V = [d[0] / n, d[1] / n, d[2] / n];
      expect(rayMesh(mesh, eye, dir, reach / dir[2]), `something across the sight picture at ${k * 15}°`).toBeNull();
    }
  });

  it(`'${weaponAssetId('carbine', 'squad')}': the post alone stands up to the line — its ears end well below it`, () => {
    const mesh = buildWeapon(weaponAssetId('carbine', 'squad').replace('weapon-', ''));
    const { sight } = createWeaponModel('carbine').spec;
    // Across the front sight, 8 mm under the line, beside the post: nothing (the ears are lower still).
    for (const x of [-0.0075, 0.0075]) {
      expect(rayMesh(mesh, [x, sight[1] - 0.008, 0.52], [0, 0, 1], 0.1), `an ear at x ${x}`).toBeNull();
    }
    // The post itself is there at that height.
    expect(rayMesh(mesh, [0, sight[1] - 0.008, 0.52], [0, 0, 1], 0.1)).not.toBeNull();
  });
});

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
