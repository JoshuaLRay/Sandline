/**
 * Cover points in the bake (T-3.18).
 *
 * Read from the COMMITTED range bake wherever the question is about the range,
 * as the server will read them, and regenerated from the live data to prove
 * the committed list is what the rule makes. Geometry-only cases (a gap too
 * narrow to stand in) bake a world of their own.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MOVE_CONFIG, WORLD_IDS, type World, loadWorld, requireWorld } from '@sandline/shared';
import RANGE_FILE from '../../../shared/src/data/worlds/range.json' with { type: 'json' };
import { NavMesh, initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { bakedCoverFor, bakedNavFor, loadWorldNavMesh } from '../../../server/src/ai/nav/bakedNav.ts';
import type { CoverPoint } from '../../../server/src/ai/nav/baked/types.ts';
import { DEFAULT_NAV_AGENT, NAV_CELL, bakeWorld, navBakeHash, onMesh } from './bake.ts';
import {
  COVER_MARGIN_M,
  DEFAULT_COVER_EYES,
  bodyBlocked,
  coverCounts,
  coverEyesFrom,
  coverPoints,
  heightClass,
} from './cover.ts';

const range = requireWorld('range');
const R = DEFAULT_NAV_AGENT.radius;

/** Horizontal distance from a point to a box's footprint. */
function toBox(p: { x: number; z: number }, box: World['boxes'][number]): number {
  const cx = Math.min(box.maxX, Math.max(box.minX, p.x));
  const cz = Math.min(box.maxZ, Math.max(box.minZ, p.z));
  return Math.sqrt((cx - p.x) ** 2 + (cz - p.z) ** 2);
}

function boxOf(world: World, point: CoverPoint) {
  const box = world.boxes.find((b) => b.id === point.box);
  expect(box, `no box '${point.box}'`).toBeDefined();
  return box!;
}

describe('cover height classes and eyes (T-3.18)', () => {
  it('derives the eyes from the controller and the rig, and stands one voxel off the mesh edge', () => {
    expect(DEFAULT_COVER_EYES.standing).toBe(1.55);
    expect(DEFAULT_COVER_EYES.crouched).toBeCloseTo(DEFAULT_MOVE_CONFIG.crouchHeight - (DEFAULT_MOVE_CONFIG.height - 1.55), 12);
    expect(DEFAULT_COVER_EYES.crouched).toBeLessThan(DEFAULT_COVER_EYES.standing);
    expect(COVER_MARGIN_M).toBe(NAV_CELL.cs);
  });

  it('is low between the eyes, high at or over the standing eye, and nothing under the crouched eye', () => {
    const eyes = { standing: 1.5, crouched: 0.9 };
    expect(heightClass(0.4, eyes)).toBeNull();
    expect(heightClass(0.9, eyes)).toBeNull();
    expect(heightClass(1.0, eyes)).toBe('low');
    expect(heightClass(1.49, eyes)).toBe('low');
    expect(heightClass(1.5, eyes)).toBe('high');
    expect(heightClass(2.4, eyes)).toBe('high');
  });
});

describe('the range cover, from the committed bake (T-3.18)', () => {
  let mesh: NavMesh;
  const cover = bakedCoverFor('range');
  beforeAll(async () => {
    await initNav();
    mesh = loadWorldNavMesh('range');
  });

  it('logs the counts per world, and is exactly what the rule makes from the live data', () => {
    for (const id of WORLD_IDS) {
      const baked = bakedNavFor(id)!;
      const counts = coverCounts(baked.cover);
      console.log(`cover '${id}': ${counts.total} points, ${counts.low} low, ${counts.high} high`);
      expect(counts.total).toBeGreaterThan(0);
      const live = loadWorldNavMesh(id);
      expect(coverPoints(requireWorld(id), DEFAULT_NAV_AGENT, (p) => onMesh(live, p, DEFAULT_NAV_AGENT.climb))).toEqual(baked.cover);
      live.destroy();
    }
  });

  it('has every point on the mesh, within a capsule radius of its box, and on the side its normal says', () => {
    for (const p of cover) {
      expect(onMesh(mesh, p, DEFAULT_NAV_AGENT.climb), `${p.box} point off the mesh`).toBe(true);
      const box = boxOf(range, p);
      // The capsule's surface is at most one radius from the box, and clear of it.
      const gap = toBox(p, box) - R;
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThanOrEqual(R);
      // One of the four axis normals, pointing from the box to the soldier.
      expect(Math.abs(p.nx) + Math.abs(p.nz)).toBe(1);
      const centreX = (box.minX + box.maxX) / 2;
      const centreZ = (box.minZ + box.maxZ) / 2;
      expect((p.x - centreX) * p.nx + (p.z - centreZ) * p.nz).toBeGreaterThan(0);
    }
  });

  it('gives the low wall low points and the east and west walls high ones, on both faces', () => {
    const of = (id: string) => cover.filter((p) => p.box === id);
    const low = of('low-wall');
    expect(low.length).toBeGreaterThan(0);
    expect(low.every((p) => p.height === 'low')).toBe(true);
    expect(new Set(low.map((p) => p.nz))).toEqual(new Set([-1, 1]));
    for (const id of ['west-wall-a', 'west-wall-b', 'east-wall-a', 'east-wall-b']) {
      const high = of(id);
      expect(high.length, id).toBeGreaterThan(0);
      expect(high.every((p) => p.height === 'high'), id).toBe(true);
      expect(new Set(high.map((p) => p.nz)), id).toEqual(new Set([-1, 1]));
    }
    // A post is narrower than a soldier and a rail is under the crouched eye: neither hides anybody.
    expect(cover.some((p) => p.box.startsWith('post') || p.box.startsWith('rail'))).toBe(false);
  });

  it('puts no point inside a box, nor where the body would overlap one', () => {
    for (const p of cover) {
      expect(bodyBlocked(p.x, p.y, p.z, range, DEFAULT_NAV_AGENT), `${p.box} (${p.x}, ${p.z})`).toBe(false);
      for (const b of range.boxes) {
        const inside = p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ && p.y < b.maxY;
        expect(inside, `${p.box} point inside '${b.id}'`).toBe(false);
      }
    }
    // Crate A and crate B stand 0.2 m apart: the faces that look at each other give nothing.
    expect(cover.some((p) => p.box === 'crate-a' && p.nx === -1)).toBe(false);
    expect(cover.some((p) => p.box === 'crate-b' && p.nx === 1)).toBe(false);
  });
});

describe('cover in a gap too narrow to stand in (T-3.18)', () => {
  /** Two tall walls along x, their inner faces `gap` apart across z = 0..gap. */
  function corridor(gap: number): World {
    return loadWorld({
      id: 'corridor',
      floor: { halfExtent: 20 },
      cover: [
        { id: 'south', x: 0, y: 0, z: -0.15, w: 8, h: 2.4, d: 0.3 },
        { id: 'north', x: 0, y: 0, z: gap + 0.15, w: 8, h: 2.4, d: 0.3 },
      ],
    });
  }

  async function coverOf(world: World): Promise<CoverPoint[]> {
    await initNav();
    const mesh = NavMesh.load(await bakeWorld(world));
    const points = coverPoints(world, DEFAULT_NAV_AGENT, (p) => onMesh(mesh, p, DEFAULT_NAV_AGENT.climb));
    mesh.destroy();
    return points;
  }

  it('generates none between walls 0.6 m apart (a soldier is 0.7 m), and the outer faces still get theirs', async () => {
    const gap = 0.6;
    const points = await coverOf(corridor(gap));
    expect(points.filter((p) => p.z > 0 && p.z < gap)).toEqual([]);
    expect(points.some((p) => p.box === 'south' && p.nz === -1)).toBe(true);
    expect(points.some((p) => p.box === 'north' && p.nz === 1)).toBe(true);
  });

  it('generates both inner faces when the gap is wide enough to stand in', async () => {
    const gap = 2;
    const points = await coverOf(corridor(gap));
    expect(points.some((p) => p.box === 'south' && p.nz === 1)).toBe(true);
    expect(points.some((p) => p.box === 'north' && p.nz === -1)).toBe(true);
  });
});

describe('cover is under the bake hash (T-3.18)', () => {
  it('goes stale when a box is edited, and when the eyes it is classed by change', () => {
    const committed = bakedNavFor('range')!.hash;
    const taller = structuredClone(RANGE_FILE) as { cover: { id: string; h: number }[] };
    taller.cover.find((b) => b.id === 'low-wall')!.h = 1.6;
    expect(navBakeHash(loadWorld(taller))).not.toBe(committed);
    const lowerCrouch = coverEyesFrom({ ...DEFAULT_MOVE_CONFIG, crouchHeight: 1.0 });
    expect(navBakeHash(range, DEFAULT_NAV_AGENT, lowerCrouch)).not.toBe(committed);
    expect(navBakeHash(range)).toBe(committed);
  });
});
