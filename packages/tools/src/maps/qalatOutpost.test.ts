import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MOVE_CONFIG, blockedAt, boxFrom, rayWorld, supportUnder, type WorldBox } from '@sandline/shared';
import { buildDepotWorld } from './qalatDepot.ts';
import { OUTPOST, buildOutpostShell, buildOutpostWorld, outpostManifest } from './qalatOutpost.ts';

// Independent §8.1 dimensions: neither authoring JSON nor its manifest may
// silently redefine a room, aperture, floor, or ceiling in these proofs.
const ROOMS = [
  ['barracks', 10, 26, 360, 370, 12], ['refuge', 10, 22, 376, 384, 12.5],
  // Owner approved divider A (2026-10-15): its 0.6m comes from the ante,
  // preserving the complete 12x14m cell and its south inside face at z396.
  ['antechamber', 10, 22, 386, 395.4, 12], ['cell', 10, 22, 396, 410, 12],
  ['radio', 42, 54, 390, 410, 12], ['reserve', 24, 40, 434, 448, 12],
] as const;
// Owner-approved total: the original mission POW plus five captured soldiers.
const HOLDING = [['mission-pow', 16, 402], ['carry-1', 12, 400], ['carry-2', 20, 400],
  ['carry-3', 12, 404], ['carry-4', 20, 404], ['carry-5', 12, 408]] as const;
const shell = buildOutpostShell().map((b) => boxFrom(b, 'cover'));
const world = buildOutpostWorld();
type Point = { x: number; y: number; z: number };
const hit = (from: Point, to: Point, boxes: readonly WorldBox[] = shell) => {
  const x = to.x - from.x, y = to.y - from.y, z = to.z - from.z, length = Math.hypot(x, y, z);
  return rayWorld({ origin: from, direction: { x: x / length, y: y / length, z: z / length }, maxDistance: length }, boxes);
};
const solid = (x: number, z: number, y = 8.5) => blockedAt(x, z, .001, y, 0, .001, shell);
const ceiling = (x: number, z: number) => hit({ x, y: 9.6, z }, { x, y: 28, z })?.point.y;
type Solid = Pick<WorldBox, 'minX' | 'maxX' | 'minY' | 'maxY' | 'minZ' | 'maxZ'>;
const volume = (minX: number, maxX: number, minZ: number, maxZ: number, minY: number, maxY: number): Solid =>
  ({ minX, maxX, minZ, maxZ, minY, maxY });
const overlaps = (a: Solid, b: Solid) => a.maxX > b.minX + 1e-9 && a.minX < b.maxX - 1e-9
  && a.maxY > b.minY + 1e-9 && a.minY < b.maxY - 1e-9 && a.maxZ > b.minZ + 1e-9 && a.minZ < b.maxZ - 1e-9;
function difference(a: Solid, cut: Solid): Solid[] {
  if (!overlaps(a, cut)) return [a];
  const x0 = Math.max(a.minX, cut.minX), x1 = Math.min(a.maxX, cut.maxX);
  const y0 = Math.max(a.minY, cut.minY), y1 = Math.min(a.maxY, cut.maxY);
  const z0 = Math.max(a.minZ, cut.minZ), z1 = Math.min(a.maxZ, cut.maxZ);
  return [volume(a.minX, x0, a.minZ, a.maxZ, a.minY, a.maxY), volume(x1, a.maxX, a.minZ, a.maxZ, a.minY, a.maxY),
    volume(x0, x1, a.minZ, z0, a.minY, a.maxY), volume(x0, x1, z1, a.maxZ, a.minY, a.maxY),
    volume(x0, x1, z0, z1, a.minY, y0), volume(x0, x1, z0, z1, y1, a.maxY)]
    .filter((p) => p.maxX - p.minX > 1e-9 && p.maxY - p.minY > 1e-9 && p.maxZ - p.minZ > 1e-9);
}

describe('U-175 independent outpost shell and opaque reserve annex', () => {
  it('preserves the complete inside room dimensions, y8 floors, and solid ceilings', () => {
    let samples = 0;
    for (const [id, x0, x1, z0, z1, top] of ROOMS) {
      const structure = world.boxes.filter((b) => b.id !== 'outpost-furniture-radio-table');
      const intrusions = structure.filter((b) => b.maxY > 8.000001 && b.minY < top - .000001
        && b.maxX > x0 + .000001 && b.minX < x1 - .000001 && b.maxZ > z0 + .000001 && b.minZ < z1 - .000001);
      expect(intrusions.map((b) => b.id), `${id} exact full interior`).toEqual([]);
      for (let x = x0 + .1; x < x1; x += .8) for (let z = z0 + .1; z < z1; z += .8) {
        const local = shell.filter((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ);
        const actual = structure.filter((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ);
        expect(supportUnder(x, z, .001, 8.01, local, 0), `${id} floor ${x}/${z}`).toBeCloseTo(8, 8);
        expect(blockedAt(x, z, .001, 8, 0, top - 8 - .001, local), `${id} inside ${x}/${z}`).toBe(false);
        expect(blockedAt(x, z, .001, 8, 0, top - 8 - .001, actual), `${id} actual interior ${x}/${z}`).toBe(false);
        expect(ceiling(x, z), `${id} ceiling ${x}/${z}`).toBeCloseTo(top, 6);
        expect(local.some((b) => b.minY === top && b.maxY > top), `${id} solid roof`).toBe(true);
        samples++;
      }
    }
    expect(samples).toBeGreaterThan(1_000);
  }, 120_000);

  it('holds six separate standing prisoner bodies while retaining the complete four-by-four cell entry landing', () => {
    const radius = DEFAULT_MOVE_CONFIG.radius;
    expect(OUTPOST.holding.capacity).toBe(6); expect(OUTPOST.holding.constructionOnly).toBe(true);
    expect(OUTPOST.holding.positions.map(({ id, x, y, z }) => [id, x, y, z])).toEqual(HOLDING.map(([id, x, z]) => [id, x, 8, z]));
    for (const [i, [id, x, z]] of HOLDING.entries()) {
      expect(blockedAt(x, z, radius, 8, .05, DEFAULT_MOVE_CONFIG.height, world.boxes), `${id} standing capsule`).toBe(false);
      expect(supportUnder(x, z, radius, 8.01, world.boxes, 0), `${id} full footprint floor`).toBeCloseTo(8, 6);
      expect(x + radius <= 14 || x - radius >= 18 || z + radius <= 396 || z - radius >= 400, `${id} occupies entry landing`).toBe(true);
      for (const [, otherX, otherZ] of HOLDING.slice(i + 1))
        expect(Math.hypot(x - otherX, z - otherZ), `${id} overlaps another captive`).toBeGreaterThanOrEqual(radius * 2);
    }
    expect(world.boxes.filter((b) => b.maxY > 8.000001 && b.minY < 8 + DEFAULT_MOVE_CONFIG.height
      && b.maxX > 14.000001 && b.minX < 17.999999 && b.maxZ > 396.000001 && b.minZ < 399.999999).map((b) => b.id),
    'cell entry landing narrowed by construction').toEqual([]);
  });

  it('keeps the y14 perimeter outside x8..56/z356..412 and opens only its prescribed gates', () => {
    for (const z of [356, 412]) for (let x = 8.25; x < 56; x += .5) {
      const atZ = z === 356 ? 355.5 : 412.5;
      expect(solid(x, atZ), `south/north wall ${x}/${z}`).toBe(Math.abs(x - 32) > 4);
      expect(solid(x, atZ, 13.999)).toBe(true);
      expect(solid(x, atZ, 14.001)).toBe(false);
    }
    // U-180's west reveal leaves only the outer 0.2 m jamb at z371.4..372.
    for (const x of [7.1, 7.5, 56.5]) for (let z = 356.25; z < 412; z += .5) {
      if (x === 7.5 && z > 371.4 && z < 372) continue;
      expect(solid(x, z), `side wall ${x}/${z}`).toBe(Math.abs(z - 374) > 2);
      expect(solid(x, z, 13.999)).toBe(true);
      expect(solid(x, z, 14.001)).toBe(false);
    }
    for (const [x, z, axis, width, top] of [
      [32, 355.5, 'x', 8, 12], [32, 412.5, 'x', 8, 12],
      [7.5, 374, 'z', 4, 11], [56.5, 374, 'z', 4, 11],
    ] as const) for (const offset of [-width / 2 + .01, 0, width / 2 - .01]) {
      const px = x + (axis === 'x' ? offset : 0), pz = z + (axis === 'z' ? offset : 0);
      expect(blockedAt(px, pz, .001, 8, 0, top - 8 - .001, shell), `gate ${px}/${pz}`).toBe(false);
      expect(solid(px, pz, top + .001), `gate lintel ${px}/${pz}`).toBe(true);
    }
    for (const x of [7.1, 56.5]) for (const z of [370.01, 371.99, 376.01, 377.99])
      expect(solid(x, z), `side arch infill ${x}/${z}`).toBe(true);
    for (const z of [370.01, 371.39, 376.01, 377.99]) expect(solid(7.5, z), `west infill behind reveal ${z}`).toBe(true);
    // Exact U-180 reveal: open x7.2..8, z371.4..372 to the door head; lintel above.
    for (const x of [7.21, 7.6, 7.99]) for (const z of [371.41, 371.7, 371.99]) {
      expect(blockedAt(x, z, .001, 8, 0, 2.999, shell), `west reveal ${x}/${z}`).toBe(false);
      expect(solid(x, z, 11.001), `west reveal lintel ${x}/${z}`).toBe(true);
    }
    for (const z of [371.41, 371.99]) expect(solid(7.19, z), 'outer west jamb').toBe(true);
    for (const x of [28.01, 30, 32, 34, 35.99]) for (const z of [411.5, 411.99, 412.5, 413])
      expect(blockedAt(x, z, .001, 8, 0, 3.999, shell), `complete north arch throat ${x}/${z}`).toBe(false);
    for (let x = 8.1; x < 56; x += 1.3) for (let z = 356.1; z < 412; z += 1.3)
      expect(supportUnder(x, z, .001, 8.01, shell, 0), `courtyard floor ${x}/${z}`).toBeCloseTo(8, 6);
  });

  it('keeps all six four-metre room doors open with real three-metre clear lintels', () => {
    const doors = [
      [20, 370.3, 'x'], [22.3, 380, 'z'], [22.3, 392, 'z'],
      [16, 395.7, 'x'], [41.7, 396, 'z'], [32, 433.7, 'x'],
    ] as const;
    for (const [x, z, axis] of doors) for (const offset of [-1.99, 0, 1.99]) {
      const px = x + (axis === 'x' ? offset : 0), pz = z + (axis === 'z' ? offset : 0);
      expect(blockedAt(px, pz, .001, 8, 0, 2.999, shell), `room door ${px}/${pz}`).toBe(false);
      expect(solid(px, pz, 11.001), `room lintel ${px}/${pz}`).toBe(true);
    }
    for (const [x, z, axis] of doors) for (const offset of [-2.01, 2.01])
      expect(solid(x + (axis === 'x' ? offset : 0), z + (axis === 'z' ? offset : 0)), 'room door jamb').toBe(true);
    // No accidental second porch or cell exit. Window sills remain solid to
    // a standing body; the fixed-open shared door is the cell's sole exit.
    for (const [x, z] of [[9.7, 380], [16, 375.7], [16, 384.3], [9.7, 402], [22.3, 402], [16, 410.3]])
      expect(solid(x!, z!)).toBe(true);
  });

  it('cuts only the prescribed radio and barred cell window apertures', () => {
    // Count open structural rays across each window. Narrow bars may block
    // some rays, but cannot substitute for the specified four-metre opening.
    for (const [axis, fixed, lo, hi, sill, top] of [
      ['x', 410.3, 14, 18, 10.4, 11], ['z', 41.7, 402, 406, 9.1, 9.8],
    ] as const) {
      let open = 0;
      for (let along = lo + .025; along < hi; along += .05) {
        const x = axis === 'x' ? along : fixed, z = axis === 'z' ? along : fixed;
        expect(solid(x, z, sill - .001), 'window sill').toBe(true);
        expect(solid(x, z, top + .001), 'window head').toBe(true);
        if (!solid(x, z, (sill + top) / 2)) open++;
      }
      expect(open, `${axis} window filled instead of opened`).toBeGreaterThan(55);
      for (const along of [lo - .01, hi + .01])
        expect(solid(axis === 'x' ? along : fixed, axis === 'z' ? along : fixed, (sill + top) / 2), 'window jamb').toBe(true);
    }
  });

  it('provides the entire independent four-metre service spine with opaque walls and y12 roof', () => {
    const spine = [[32, 434], [32, 426], [20, 426], [20, 418], [32, 418], [32, 412]];
    for (let i = 1; i < spine.length; i++) {
      const [ax, az] = spine[i - 1]!, [bx, bz] = spine[i]!;
      const length = Math.hypot(bx! - ax!, bz! - az!), dx = (bx! - ax!) / length, dz = (bz! - az!) / length;
      for (let d = .1; d < length; d += .4) for (const side of [-1.99, 0, 1.99]) {
        const x = ax! + dx * d - dz * side, z = az! + dz * d + dx * side;
        const top = z > 433.4 ? 11 : 12; // Independently prescribed 3m reserve-room doorway.
        expect(blockedAt(x, z, .001, 8, 0, top - 8 - .001, shell), `service passage ${x}/${z}`).toBe(false);
        expect(blockedAt(x, z, .001, 8, 0, top - 8 - .001, world.boxes), `actual service passage ${x}/${z}`).toBe(false);
        expect(supportUnder(x, z, .001, 8.01, shell, 0)).toBeCloseTo(8, 6);
        expect(ceiling(x, z), `service ceiling ${x}/${z}`).toBeCloseTo(top, 6);
      }
    }
    for (const [x, z] of [[29.7, 430], [34.3, 430], [26, 423.7], [26, 428.3], [17.7, 422], [22.3, 422], [26, 415.7], [26, 420.3]])
      for (const y of [8.01, 9.6, 11.99]) expect(solid(x!, z!, y), `opaque annex ${x}/${z}/${y}`).toBe(true);
  });

  it('blocks all six prisoner body/camera rays from external gate, ridge, tank and basement probes with the actual shell', () => {
    const sources = [
      ...[28.2, 32, 35.8].map((x) => [x, 8, 356]),
      [8, 8, 374], [56, 8, 374], [32, 8, 412],
      [58, 20, 128], [88, 30, 210], [66, 26, 286],
      [96, 8, 444], [114, 8, 432], [112, 8, 386], [104, 8, 350], [84, 8, 338], [54, 8, 334], [16, 8, 332],
      [-8, 0, 370], [30, 0, 270], [-14, 0, 346],
    ];
    for (const [x, floor, z] of sources) for (const eye of [1.6, 2.2]) for (const body of [.15, .8, 1.6, 1.75])
      for (const [id, prisonerX, prisonerZ] of HOLDING) {
        const from = { x: x!, y: floor! + eye, z: z! }, to = { x: prisonerX, y: 8 + body, z: prisonerZ };
        expect(hit(from, to), `${id} shell leaks ${JSON.stringify(from)}`).not.toBeNull();
        expect(hit(from, to, world.boxes), 'complete construction leaks').not.toBeNull();
      }
    expect(hit({ x: 16, y: 14, z: 402 }, { x: 16, y: 9.6, z: 402 })?.point.y).toBeGreaterThanOrEqual(12);
    expect(hit({ x: 16, y: 9.6, z: 398 }, { x: 16, y: 9.6, z: 402 })).toBeNull();
  });

  it('screens every staged reserve body from independent courtyard, north gate and ridge camera probes', () => {
    const observers: Point[] = [];
    for (let x = 8.5; x < 56; x += 3) for (let z = 356.5; z < 412; z += 3)
      for (const y of [9.6, 10.2]) observers.push({ x, y, z });
    for (const [x, floor, z] of [[32, 8, 412], [58, 20, 128], [88, 30, 210], [66, 26, 286]])
      for (const eye of [1.6, 2.2]) observers.push({ x: x!, y: floor! + eye, z: z! });
    for (const from of observers) for (const [x, z] of [[28, 440], [32, 440], [36, 440], [32, 444]])
      for (const height of [.2, 1, 1.75])
        expect(hit(from, { x: x!, y: 8 + height, z: z! }), `reserve visible from ${JSON.stringify(from)}`).not.toBeNull();
    expect(hit({ x: 32, y: 9.6, z: 435 }, { x: 32, y: 9.6, z: 440 })).toBeNull();
  });

  it('preserves every inherited solid outside independently bounded three-dimensional courtyard/gate cuts', () => {
    const cuts = [volume(46, 52, 412, 420, 8, Infinity), volume(8, 56, 356, 412, 8, Infinity), volume(28, 36, 355, 356, 8, 12),
      volume(4, 8, 372, 376, 8, 12), volume(56, 61, 370, 376, 8, 12),
      // §9.3 exact rectangular union, including its 4x4 inside corner rests.
      volume(24, 40, 434, 448, 8, 12), volume(28, 36, 412, 414, 8, 12),
      volume(30, 34, 426, 434, 8, 12), volume(20, 32, 424, 428, 8, 12),
      volume(18, 22, 418, 426, 8, 12), volume(20, 32, 416, 420, 8, 12),
      volume(30, 34, 412, 418, 8, 12), volume(30, 34, 424, 428, 8, 12),
      volume(18, 22, 424, 428, 8, 12), volume(18, 22, 416, 420, 8, 12), volume(30, 34, 416, 420, 8, 12)];
    const original = buildDepotWorld(), byId = new Map(world.boxes.map((b) => [b.id, b]));
    const descendants = new Map<string, WorldBox[]>();
    for (const b of world.boxes) {
      const source = b.id.split('-outpost-cut-')[0]!, group = descendants.get(source) ?? [];
      group.push(b); descendants.set(source, group);
    }
    const violations: { id: string; loss: Solid[] }[] = [], untouched: WorldBox[] = [];
    let unchanged = 0, changed = 0;
    for (const old of original.boxes) {
      if (!cuts.some((c) => overlaps(old, c))) {
        untouched.push(old);
        unchanged++; continue;
      }
      let loss: Solid[] = [old];
      for (const retained of descendants.get(old.id) ?? []) loss = loss.flatMap((p) => difference(p, retained));
      for (const cut of cuts) loss = loss.flatMap((p) => difference(p, cut));
      if (loss.length) violations.push({ id: old.id, loss });
      changed++;
    }
    expect(unchanged).toBeGreaterThan(10_000);
    expect(untouched.map((b) => byId.get(b.id)), 'changed inherited exterior').toEqual(untouched);
    expect(changed).toBeGreaterThan(0);
    expect(violations.slice(0, 5), 'deleted inherited solid outside authorized 3D cut').toEqual([]);
    console.log('U-175 exact inherited preservation', JSON.stringify({ unchanged, changed, illegalLosses: violations.length }));
  }, 120_000);

  it('keeps generated construction evidence fresh and construction isolated from campaign activation', async () => {
    const output = new URL('../../../../artifacts/qalat-outpost/', import.meta.url), manifest = outpostManifest();
    expect(JSON.parse(await readFile(new URL('construction.json', output), 'utf8'))).toEqual(manifest);
    const captures = JSON.parse(await readFile(new URL('captures.json', output), 'utf8')) as {
      levelHash: string; renderHash: string; views: { name: string; calls: number; floorY: number; renderedCeilingY: number | null }[];
    };
    expect(captures.levelHash).toBe(manifest.levelHash); expect(captures.renderHash).toBe(manifest.renderHash);
    expect(captures.views.map((v) => v.name)).toEqual(['v3-gun', 'west-turn', 'south-gate-court', 'west-gate', 'east-gate', 'barracks',
      'refuge', 'antechamber', 'cell', 'radio', 'court-cover', 'water-tower', 'radio-equipment', 'cell-trim', 'reserve-bend', 'reserve-room']);
    expect(captures.views.every((v) => v.calls < 300 && v.floorY === (v.name === 'v3-gun' ? 26 : 8))).toBe(true);
    for (const view of captures.views.filter((v) => !['v3-gun', 'west-turn', 'south-gate-court', 'west-gate', 'east-gate', 'court-cover', 'water-tower'].includes(v.name))) expect(view.renderedCeilingY, view.name).toBeCloseTo(view.name === 'refuge' ? 12.5 : 12, 6);
    expect(world.id).toBe('qalat-outpost-construction');
    expect(manifest.activeCampaign).toBe('unchanged; activation U-117');
    expect(manifest.humanVerdict).toBe('whole-mission acceptance U-119');
  }, 120_000);
});
