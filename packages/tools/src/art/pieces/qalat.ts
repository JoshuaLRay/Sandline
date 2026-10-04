/** U-096: a map-specific skin over U-097's collision, and sparse winter dressing.
 * All large surfaces follow the level's exact planes. Small cosmetic fragments
 * stay ankle-high; the separate bank rocks carry their own matching collision.
 */
import level from '../../../../shared/src/data/levels/qalat-road.json' with { type: 'json' };
import { dirt, paving, type AtlasFamily, type Rgb } from '../atlas.ts';
import { rng, tiledFbm, tiledNoise } from '../noise.ts';
import type { Piece } from '../piece.ts';
import type { MeshBuilder, Vec3 } from '../mesh.ts';

const FAMILY: AtlasFamily = {
  id: 'qalat-earth', size: 1024, cell: 256, gutter: 8, seed: 96,
  surfaces: {
    earth: dirt([185, 174, 151], [144, 129, 102]),
    gravel: (u, v, seed) => {
      const n = tiledFbm(seed, u * 12, v * 12, 12, 3);
      const grain = tiledNoise(seed + 3, u * 96, v * 96, 96);
      const stone = grain > .62 ? 16 : grain < .31 ? -12 : 0;
      return [147 + n * 30 + stone, 151 + n * 29 + stone, 143 + n * 25 + stone];
    },
    field: (u, v, seed) => {
      const n = tiledFbm(seed, u * 8, v * 8, 8, 4);
      const straw = tiledFbm(seed + 5, u * 64, v * 16, 16, 2) > .65 ? 21 : 0;
      return [145 + n * 36 + straw, 139 + n * 32 + straw, 103 + n * 25] as Rgb;
    },
    road: (u, v, seed) => {
      const n = tiledFbm(seed, u * 8, v * 8, 8, 4);
      const rut = Math.max(0, 1 - Math.abs(u - .26) * 16) + Math.max(0, 1 - Math.abs(u - .74) * 16);
      return [168 + n * 28 - rut * 17, 148 + n * 24 - rut * 14, 115 + n * 22 - rut * 10];
    },
    paving: paving([183, 171, 143], [143, 126, 93]),
    rock: dirt([172, 170, 149], [135, 131, 111]),
    straw: dirt([138, 130, 79], [99, 93, 53]),
  },
};
const TILES = Object.fromEntries(Object.keys(FAMILY.surfaces).map((s) => [s, 8]));
const skin = .012;
export const QALAT_TERRAIN_IDS = level.boxes.map((box) => box.id);

/** Broad, wandering dry channels and patches; no coordinate-aligned colour grid. */
export function qalatTint(x: number, y: number, z: number): [number, number, number] {
  const noise = tiledFbm(96, (x + 64) / 12, (z + 202) / 12, 64, 3);
  const channel = -41 + Math.sin(z * .041) * 4;
  const bed = Math.max(0, Math.min(1, (17 - Math.abs(x - channel)) / 5));
  const road = Math.max(0, Math.min(1, (8 + Math.sin(z * .057) - Math.abs(x)) / 3));
  const field = Math.max(0, Math.min(1, (x - 23 + Math.sin(z * .08) * 2) / 8));
  const compound = z > 168 && Math.abs(x) < 21;
  const c = compound ? [.85, .78, .64] : [.8, .67, .47];
  for (let i = 0; i < 3; i++) {
    if (!compound) {
      c[i] = c[i]! * (1 - bed) + [.7, .74, .72][i]! * bed;
      c[i] = c[i]! * (1 - road) + [.88, .75, .54][i]! * road;
      c[i] = c[i]! * (1 - field) + [.64, .64, .42][i]! * field;
    }
    c[i] = c[i]! * (.78 + noise * .32);
  }
  // Earth retaining faces get baked darkening below their supporting top plane.
  const top = terrainHeight(x, z);
  const shade = y < top - .05 ? .72 : 1;
  return c.map((v) => v * shade) as [number, number, number];
}

export function terrainHeight(x: number, z: number): number {
  let y = 0;
  for (const box of level.boxes) {
    if (Math.abs(x - box.x) <= box.w / 2 && Math.abs(z - box.z) <= box.d / 2) y = Math.max(y, box.y + box.h);
  }
  return y;
}

function surface(x: number, z: number): string {
  if (z > 170 && z < 194 && Math.abs(x) < 20) return 'paving';
  if (x < -27 && z > 12 && z < 169) return 'gravel';
  if (x > 24 && z > 18 && z < 187) return 'field';
  if (Math.abs(x) < 7 && z > 8 && z < 169) return 'road';
  return 'earth';
}

/** One plane, tiled without raised seams; narrow road cells keep the lane legible. */
function plane(b: MeshBuilder, x0: number, x1: number, z0: number, z1: number, y: number, tile = 8): void {
  const xs = [x0];
  for (let x = Math.ceil(x0 / tile) * tile; x < x1; x += tile) if (x > x0) xs.push(x);
  for (const x of [-7, -3, 3, 7]) if (x > x0 && x < x1 && !xs.includes(x)) xs.push(x);
  xs.push(x1); xs.sort((a, c) => a - c);
  const zs = [z0];
  for (let z = Math.ceil(z0 / tile) * tile; z < z1; z += tile) if (z > z0) zs.push(z);
  zs.push(z1);
  for (let i = 1; i < xs.length; i++) for (let j = 1; j < zs.length; j++) {
    const xa = xs[i - 1]!, xb = xs[i]!, za = zs[j - 1]!, zb = zs[j]!;
    const s = surface((xa + xb) / 2, (za + zb) / 2);
    const a: Vec3 = [xa, y, za], c: Vec3 = [xb, y, zb];
    b.triangle([a, [xa, y, zb], c], s, [[0, 0], [0, 1], [1, 1]]);
    b.triangle([a, c, [xb, y, za]], s, [[0, 0], [1, 1], [1, 0]]);
  }
}

export const QALAT_GROUND: Piece = {
  id: 'qalat-ground', class: 'kit', family: FAMILY, tileM: TILES, decal: true, bakedAo: true, smooth: true, tint: qalatTint,
  build(b) {
    plane(b, -level.floor.halfWidth, level.floor.halfWidth, -level.floor.halfDepth, level.floor.halfDepth, skin, 16);
    for (const box of level.boxes) {
      const x0 = box.x - box.w / 2, x1 = box.x + box.w / 2, z0 = box.z - box.d / 2, z1 = box.z + box.d / 2;
      plane(b, x0, x1, z0, z1, box.y + box.h + skin, box.h >= 4 ? 16 : 8);
      b.box([x0, box.y, z0], [x1, box.y + box.h, z1], { all: 'earth' }, { omit: ['py', 'ny'] });
    }
  },
};

export interface Fragment { x: number; z: number; y: number; radius: number; height: number; grass: boolean }
/** Authored clusters, seeded offsets. Never put visual foliage in the road or a mission interaction area. */
export function qalatFragments(): Fragment[] {
  const random = rng(96);
  const clusters = [[-51, 48], [-30, 68], [-48, 96], [-32, 124], [-50, 145], [-25, 44], [22, 56], [49, 42], [29, 63], [51, 100], [30, 121], [51, 157], [29, 168], [-24, 164], [25, 190], [-15, 185], [16, 179]];
  const out: Fragment[] = [];
  for (const [cx, cz] of clusters) for (let n = 0; n < 28; n++) {
    const x = cx! + (random() - .5) * 9, z = cz! + (random() - .5) * 12;
    const y = terrainHeight(x, z);
    // Don't cross a stair/rim: every fragment sits on a single supporting plane.
    if ([[-.4, -.4], [.4, -.4], [-.4, .4], [.4, .4]].some(([dx, dz]) => terrainHeight(x + dx!, z + dz!) !== y)) continue;
    if (Math.abs(x) < 13 || level.pieces.some((p) => !p.piece.startsWith('ground-') && !p.piece.startsWith('qalat-') && Math.abs(p.x - x) < 2.5 && Math.abs(p.z - z) < 2.5)) continue;
    out.push({ x, z, y, radius: .06 + random() * .17, height: .05 + random() * .12, grass: x > 20 && random() > .35 });
  }
  return out;
}

function stone(b: MeshBuilder, x: number, y: number, z: number, r: number, h: number): void {
  const ring: Vec3[] = [[x - r, y, z], [x, y, z + r * .7], [x + r, y, z], [x, y, z - r * .7]];
  const peak: Vec3 = [x - r * .17, y + h, z + r * .11];
  for (let i = 0; i < 4; i++) b.triangle([ring[i]!, ring[(i + 1) % 4]!, peak], 'rock');
}

export const QALAT_DETAIL: Piece = {
  id: 'qalat-detail', class: 'kit', family: FAMILY, tileM: TILES, decal: true, bakedAo: true, smooth: true, tint: () => [1, 1, 1],
  build(b) {
    for (const p of qalatFragments()) {
      if (!p.grass) stone(b, p.x, p.y + skin, p.z, p.radius, p.height);
      else for (let i = 0; i < 3; i++) {
        const x = p.x + (i - 1) * .065, z = p.z + i * .04;
        const points: [Vec3, Vec3, Vec3] = [[x - .028, p.y + skin, z], [x + .028, p.y + skin, z], [x + .09, p.y + .22 + i * .035, z + .045]];
        b.triangle(points, 'straw'); b.triangle([points[2], points[1], points[0]], 'straw');
      }
    }
  },
};

/** Sub-step-height boulders on banks: the visible bounds match their collision. */
export const QALAT_BANK_ROCK: Piece = {
  id: 'qalat-bank-rock', class: 'kit', family: FAMILY, tileM: TILES, smooth: true,
  build(b) {
    stone(b, 0, 0, 0, 1, .4);
    b.collider([-1, 0, -.7], [1, .4, .7]);
  },
};
