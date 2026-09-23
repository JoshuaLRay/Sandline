/**
 * Cover query and reservation (T-3.19).
 *
 * Fixture geometry with hand-placed points, so what these prove never moves
 * with the range's data: a crate 1.2 m tall (low cover) at the origin, and a
 * 10 m wall 2.4 m tall (high cover) to the north. The cost test runs the
 * range's committed cover and navmesh, as the session will.
 */
import { describe, expect, it } from 'vitest';
import { SPAWN_POINTS, loadWorld, requireWorld } from '@sandline/shared';
import { COVER, CoverSystem, concealedProbes, firingPosition, parseCoverConfig, protects } from './cover.ts';
import type { CoverPoint } from './nav/baked/types.ts';
import { initNav, pathLength } from './nav/NavMesh.ts';
import { bakedCoverFor, loadWorldNavMesh } from './nav/bakedNav.ts';
import RAW_COVER from './cover.json' with { type: 'json' };

/** Crate: x −0.6..0.6, z −0.6..0.6, 1.2 m. Wall: x −5..5, z 19.85..20.15, 2.4 m. */
const world = loadWorld({
  id: 'cover-fixture',
  floor: { halfExtent: 40 },
  cover: [
    { id: 'crate', x: 0, y: 0, z: 0, w: 1.2, h: 1.2, d: 1.2 },
    { id: 'wall', x: 0, y: 0, z: 20, w: 10, h: 2.4, d: 0.3 },
  ],
});
const boxes = world.boxes;

/** Behind the crate's south face, two of them 0.6 m apart. */
const CRATE_WEST: CoverPoint = { box: 'crate', x: -0.25, y: 0, z: -1.05, nx: 0, nz: -1, height: 'low' };
const CRATE_EAST: CoverPoint = { box: 'crate', x: 0.25, y: 0, z: -1.05, nx: 0, nz: -1, height: 'low' };
/** Behind the middle of the wall's south face: a side step still has the wall in the way. */
const WALL_MIDDLE: CoverPoint = { box: 'wall', x: 0, y: 0, z: 19.4, nx: 0, nz: -1, height: 'high' };
/** Behind the wall's east end: a side step clears it. */
const WALL_END: CoverPoint = { box: 'wall', x: 4.65, y: 0, z: 19.4, nx: 0, nz: -1, height: 'high' };

const eye = (x: number, z: number) => ({ x, y: 1.55, z });
/** North of the crate, in front of the face the points are behind. */
const IN_FRONT = eye(0, 10);
/** South, on the soldiers' own side. */
const BEHIND = eye(0, -10);
/** North of the wall. */
const BEYOND_WALL = eye(0, 30);

describe('cover tuning (T-3.19)', () => {
  it('parses the committed data and refuses bad rows', () => {
    expect(parseCoverConfig(RAW_COVER)).toEqual(COVER);
    expect(() => parseCoverConfig({ ...RAW_COVER, luck: 1 })).toThrow(/luck/);
    expect(() => parseCoverConfig({ ...RAW_COVER, maxPathM: 0 })).toThrow(/maxPathM/);
    expect(() => parseCoverConfig({ ...RAW_COVER, leaveM: 0.1, arriveM: 1 })).toThrow(/leaveM/);
    expect(() => parseCoverConfig({ ...RAW_COVER, weights: { ...RAW_COVER.weights, crowd: undefined } })).toThrow(/crowd/);
  });
});

describe('protection and firing positions (T-3.19)', () => {
  it('probes a low point crouched and a high one standing', () => {
    expect(concealedProbes(CRATE_WEST).map((p) => p.y).at(-1)).toBeLessThan(1.2);
    expect(concealedProbes(WALL_MIDDLE).map((p) => p.y).at(-1)).toBe(1.55);
  });

  it('a crate protects against a threat in front and not one behind', () => {
    expect(protects(CRATE_WEST, IN_FRONT, boxes)).toBe(true);
    expect(protects(CRATE_WEST, BEHIND, boxes)).toBe(false);
    // Nor one off to the side, with a clear line along the face.
    expect(protects(CRATE_WEST, eye(10, -1.05), boxes)).toBe(false);
  });

  it('fires over low cover standing up, and out of high cover only where a side step clears it', () => {
    expect(firingPosition(CRATE_WEST, IN_FRONT, boxes)).toEqual({ x: -0.25, y: 0, z: -1.05 });
    expect(firingPosition(WALL_MIDDLE, BEYOND_WALL, boxes)).toBeNull();
    const out = firingPosition(WALL_END, BEYOND_WALL, boxes)!;
    expect(out).not.toBeNull();
    expect(out.x).toBeCloseTo(4.65 + COVER.sideStepM, 9);
    expect(out.z).toBe(19.4);
  });
});

describe('the query (T-3.19)', () => {
  it('moving the threat round invalidates the point', () => {
    const cover = new CoverSystem([CRATE_WEST], boxes);
    const choice = cover.choose(1, { from: eye(0, -5), threats: [IN_FRONT] });
    expect(choice?.point).toBe(CRATE_WEST);
    expect(cover.stillProtects(1, [IN_FRONT])).toBe(true);
    // Round to the east, then behind: the crate hides nothing from there.
    expect(cover.stillProtects(1, [eye(10, -1.05)])).toBe(false);
    expect(cover.stillProtects(1, [BEHIND])).toBe(false);
    // And asked again, it offers nothing.
    expect(cover.choose(1, { from: eye(0, -5), threats: [BEHIND] })).toBeNull();
  });

  it('gives two brains asking at once different points', () => {
    const cover = new CoverSystem([CRATE_WEST, CRATE_EAST], boxes);
    const query = { from: eye(0, -5), threats: [IN_FRONT] };
    const a = cover.choose(1, query)!;
    const b = cover.choose(2, query)!;
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a.index).not.toBe(b.index);
    expect(cover.holder(a.index)).toBe(1);
    expect(cover.holder(b.index)).toBe(2);
    // A third finds nothing left.
    expect(cover.choose(3, query)).toBeNull();
  });

  it('never chooses a point with no firing position for combat, though it will to hide', () => {
    const cover = new CoverSystem([WALL_MIDDLE, WALL_END], boxes);
    const from = eye(0, 15);
    // The middle is nearer, and would win on path cost alone.
    const ranked = cover.rank({ from, threats: [BEYOND_WALL] });
    expect(ranked.map((c) => c.point)).toEqual([WALL_END]);
    expect(cover.choose(1, { from, threats: [BEYOND_WALL] })?.point).toBe(WALL_END);
    cover.release(1);
    expect(cover.choose(1, { from, threats: [BEYOND_WALL], combat: false })?.point).toBe(WALL_MIDDLE);
  });

  it('prefers the shorter walk, and avoids a point a friend is crowding', () => {
    const cover = new CoverSystem([CRATE_WEST, CRATE_EAST], boxes);
    expect(cover.rank({ from: eye(-3, -5), threats: [IN_FRONT] })[0]!.point).toBe(CRATE_WEST);
    expect(cover.rank({ from: eye(3, -5), threats: [IN_FRONT] })[0]!.point).toBe(CRATE_EAST);
    // A friend standing west of the west point crowds it, not (as much) the east one.
    const crowded = cover.rank({ from: eye(-3, -5), threats: [IN_FRONT], friends: [{ x: -2.5, y: 0, z: -1.05 }] });
    expect(crowded[0]!.point).toBe(CRATE_EAST);
  });

  it('scores protection by the fraction of threats hidden from', () => {
    const cover = new CoverSystem([CRATE_WEST], boxes);
    const [half] = cover.rank({ from: eye(0, -5), threats: [IN_FRONT, eye(10, -1.05)] });
    expect(half!.protection).toBe(0.5);
    const [full] = cover.rank({ from: eye(0, -5), threats: [IN_FRONT] });
    expect(full!.score - half!.score).toBeCloseTo(COVER.weights.protection * 0.5, 9);
  });

  it('drops a point the path cost cannot reach, or reaches too far round', () => {
    const cover = new CoverSystem([CRATE_WEST], boxes, () => null);
    expect(cover.rank({ from: eye(0, -5), threats: [IN_FRONT] })).toEqual([]);
    const long = new CoverSystem([CRATE_WEST], boxes, () => COVER.maxPathM + 1);
    expect(long.rank({ from: eye(0, -5), threats: [IN_FRONT] })).toEqual([]);
  });
});

describe('reservations (T-3.19)', () => {
  it('releases when the holder leaves the point it reached, or dies, or asks again', () => {
    const cover = new CoverSystem([CRATE_WEST, CRATE_EAST], boxes);
    const query = { from: eye(0, -5), threats: [IN_FRONT] };
    const a = cover.choose(1, query)!;
    // Still walking there: far, but not yet arrived, so kept.
    cover.track(1, { x: 0, y: 0, z: -5 }, true);
    expect(cover.holder(a.index)).toBe(1);
    cover.track(1, a.point, true);
    cover.track(1, { x: a.point.x, y: 0, z: a.point.z - COVER.leaveM * 0.5 }, true);
    expect(cover.holder(a.index)).toBe(1);
    cover.track(1, { x: a.point.x, y: 0, z: a.point.z - COVER.leaveM - 0.1 }, true);
    expect(cover.holder(a.index)).toBeNull();
    expect(cover.heldPoint(1)).toBeNull();

    const b = cover.choose(2, query)!;
    cover.track(2, { x: 0, y: 0, z: -5 }, false);
    expect(cover.holder(b.index)).toBeNull();

    // Asking again gives up the old point.
    const c = cover.choose(3, { ...query, from: eye(-3, -5) })!;
    const d = cover.choose(3, { ...query, from: eye(3, -5) })!;
    expect(c.point).toBe(CRATE_WEST);
    expect(d.point).toBe(CRATE_EAST);
    expect(cover.holder(c.index)).toBeNull();
    expect(cover.holder(d.index)).toBe(3);
  });
});

describe('the query on the range (T-3.19)', () => {
  it('logs what 40 brains asking in one tick cost, on the committed cover and mesh', async () => {
    await initNav();
    const mesh = loadWorldNavMesh('range');
    const range = requireWorld('range');
    const points = bakedCoverFor('range');
    const cover = new CoverSystem(points, range.boxes, (a, b) => {
      const path = mesh.path(a, b);
      return path ? pathLength(path.points) : null;
    });
    const threats = SPAWN_POINTS.map((p) => eye(p.x, p.z));
    // Forty brains strewn up the range north of the spawn line, clear of the lane.
    const brains = Array.from({ length: 40 }, (_, i) => ({ x: -18 + (i % 8) * 5 + 0.5, y: 0, z: 2 + Math.floor(i / 8) * 4 + 0.5 }));
    const queryOf = (i: number) => ({ from: brains[i]!, threats, friends: brains.filter((_, j) => j !== i) });
    // A first round warms the engine; the second is the steady state, with the
    // threats a centimetre on so every sight is traced afresh, as a new tick's are.
    const round = (shift: number) => {
      const system = new CoverSystem(points, range.boxes, (a, b) => {
        const path = mesh.path(a, b);
        return path ? pathLength(path.points) : null;
      });
      const moved = threats.map((t) => ({ ...t, x: t.x + shift }));
      const t0 = performance.now();
      brains.forEach((from, i) => system.choose(100 + i, { from, threats: moved, friends: brains.filter((_, j) => j !== i) }));
      return performance.now() - t0;
    };
    const cold = round(0.01);
    const warm = round(0.02);
    const choices = brains.map((_, i) => cover.choose(100 + i, queryOf(i)));
    const chosen = choices.filter((c) => c !== null);
    console.log(
      `cover query: 40 brains in ${warm.toFixed(1)} ms warm (${((warm * 1000) / 40).toFixed(0)} µs each; ${cold.toFixed(1)} ms cold) ` +
        `over ${points.length} points, ${cover.pathQueries} path queries; ${chosen.length} got cover`,
    );
    // The bound is exact: every brain's choice is the top of the full ranking,
    // made with the reservations as they stood when it asked.
    const replay = new CoverSystem(points, range.boxes, (a, b) => {
      const path = mesh.path(a, b);
      return path ? pathLength(path.points) : null;
    });
    brains.forEach((_, i) => {
      const full = replay.rank(queryOf(i), 100 + i)[0] ?? null;
      expect(full?.index ?? null).toBe(choices[i]?.index ?? null);
      replay.choose(100 + i, queryOf(i));
    });
    expect(chosen.length).toBeGreaterThan(0);
    // No point is given twice.
    expect(new Set(chosen.map((c) => c.index)).size).toBe(chosen.length);
    // Everything chosen hides from at least one of the six and can fire on one.
    for (const c of chosen) {
      expect(c.protection).toBeGreaterThan(0);
      expect(c.firingFrom).not.toBeNull();
    }
    mesh.destroy();
  });
});
