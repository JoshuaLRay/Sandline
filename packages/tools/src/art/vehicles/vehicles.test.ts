/**
 * U-126: the generated tank. It is committed exactly as its generator writes it and is within its budget class.
 * What you see is what can be shot (the hull and turret capsules' bounds, the gun aside). The turret turns about
 * the capsule's axis (in the shipped copy too), every UV lands in a painted region, and every face is wound to its
 * normal.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSET_MANIFEST, checkBudgets, getEnemy } from '@sandline/shared';
import { createIO, sha256 } from '../../assets/pipeline.ts';
import { uvRects } from './atlas.ts';
import { TURRET_NODE, vehicleDocuments } from './index.ts';
import type { BuiltMesh } from './mesh.ts';
import { buildTank, tankDims } from './tank.ts';

const REPO = new URL('../../../../../', import.meta.url);
const tank = getEnemy('tank');
const v = tank.vehicle!;
const built = buildTank(tank);

function vertices(m: BuiltMesh, offset: readonly number[] = [0, 0, 0]): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < m.positions.length; i += 3) out.push([m.positions[i]! + offset[0]!, m.positions[i + 1]! + offset[1]!, m.positions[i + 2]! + offset[2]!]);
  return out;
}

describe('the generated tank (U-126)', () => {
  for (const doc of vehicleDocuments()) {
    it(`'${doc.id}' is committed exactly as its generator writes it — else run pnpm gen:art && pnpm gen:assets`, { timeout: 60_000 }, async () => {
      const io = await createIO();
      const committed = new Uint8Array(readFileSync(new URL(`assets/src/${doc.id}.glb`, REPO)));
      expect(sha256(committed), `'${doc.id}' is stale — run pnpm gen:art && pnpm gen:assets`).toBe(sha256(await io.writeBinary(doc.document())));
    });
  }

  it('is in the manifest as a vehicle, every triangle counted, within its budget', () => {
    const entry = ASSET_MANIFEST.assets.find((a) => a.id === 'vehicle-tank');
    expect(entry, 'vehicle-tank is not in the manifest — run pnpm gen:assets').toBeDefined();
    expect(entry!.class).toBe('vehicle');
    expect(entry!.triangles).toBe((built.hull.indices.length + built.turret.indices.length) / 3);
    expect(entry!.materials).toBe(1);
    expect(checkBudgets({ version: 1, assets: [entry!] })).toEqual([]);
  });

  it('is two nodes: the hull at the feet, its child the turret at the turret capsule\'s axis on the roof', () => {
    const doc = vehicleDocuments()[0]!.document();
    const [hull] = doc.getRoot().getDefaultScene()!.listChildren();
    expect(hull!.getName()).toBe('vehicle-tank');
    expect(hull!.getTranslation()).toEqual([0, 0, 0]);
    const turret = hull!.listChildren();
    expect(turret.map((n) => n.getName())).toEqual([TURRET_NODE]);
    const [x, , z] = turret[0]!.getTranslation();
    expect([x, z]).toEqual([v.turret.from[0], v.turret.from[2]]);
    // A bare pivot: its mesh hangs under it, where quantizing cannot move the pivot.
    expect(turret[0]!.getMesh()).toBeNull();
    expect(turret[0]!.listChildren().map((n) => [n.getName(), n.getMesh() !== null])).toEqual([[`${TURRET_NODE}-mesh`, true]]);
    expect(doc.getRoot().listMaterials()).toHaveLength(1);
  });

  it('keeps the turret\'s pivot through the pipeline: the committed web copy still turns about it', async () => {
    const io = await createIO();
    const web = await io.readBinary(new Uint8Array(readFileSync(new URL('packages/client/public/assets/vehicle-tank.glb', REPO))));
    const pivot = web.getRoot().listNodes().find((n) => n.getName() === TURRET_NODE)!;
    pivot.getTranslation().forEach((n, i) => expect(n).toBeCloseTo(built.pivot[i]!, 6));
    expect(pivot.getScale()).toEqual([1, 1, 1]);
    expect(pivot.getRotation()).toEqual([0, 0, 0, 1]);
  });

  it('draws nothing of the hull outside the hull capsule\'s bounds, and stands on the ground', () => {
    const r = v.hull.radius;
    const [z0, z1] = [Math.min(v.hull.from[2], v.hull.to[2]) - r, Math.max(v.hull.from[2], v.hull.to[2]) + r];
    const pts = vertices(built.hull);
    const ys = pts.map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(0, 6);
    for (const [x, y, z] of pts) {
      expect(Math.abs(x), `x ${x}`).toBeLessThanOrEqual(r + 1e-6);
      expect(z, `z ${z}`).toBeGreaterThanOrEqual(z0 - 1e-6);
      expect(z, `z ${z}`).toBeLessThanOrEqual(z1 + 1e-6);
      expect(y, `y ${y}`).toBeLessThanOrEqual(v.hull.from[1] + r + 1e-6);
    }
  });

  it('draws the turret inside its capsule\'s bounds, all but the gun, which lies along the cannon\'s line', () => {
    const d = tankDims(tank);
    const r = v.turret.radius;
    const [y0, y1] = [Math.min(v.turret.from[1], v.turret.to[1]) - r, Math.max(v.turret.from[1], v.turret.to[1]) + r];
    let gun = 0;
    let tip = -Infinity;
    for (const [x, y, z] of vertices(built.turret, d.pivot)) {
      const local = z - d.pivot[2];
      if (local > r) {
        // Ahead of the turret: the gun and the barrels beside it, near the cannon's line, and nothing past the tip.
        gun++;
        tip = Math.max(tip, local);
        expect(Math.abs(x - v.cannon.muzzle[0]), `gun x ${x}`).toBeLessThan(0.3);
        expect(Math.abs(y - v.cannon.muzzle[1]), `gun y ${y}`).toBeLessThan(0.3);
        continue;
      }
      expect(Math.abs(x - d.pivot[0]), `x ${x}`).toBeLessThanOrEqual(r + 1e-6);
      expect(local, `z ${z}`).toBeGreaterThanOrEqual(-r - 1e-6);
      expect(y, `y ${y}`).toBeGreaterThanOrEqual(y0 - 1e-6);
      expect(y, `y ${y}`).toBeLessThanOrEqual(y1 + 1e-6);
    }
    expect(gun).toBeGreaterThan(0);
    expect(tip).toBeCloseTo(built.gunTip, 5);
    // The drawn gun reaches past the data's muzzle, and past the hull's nose.
    expect(built.gunTip + d.pivot[2]).toBeGreaterThan(v.cannon.muzzle[2]);
    expect(built.gunTip + d.pivot[2]).toBeGreaterThan(d.front);
  });

  it('keeps every UV inside a painted region of the atlas', () => {
    const rects = uvRects();
    for (const m of [built.hull, built.turret]) {
      for (let i = 0; i < m.uvs.length; i += 2) {
        const [u, w] = [m.uvs[i]!, m.uvs[i + 1]!];
        // Within the 1e-5 the builder rounds to.
        expect(rects.some((q) => u >= q.u0 - 1e-5 && u <= q.u1 + 1e-5 && w >= q.v0 - 1e-5 && w <= q.v1 + 1e-5), `uv ${u},${w}`).toBe(true);
      }
    }
  });

  it('winds every triangle to face its normal, and has none degenerate', () => {
    for (const m of [built.hull, built.turret]) {
      let wrong = 0;
      for (let t = 0; t < m.indices.length; t += 3) {
        const idx = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!];
        const P = (i: number) => [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!];
        const [pa, pb, pc] = idx.map(P) as [number[], number[], number[]];
        const e1 = [pb[0]! - pa[0]!, pb[1]! - pa[1]!, pb[2]! - pa[2]!];
        const e2 = [pc[0]! - pa[0]!, pc[1]! - pa[1]!, pc[2]! - pa[2]!];
        const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
        expect(Math.hypot(n[0]!, n[1]!, n[2]!)).toBeGreaterThan(0);
        const vn = [0, 1, 2].map((k) => idx.reduce((s, i) => s + m.normals[i * 3 + k]!, 0));
        if (n[0]! * vn[0]! + n[1]! * vn[1]! + n[2]! * vn[2]! < 0) wrong++;
      }
      expect(wrong).toBe(0);
    }
  });

  it('builds the same mesh every time', () => {
    const again = buildTank(tank);
    expect(again.hull).toEqual(built.hull);
    expect(again.turret).toEqual(built.turret);
  });
});
