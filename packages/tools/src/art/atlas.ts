/**
 * A family atlas (T-4.04, ADR-018): one texture shared by every piece of a
 * family, so a building made of twenty pieces is one material and, once
 * instanced (T-4.07), a handful of draw calls (ADR-013).
 *
 * The atlas is a grid of square cells. Each cell holds one surface, painted
 * from arithmetic and seeded noise so that it TILES: a wall is not one
 * stretched cell but its faces cut into tiles that each map the whole cell
 * (`mesh.ts`). Each cell also has a gutter, a border that continues the
 * pattern, so mipmapping and filtering at a cell's edge sample more of the
 * same surface and never the neighbouring cell.
 */
import { PNG } from 'pngjs';
import { rng, tiledFbm, tiledNoise } from './noise.ts';

export type Rgb = [number, number, number];
/** Paints one texel of a surface; (u, v) in [0, 1) across the tiling period. Returns linear 0–255 sRGB-encoded bytes. */
export type Painter = (u: number, v: number, seed: number) => Rgb;

export interface AtlasFamily {
  id: string;
  /** Texels a side. A power of two (T-4.03). */
  size: number;
  /** Texels a side of each cell, gutter included. */
  cell: number;
  /** Texels of gutter on each side of a cell. */
  gutter: number;
  seed: number;
  /** Surfaces in cell order, left to right then top to bottom. */
  surfaces: Record<string, Painter>;
}

/** Where a surface's tileable interior sits in the atlas, in UV (0..1, v down as in glTF). */
export interface CellRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export function cellRect(family: AtlasFamily, surface: string): CellRect {
  const names = Object.keys(family.surfaces);
  const i = names.indexOf(surface);
  if (i < 0) throw new Error(`atlas '${family.id}' has no surface '${surface}' (has ${names.join(', ')})`);
  const perRow = family.size / family.cell;
  if (i >= perRow * perRow) throw new Error(`atlas '${family.id}' is full at ${perRow * perRow} surfaces`);
  const x = (i % perRow) * family.cell + family.gutter;
  const y = Math.floor(i / perRow) * family.cell + family.gutter;
  const inner = family.cell - 2 * family.gutter;
  return { u0: x / family.size, v0: y / family.size, u1: (x + inner) / family.size, v1: (y + inner) / family.size };
}

/** The atlas as RGBA bytes, rows top to bottom. Unused cells are mid grey. */
export function paintAtlas(family: AtlasFamily): Uint8Array {
  const { size, cell, gutter } = family;
  if ((size & (size - 1)) !== 0 || size % cell !== 0) throw new Error(`atlas '${family.id}': size must be a power of two and a multiple of the cell`);
  const out = new Uint8Array(size * size * 4).fill(128);
  const inner = cell - 2 * gutter;
  const perRow = size / cell;
  Object.entries(family.surfaces).forEach(([name, paint], i) => {
    const seed = (family.seed * 31 + i * 7919 + name.length) >>> 0;
    const cx = (i % perRow) * cell;
    const cy = Math.floor(i / perRow) * cell;
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        // The gutter wraps: texel (x, y) of the cell shows interior texel
        // ((x − gutter) mod inner), so the border continues the tile.
        const ix = (((x - gutter) % inner) + inner) % inner;
        const iy = (((y - gutter) % inner) + inner) % inner;
        const [r, g, b] = paint((ix + 0.5) / inner, (iy + 0.5) / inner, seed);
        const o = ((cy + y) * size + cx + x) * 4;
        out[o] = clamp(r);
        out[o + 1] = clamp(g);
        out[o + 2] = clamp(b);
        out[o + 3] = 255;
      }
    }
  });
  return out;
}

export function atlasPng(family: AtlasFamily): Uint8Array {
  const png = new PNG({ width: family.size, height: family.size });
  png.data = Buffer.from(paintAtlas(family));
  return new Uint8Array(PNG.sync.write(png));
}

const clamp = (n: number): number => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));

/* -- Painters --------------------------------------------------------------- */

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

/**
 * Lime plaster over mud brick: a warm off-white, mottled at two scales, with
 * fine grain and small, ragged patches of newer plaster. The patches are
 * thresholded noise at a high frequency, warped by a second noise, so they
 * read as repairs and not as a repeating panel across a 2 m tile.
 */
export function plaster(base: Rgb, patch: Rgb): Painter {
  return (u, v, seed) => {
    const broad = tiledFbm(seed, u * 2, v * 2, 2, 2);
    const mottle = tiledFbm(seed + 3, u * 8, v * 8, 8, 3);
    const warp = tiledNoise(seed + 29, u * 6, v * 6, 6) * 1.5;
    const repair = tiledFbm(seed + 17, u * 6 + warp, v * 6 + warp, 6, 2);
    const grain = rng((Math.floor(u * 4096) * 73856093) ^ (Math.floor(v * 4096) * 19349663) ^ seed)();
    let c = mix(base, patch, repair > 0.66 ? 0.35 : 0);
    c = shade(c, 0.9 + broad * 0.1 + mottle * 0.12 + (grain - 0.5) * 0.07);
    return c;
  };
}

/** Cast concrete: grey, speckled with aggregate, with the odd dark pit. */
export function concrete(base: Rgb): Painter {
  return (u, v, seed) => {
    const cloud = tiledFbm(seed, u * 4, v * 4, 4, 3);
    const speck = rng((Math.floor(u * 4096) * 83492791) ^ (Math.floor(v * 4096) * 2971215073) ^ seed)();
    const k = 0.84 + cloud * 0.2 + (speck > 0.93 ? -0.16 : speck < 0.05 ? 0.08 : 0);
    return shade(base, k);
  };
}

/** A texel's own grain: a per-texel random in [0, 1) that tiles because it is keyed on the texel. */
const grainAt = (u: number, v: number, seed: number): number =>
  rng((Math.floor(u * 4096) * 73856093) ^ (Math.floor(v * 4096) * 19349663) ^ seed)();

/** Distance in [0, 0.5] from `t` to the nearest whole number: 0 on a joint. */
const toJoint = (t: number): number => Math.abs(t - Math.round(t));

/**
 * Coursed mud brick, the wall under the plaster where it has broken away:
 * `rows` courses a tile, each staggered half a brick, with sunken mortar.
 */
export function brick(face: Rgb, mortar: Rgb, rows = 8, perRow = 4): Painter {
  return (u, v, seed) => {
    const row = Math.floor(v * rows);
    const along = u * perRow + (row % 2) * 0.5;
    // 0 on a joint, 1 in a brick's middle, across and along alike.
    const joint = Math.min(toJoint(v * rows), toJoint(along)) * 2;
    const brickId = Math.floor(along) % perRow + row * perRow;
    const tint = tiledNoise(seed + brickId, u * 2, v * 2, 2) * 0.12 + rng(seed ^ (brickId * 2654435761))() * 0.12;
    const g = grainAt(u, v, seed);
    if (joint < 0.08) return shade(mortar, 0.9 + g * 0.1);
    return shade(face, 0.84 + tint + (g - 0.5) * 0.08);
  };
}

/** Flat roofing: tarred screed, dark, with pale dust gathered in low patches. */
export function roofing(base: Rgb, dust: Rgb): Painter {
  return (u, v, seed) => {
    const d = tiledFbm(seed, u * 4, v * 4, 4, 3);
    const g = grainAt(u, v, seed);
    return shade(mix(base, dust, d > 0.58 ? (d - 0.58) * 1.6 : 0), 0.9 + (g - 0.5) * 0.1);
  };
}

/** Packed earth: sand-brown, mottled at two scales, pebble-flecked. */
export function dirt(base: Rgb, dark: Rgb): Painter {
  return (u, v, seed) => {
    const m = tiledFbm(seed, u * 4, v * 4, 4, 4);
    const g = grainAt(u, v, seed);
    const c = mix(base, dark, m * 0.7);
    return g > 0.97 ? shade(c, 1.18) : g < 0.03 ? shade(c, 0.75) : shade(c, 0.94 + (g - 0.5) * 0.08);
  };
}

/** A worn gravel road: grey aggregate over brown, with two darker ruts along v. */
export function road(base: Rgb, rut: Rgb): Painter {
  return (u, v, seed) => {
    const m = tiledFbm(seed, u * 4, v * 4, 4, 3);
    const g = grainAt(u, v, seed);
    const ruts = Math.max(0, 1 - Math.abs(toJoint(u * 2 - 0.5) - 0.25) / 0.08);
    const c = mix(base, rut, Math.min(1, ruts * 0.6 + m * 0.3));
    return shade(c, 0.9 + (g - 0.5) * 0.16);
  };
}

/** Square stone flags, `n` a side a tile, each its own shade, in sandy joints. */
export function paving(stone: Rgb, joint: Rgb, n = 2): Painter {
  return (u, v, seed) => {
    const j = Math.min(toJoint(u * n), toJoint(v * n));
    const flag = Math.floor(u * n) + Math.floor(v * n) * n;
    const g = grainAt(u, v, seed);
    if (j < 0.03) return shade(joint, 0.92 + g * 0.1);
    const tint = rng(seed ^ (flag * 2246822519))() * 0.14 + tiledNoise(seed + 5, u * 4, v * 4, 4) * 0.1;
    return shade(stone, 0.84 + tint + (g - 0.5) * 0.06);
  };
}

/** Broken masonry: chunks of plaster, brick and concrete in dust. */
export function rubble(a: Rgb, b: Rgb, c: Rgb): Painter {
  return (u, v, seed) => {
    const cell = tiledNoise(seed, u * 8, v * 8, 8);
    const g = grainAt(u, v, seed);
    const pick = cell < 0.4 ? a : cell < 0.65 ? b : c;
    const edge = Math.abs(cell - 0.4) < 0.02 || Math.abs(cell - 0.65) < 0.02 ? 0.7 : 1;
    return shade(pick, (0.85 + (g - 0.5) * 0.14) * edge);
  };
}

/** Sandbags: `rows` courses of stuffed burlap a tile, staggered, darker where the bags meet. */
export function sandbag(cloth: Rgb, rows = 4, perRow = 2): Painter {
  return (u, v, seed) => {
    const row = Math.floor(v * rows);
    const along = u * perRow + (row % 2) * 0.5;
    const du = toJoint(along) * 2;
    const dv = toJoint(v * rows) * 2;
    // A bag is pillowed: lit in the middle, falling off to its seams.
    const pillow = Math.min(1, Math.sqrt(du * dv) * 1.8);
    const weave = ((Math.floor(u * 512) + Math.floor(v * 512)) % 2) * 0.04;
    const g = grainAt(u, v, seed);
    return shade(cloth, 0.55 + pillow * 0.45 + weave + (g - 0.5) * 0.06);
  };
}

/** Crate side: `boards` horizontal boards in a frame of battens, olive-painted pine gone chalky. */
export function crate(paint: Rgb, boards = 4): Painter {
  return (u, v, seed) => {
    const g = grainAt(u, v, seed);
    const frame = u < 0.08 || u > 0.92 || v < 0.08 || v > 0.92;
    const gap = !frame && toJoint(v * boards) < 0.02;
    const streak = tiledNoise(seed, u * 16, v * boards, 16) * 0.12;
    if (gap) return shade(paint, 0.35);
    return shade(paint, (frame ? 0.8 : 0.92) + streak + (g - 0.5) * 0.08);
  };
}

/** Weathered grey planks running along v, `boards` a tile. */
export function planks(wood: Rgb, boards = 6): Painter {
  return (u, v, seed) => {
    const g = grainAt(u, v, seed);
    const board = Math.floor(u * boards);
    const gap = toJoint(u * boards) < 0.03;
    const grainLines = tiledNoise(seed + board, u * 64, v * 4, 64) * 0.18;
    if (gap) return shade(wood, 0.4);
    return shade(wood, 0.78 + grainLines + rng(seed ^ (board * 40503))() * 0.12 + (g - 0.5) * 0.06);
  };
}

/** A painted steel drum, rusting: two ribs round it and rust bleeding at the rims. */
export function drum(paint: Rgb, rustC: Rgb): Painter {
  return (u, v, seed) => {
    const g = grainAt(u, v, seed);
    const rib = Math.abs(v - 1 / 3) < 0.02 || Math.abs(v - 2 / 3) < 0.02;
    const rim = Math.min(v, 1 - v);
    const r = tiledFbm(seed, u * 8, v * 8, 8, 3);
    const rusty = r > 0.62 || (rim < 0.12 && r > 0.45);
    const c = rusty ? rustC : paint;
    return shade(c, (rib ? 1.15 : 0.92) + (g - 0.5) * 0.08);
  };
}
