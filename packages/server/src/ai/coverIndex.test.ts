/**
 * U-081: the cover search costs what the query needs, not what the map holds. A system with points all over a big map
 * answers exactly as the same system with only the points near the asker would, and traces a threat's view of only
 * the points within reach.
 */
import { describe, expect, it } from 'vitest';
import { Sfc32, loadWorld, seedFrom } from '@sandline/shared';
import { COVER, CoverSystem, straightLine } from './cover.ts';
import type { CoverPoint } from './nav/baked/types.ts';

/** A crate at (cx, cz) with two low points behind its south face. */
function cluster(cx: number, cz: number, id: string) {
  const crate = { id: `crate-${id}`, x: cx, y: 0, z: cz, w: 1.2, h: 1.2, d: 1.2 };
  const points: CoverPoint[] = [-0.25, 0.25].map((dx) => ({ box: crate.id, x: cx + dx, y: 0, z: cz - 1.05, nx: 0, nz: -1, height: 'low' as const }));
  return { crate, points };
}

const eye = (x: number, z: number) => ({ x, y: 1.55, z });

/** Crates every 90 m along z (−450..450) and across x, so the map is far larger than one query's reach (30 m). */
function bigMap() {
  const crates: ReturnType<typeof cluster>[] = [];
  for (let ix = -2; ix <= 2; ix++) for (let iz = -5; iz <= 5; iz++) crates.push(cluster(ix * 90 + 0.5, iz * 90 + 0.5, `${ix}-${iz}`));
  const world = loadWorld({ id: 'cover-grid', floor: { halfExtent: 500 }, cover: crates.map((c) => c.crate) });
  return { world, crates, points: crates.flatMap((c) => c.points) };
}

describe('the cover search is indexed (U-081)', () => {
  it('answers as a system with only the nearby points does, wherever on the map it is asked', () => {
    const { world, crates, points } = bigMap();
    const all = new CoverSystem(points, world.boxes);
    const rng = new Sfc32(seedFrom(81, 1));
    let answered = 0;
    for (let i = 0; i < 40; i++) {
      const c = crates[Math.floor(rng.next() * crates.length)]!;
      // Asker beside the cluster, a threat some way north of it (in front of the south face's protection is behind the crate).
      const from = { x: c.crate.x + (rng.next() - 0.5) * 12, y: 0, z: c.crate.z - 8 - rng.next() * 12 };
      const threat = eye(c.crate.x + (rng.next() - 0.5) * 6, c.crate.z + 8 + rng.next() * 10);
      const near = new CoverSystem(
        points.filter((p) => straightLine(from, { x: p.x, y: p.y, z: p.z }) <= COVER.maxPathM),
        world.boxes,
      );
      const query = { from, threats: [threat], combat: false };
      const a = all.rank(query).map((r) => [r.point.x, r.point.z, r.score, r.pathM, r.protection]);
      const b = near.rank(query).map((r) => [r.point.x, r.point.z, r.score, r.pathM, r.protection]);
      expect(a).toEqual(b);
      if (a.length > 0) answered++;
    }
    expect(answered).toBeGreaterThan(10);
  });

  it('finds a point across a grid cell edge, at the limit of reach, in any direction', () => {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      // A point just inside the reach, one cell over (cells are 16 m): the grid must look there.
      const from = { x: -15.9, y: 0, z: -15.9 };
      // The crate's points sit up to 1.05 m beyond its centre; keep them inside the 30 m reach.
      const reach = COVER.maxPathM - 1.5;
      const at = cluster(from.x + dx * reach, from.z + dz * reach, 'edge');
      const w = loadWorld({ id: 'cover-edge', floor: { halfExtent: 200 }, cover: [at.crate] });
      const sys = new CoverSystem(at.points, w.boxes);
      // The threat is on the open side of the crate, so its south points hide the soldier.
      const threat = eye(at.crate.x, at.crate.z + 10);
      expect(sys.rank({ from, threats: [threat], combat: false }).length, `direction ${dx},${dz}`).toBeGreaterThan(0);
    }
  });

  it('traces a threat\'s view of the points near the asker only, not of the map', () => {
    const { world, crates, points } = bigMap();
    const sys = new CoverSystem(points, world.boxes);
    const c = crates[40]!;
    const from = { x: c.crate.x, y: 0, z: c.crate.z - 10 };
    sys.rank({ from, threats: [eye(c.crate.x, c.crate.z + 12)], combat: false });
    expect(sys.protectsTraces).toBeGreaterThan(0);
    expect(sys.protectsTraces).toBeLessThanOrEqual(8);
    expect(points.length).toBeGreaterThan(100);
  });

  it('a negative-coordinate map indexes the same as a positive one', () => {
    const a = cluster(-200.5, -300.5, 'neg');
    const w = loadWorld({ id: 'cover-neg', floor: { halfExtent: 400 }, cover: [a.crate] });
    const sys = new CoverSystem(a.points, w.boxes);
    const found = sys.rank({ from: { x: -200, y: 0, z: -312 }, threats: [eye(-200.5, -290)], combat: false });
    expect(found.length).toBeGreaterThan(0);
  });
});
