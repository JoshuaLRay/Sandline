import { describe, expect, it } from 'vitest';
import { RANGE_TARGETS } from './range.ts';
import { SPAWN_POINTS } from './damage.ts';
import {
  DEFAULT_WORLD,
  DEFAULT_WORLD_ID,
  WORLD_IDS,
  FLOOR_MARGIN_M,
  type WorldBox,
  figureBox,
  getWorld,
  loadWorld,
  railBoxes,
  requireWorld,
  boxCentre,
  boxFrom,
  loadCover,
  overlapsFootprint,
  postBoxes,
  WIRE_POINT_TOLERANCE_M,
  rayWorld,
  surfaceAt,
} from './world.ts';
import { POSITION, dequantize, quantize } from '../net/quantize.ts';

const box = (id: string, x: number, y: number, z: number, w: number, h: number, d: number): WorldBox =>
  boxFrom({ id, x, y, z, w, h, d }, 'cover');

describe('the shared world (T-1.12)', () => {
  it('turns an authored spec into a box and back', () => {
    const b = box('b', 1, 0, 2, 4, 2, 6);
    expect(b).toMatchObject({ minX: -1, maxX: 3, minY: 0, maxY: 2, minZ: -1, maxZ: 5 });
    expect(boxCentre(b)).toEqual({ x: 1, y: 1, z: 2, w: 4, h: 2, d: 6 });
  });

  it('generates the post grid the client used to draw, minus the firing lane column', () => {
    const posts = postBoxes();
    // 9 x 9 grid, less the spawn cell and the four posts up-range of it at x = 0.
    expect(posts).toHaveLength(9 * 9 - 5);
    expect(posts.find((p) => p.minX < 0 && p.maxX > 0 && p.minZ < 0 && p.maxZ > 0)).toBeUndefined();
    expect(posts.find((p) => p.minX < 0 && p.maxX > 0 && p.minZ > 0)).toBeUndefined();
    expect(posts.filter((p) => p.kind === 'post-major')).toHaveLength(5 * 5 - 3);
    const major = posts.find((p) => p.kind === 'post-major') as WorldBox;
    expect(major.maxY).toBeCloseTo(2.6, 9);
    expect(posts.find((p) => p.kind === 'post-minor')?.maxY).toBeCloseTo(1.4, 9);
  });

  it('refuses malformed cover data rather than loading a world nobody meant', () => {
    expect(() => loadCover({})).toThrow(/cover/);
    expect(() => loadCover({ cover: [{ id: 'x', x: 0, y: 0, z: 0, w: 1, h: 1 }] })).toThrow(/not a box spec/);
    expect(() => loadCover({ cover: [{ id: 'x', x: 0, y: 0, z: 0, w: 0, h: 1, d: 1 }] })).toThrow(/non-positive/);
    expect(() =>
      loadCover({ cover: [{ id: 'x', x: 0, y: 0, z: 0, w: 1, h: 1, d: 1 }, { id: 'x', x: 5, y: 0, z: 0, w: 1, h: 1, d: 1 }] }),
    ).toThrow(/duplicate/);
  });

  it('lets a soldier walk straight up-range from every spawn slot without hitting anything for 12 m', () => {
    // The slot-reuse test in Session.test.ts walks slot 0 forward and expects
    // it to move; a wall across a spawn lane would fail it, and would be a
    // poor range regardless.
    const half = 0.35;
    for (const spawn of SPAWN_POINTS) {
      for (let z = spawn.z; z <= spawn.z + 12; z += 0.1) {
        const blocking = DEFAULT_WORLD.filter((b) => b.maxY > 0.45 && overlapsFootprint(spawn.x, z, half, b));
        expect(blocking.map((b) => b.id), `slot at x=${spawn.x}, z=${z.toFixed(1)}`).toEqual([]);
      }
    }
  });

  it('keeps every spawn point and every range target clear of solid scenery', () => {
    // A soldier standing on a spawn or a range target must not start inside a
    // box: the controller can only push out along the axis it is moving.
    const half = 0.35;
    for (const p of [...SPAWN_POINTS, ...RANGE_TARGETS]) {
      const inside = DEFAULT_WORLD.filter((b) => b.minY < 1.8 && overlapsFootprint(p.x, p.z, half, b));
      expect(inside.map((b) => b.id)).toEqual([]);
    }
  });

  it('keeps the firing lane open: from every spawn slot, a shot reaches every range target', () => {
    // Eye at 1.55 m over the spawn, aimed at the target's chest (0.9 m up):
    // the same geometry fire.test.ts uses, and the reason the x = 0 posts went.
    for (const spawn of SPAWN_POINTS) {
      for (const target of RANGE_TARGETS) {
        const o = { x: spawn.x, y: spawn.y + 1.55, z: spawn.z };
        const dx = target.x - o.x;
        const dy = target.y + 0.9 - o.y;
        const dz = target.z - o.z;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const hit = rayWorld({ origin: o, direction: { x: dx / len, y: dy / len, z: dz / len }, maxDistance: len }, DEFAULT_WORLD);
        expect(hit?.box.id ?? null, `from slot at x=${spawn.x} to ${target.label}`).toBeNull();
      }
    }
  });
});

describe('rayWorld', () => {
  const wall = box('wall', 0, 0, 10, 4, 2.4, 0.3);

  it('reports the near face of the first box along the ray, with the point on it', () => {
    const hit = rayWorld({ origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 100 }, [wall]);
    expect(hit?.box.id).toBe('wall');
    expect(hit?.distance).toBeCloseTo(10 - 0.15, 9);
    expect(hit?.point).toEqual({ x: 0, y: 1, z: 10 - 0.15 });
  });

  it('misses beside, above, behind and beyond', () => {
    const ray = (o: { x: number; y: number; z: number }, max = 100) => ({ origin: o, direction: { x: 0, y: 0, z: 1 }, maxDistance: max });
    expect(rayWorld(ray({ x: 2.5, y: 1, z: 0 }), [wall])).toBeNull();
    expect(rayWorld(ray({ x: 0, y: 2.5, z: 0 }), [wall])).toBeNull();
    expect(rayWorld(ray({ x: 0, y: 1, z: 11 }), [wall])).toBeNull();
    expect(rayWorld(ray({ x: 0, y: 1, z: 0 }, 5), [wall])).toBeNull();
  });

  it('handles a ray that does not move along an axis without dividing by zero', () => {
    // Straight up from under the wall's footprint: hits the bottom face.
    const up = rayWorld({ origin: { x: 0, y: -1, z: 10 }, direction: { x: 0, y: 1, z: 0 }, maxDistance: 10 }, [wall]);
    expect(up?.distance).toBeCloseTo(1, 9);
    expect(Number.isNaN(up?.distance)).toBe(false);
  });

  it('starts inside a box at distance zero', () => {
    const hit = rayWorld({ origin: { x: 0, y: 1, z: 10 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 10 }, [wall]);
    expect(hit?.distance).toBe(0);
  });

  it('picks the nearest of several boxes', () => {
    const near = box('near', 0, 0, 5, 1, 1, 1);
    const hit = rayWorld({ origin: { x: 0, y: 0.5, z: 0 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 100 }, [wall, near]);
    expect(hit?.box.id).toBe('near');
  });

  it('is exact: the same ray against the same world gives the same numbers', () => {
    const ray = { origin: { x: 0.123, y: 1.456, z: -7.89 }, direction: { x: 0.267, y: -0.1, z: 0.9585 }, maxDistance: 250 };
    const a = rayWorld(ray, DEFAULT_WORLD);
    const b = rayWorld(ray, [...DEFAULT_WORLD]);
    expect(a).toEqual(b);
  });
});

describe('surfaceAt: which face a server point lies on (T-2.11)', () => {
  const wall = DEFAULT_WORLD.find((b) => b.id === 'west-wall-b');
  if (!wall) throw new Error('fixture: west-wall-b missing');
  /** From the spawn line (z = -6, eye height) toward the doorway wall's south face. */
  const eye = { x: 0, y: 1.55, z: -6 };
  const towards = (x: number, y: number, z: number) => {
    const dx = x - eye.x;
    const dy = y - eye.y;
    const dz = z - eye.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return { x: dx / len, y: dy / len, z: dz / len };
  };

  it('finds the doorway wall under the server\'s stopping point, every time', () => {
    for (let i = 0; i < 20; i += 1) {
      // Sweep the face just east of the doorway (x -7.6 .. -6.4): clear of the
      // reference figure at x -4.5, which shadows the wall's east end from here.
      const aimX = -7.6 + (i / 19) * 1.2;
      const aimY = 0.3 + (i % 5) * 0.45;
      const hit = rayWorld({ origin: eye, direction: towards(aimX, aimY, wall.minZ), maxDistance: 100 }, DEFAULT_WORLD);
      expect(hit?.box.id).toBe('west-wall-b');
      if (!hit) return;
      const surface = surfaceAt(hit.point, DEFAULT_WORLD);
      expect(surface?.box.id).toBe('west-wall-b');
      expect(surface?.normal).toEqual({ x: 0, y: 0, z: -1 });
      expect(surface?.point.z).toBe(wall.minZ);
    }
  });

  it('still finds the face after the point has been through the wire, and snaps it back on', () => {
    const wire = (v: number) => dequantize(quantize(v, POSITION), POSITION);
    for (let i = 0; i < 20; i += 1) {
      const aimX = -7.6 + (i / 19) * 1.2;
      const aimY = 0.3 + (i % 5) * 0.45;
      const hit = rayWorld({ origin: eye, direction: towards(aimX, aimY, wall.minZ), maxDistance: 100 }, DEFAULT_WORLD);
      if (!hit) throw new Error('the sweep must hit the wall');
      const arrived = { x: wire(hit.point.x), y: wire(hit.point.y), z: wire(hit.point.z) };
      expect(Math.abs(arrived.z - wall.minZ)).toBeLessThanOrEqual(WIRE_POINT_TOLERANCE_M / 2 + 1e-12);
      const surface = surfaceAt(arrived, DEFAULT_WORLD);
      expect(surface?.box.id).toBe('west-wall-b');
      expect(surface?.point).toEqual({ x: arrived.x, y: arrived.y, z: wall.minZ });
    }
  });

  it('is null for a max-range miss in the air and for the ground, which the server does not have', () => {
    const miss = towards(0, 1.55, 40);
    expect(surfaceAt({ x: eye.x + miss.x * 100, y: eye.y + miss.y * 100, z: eye.z + miss.z * 100 }, DEFAULT_WORLD)).toBeNull();
    expect(surfaceAt({ x: 0, y: 0, z: 0 }, DEFAULT_WORLD)).toBeNull();
    expect(surfaceAt({ x: 0, y: -3, z: 20 }, DEFAULT_WORLD)).toBeNull();
  });

  it('reports the top of a crate and the far side of a wall with the right normals', () => {
    const crate = DEFAULT_WORLD.find((b) => b.id === 'crate-a');
    if (!crate) throw new Error('fixture: crate-a missing');
    expect(surfaceAt({ x: -9, y: crate.maxY, z: 9 }, DEFAULT_WORLD)?.normal).toEqual({ x: 0, y: 1, z: 0 });
    expect(surfaceAt({ x: -6, y: 1, z: wall.maxZ }, DEFAULT_WORLD)?.normal).toEqual({ x: 0, y: 0, z: 1 });
    expect(surfaceAt({ x: wall.minX, y: 1, z: 4 }, DEFAULT_WORLD)?.normal).toEqual({ x: -1, y: 0, z: 0 });
  });

  it('does not claim a point deep inside a box or just beyond the tolerance', () => {
    const tol = WIRE_POINT_TOLERANCE_M;
    expect(surfaceAt({ x: -6, y: 1, z: 4 }, DEFAULT_WORLD)).toBeNull();
    expect(surfaceAt({ x: -6, y: 1, z: wall.minZ - tol * 1.5 }, DEFAULT_WORLD)).toBeNull();
    expect(surfaceAt({ x: -6, y: 1, z: wall.minZ - tol * 0.5 }, DEFAULT_WORLD)?.normal).toEqual({ x: 0, y: 0, z: -1 });
    // A caller may ask for exactness.
    expect(surfaceAt({ x: -6, y: 1, z: wall.minZ - 0.002 }, DEFAULT_WORLD, 1e-3)).toBeNull();
  });
});

describe('named worlds (T-3.02)', () => {
  it('the range is box-for-box what DEFAULT_WORLD was: posts, rails, figure, then cover', () => {
    const range = requireWorld('range');
    expect(range.id).toBe(DEFAULT_WORLD_ID);
    expect(range.boxes).toBe(DEFAULT_WORLD);
    expect(range.boxes).toEqual([...postBoxes(), ...railBoxes(), figureBox(), ...loadCover()]);
    expect(WORLD_IDS).toContain('range');
  });

  it('gives a world only the generated pieces its file asks for', () => {
    const cover = [{ id: 'c', x: 0, y: 0, z: 0, w: 1, h: 1, d: 1 }];
    expect(loadWorld({ id: 'bare', cover }).boxes.map((b) => b.kind)).toEqual(['cover']);
    const railed = loadWorld({ id: 'railed', generate: ['rails'], cover });
    expect(railed.boxes.map((b) => b.kind)).toEqual(['rail', 'rail', 'cover']);
  });

  it('refuses a malformed world file at load, with what was wrong', () => {
    const cover: unknown[] = [];
    expect(() => loadWorld(null)).toThrow(/expected an object/);
    expect(() => loadWorld({ cover })).toThrow(/id must match/);
    expect(() => loadWorld({ id: 'Has Spaces', cover })).toThrow(/id must match/);
    expect(() => loadWorld({ id: 'ok', generate: ['moat'], cover })).toThrow(/generate must list only/);
    expect(() => loadWorld({ id: 'ok' })).toThrow(/cover/);
  });

  it('answers an unknown id with undefined, or a throw naming the ids it has', () => {
    expect(getWorld('atlantis')).toBeUndefined();
    expect(() => requireWorld('atlantis')).toThrow(/unknown world 'atlantis'.*range/);
  });
});

describe('a world names its floor (T-3.03)', () => {
  const cover = [{ id: 'c', x: 12, y: 0, z: -3, w: 2, h: 1, d: 2 }];
  it('takes the file floor when it has one: the range stands on 100 m either way', () => {
    expect(requireWorld('range').floorHalfExtent).toBe(100);
    expect(loadWorld({ id: 'f', floor: { halfExtent: 30 }, cover }).floorHalfExtent).toBe(30);
  });
  it('otherwise derives it from the outermost box plus the margin', () => {
    expect(loadWorld({ id: 'f', cover }).floorHalfExtent).toBe(13 + FLOOR_MARGIN_M);
  });
  it('refuses a floor that is not a positive size', () => {
    expect(() => loadWorld({ id: 'f', floor: { halfExtent: 0 }, cover })).toThrow(/floor.halfExtent/);
    expect(() => loadWorld({ id: 'f', floor: 5, cover })).toThrow(/floor.halfExtent/);
  });
});
