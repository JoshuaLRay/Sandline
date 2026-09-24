/**
 * The detailed soldier's atlas (T-4.08, ADR-018, ADR-020): one 1024² diffuse
 * for a US soldier in Afghanistan, winter 2001–2002, painted from arithmetic
 * and seeded noise. The squad's markings are the second material's colour,
 * so this one texture is shared by every squad soldier.
 *
 * The era did its detail in the texture, and so does this:
 *   - three-colour desert camouflage (DCU): a tan field under large khaki and
 *     brown blotches, with weave, wrinkles and seams;
 *   - an Interceptor vest in desert tan, with rows of MOLLE webbing;
 *   - pouches with flaps and stitching;
 *   - rough-out tan boots on dark soles, tan gloves and tan webbing;
 *   - a face: stubble, brows, eyes, a nose and mouth in shadow, and the
 *     chinstrap line.
 *
 * Filtered smoothly (bilinear, mipmapped), as the PS2 did. The earlier
 * soldier's point sampling is part of why it read as Roblox.
 */
import { PNG } from 'pngjs';
import { rng, tiledFbm, tiledNoise } from '../noise.ts';
import type { Region } from './skin.ts';

export const SOLDIER_ATLAS_SIZE = 1024;

type Rgb = [number, number, number];

/** Regions in texels: x, y from the top left, width, height. */
const PX = {
  face: [0, 0, 256, 256],
  helmet: [256, 0, 256, 256],
  blouse: [512, 0, 256, 256],
  trousers: [768, 0, 256, 256],
  vest: [0, 256, 256, 256],
  pack: [512, 256, 256, 256],
  pouch: [256, 256, 128, 128],
  boot: [384, 256, 128, 128],
  glove: [256, 384, 128, 128],
  belt: [384, 384, 128, 128],
  skin: [768, 256, 128, 128],
  goggle: [896, 256, 128, 128],
  strap: [768, 384, 128, 128],
  cuff: [896, 384, 128, 128],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export type RegionName = keyof typeof PX;

/** A 2-texel inset keeps bilinear filtering inside its own region. */
const INSET = 2;

export function region(name: RegionName): Region {
  const [x, y, w, h] = PX[name];
  const s = SOLDIER_ATLAS_SIZE;
  return { u0: (x + INSET) / s, v0: (y + INSET) / s, u1: (x + w - INSET) / s, v1: (y + h - INSET) / s };
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];
const grain = (x: number, y: number, seed: number): number => rng((x * 73856093) ^ (y * 19349663) ^ seed)();

/* -- Materials ---------------------------------------------------------------- */

const DCU = { tan: [206, 186, 148] as Rgb, khaki: [165, 158, 118] as Rgb, brown: [124, 98, 70] as Rgb };
const NYLON: Rgb = [178, 156, 116];
const SKIN: Rgb = [196, 146, 112];

/**
 * Three-colour desert: large khaki blobs over the tan field, brown blotches
 * over both, their edges warped so they read as printed shapes, not noise.
 * `scale` is blotches per region width.
 */
function dcu(u: number, v: number, x: number, y: number, seed: number, scale: number): Rgb {
  const warp = tiledNoise(seed + 9, u * 3, v * 3, 3) * 0.8;
  const k = tiledFbm(seed, u * scale + warp, v * scale + warp, scale, 2);
  const b = tiledFbm(seed + 31, u * scale * 1.3 + warp, v * scale * 1.3, Math.round(scale * 1.3), 2);
  let c = DCU.tan;
  if (k > 0.56) c = DCU.khaki;
  if (b > 0.6) c = DCU.brown;
  // Weave, and creases running down the cloth.
  const weave = ((x + y) % 2) * 0.03;
  const crease = tiledNoise(seed + 77, u * 18, v * 3, 18);
  const g = grain(x, y, seed);
  return shade(c, 0.9 + weave + (crease - 0.5) * 0.12 + (g - 0.5) * 0.05);
}

/** A seam: a darker line with a pale stitch row beside it, `at` in [0, 1] across `t`. */
function seam(t: number, at: number, width: number): number {
  const d = Math.abs(t - at);
  return d < width ? 0.72 : d < width * 2 ? 1.06 : 1;
}

type Painter = (u: number, v: number, x: number, y: number) => Rgb;

const PAINT: Record<RegionName, Painter> = {
  face(u, v, x, y) {
    // u runs round the head, the face at u = 0.5; v by height from the head's top (y 1.85) down to the neck (1.53).
    const g = grain(x, y, 11);
    const du = u - 0.5;
    const adu = Math.abs(du);
    const hy = 1.85 - v * 0.32; // model height of this texel's ring
    // Weathered skin, warmer on the cheeks, cooler and darker toward the sides.
    let c = shade(SKIN, 0.9 + tiledNoise(3, u * 6, v * 6, 6) * 0.08 + (g - 0.5) * 0.05 - adu * 0.2);
    const soft = (d: number, r: number): number => Math.max(0, 1 - d / r) ** 2;
    // Warmth on the cheeks, in soft ovals.
    for (const side of [-1, 1]) c = mix(c, [206, 132, 104], 0.2 * soft(Math.sqrt(((du - side * 0.07) / 0.06) ** 2 + ((hy - 1.638) / 0.03) ** 2), 1));
    // Short dark hair at the back and sides above the ears; stubble on the jaw and lip.
    if (adu > 0.21 && hy > 1.64) c = mix(c, [62, 50, 40], 0.8 + g * 0.2);
    // Stubble thickens toward the jaw line and fades up the cheek.
    if (adu < 0.21) c = mix(c, [110, 88, 72], (0.22 + g * 0.16) * Math.min(1, Math.max(0, (1.625 - hy) / 0.03)) * Math.min(1, Math.max(0, (hy - 1.545) / 0.02)));
    // Ears in shadow, the inner ear darker.
    if (Math.abs(adu - 0.25) < 0.03 && hy > 1.63 && hy < 1.7) c = shade(c, Math.abs(adu - 0.25) < 0.012 ? 0.68 : 0.86);
    // The brow ridge's shadow falls softly over each eye.
    for (const side of [-1, 1]) {
      const ex = du - side * 0.048;
      const hyE = hy - 1.672;
      // Eye socket in shadow, a small narrowed eye, a dark iris, the lid line above.
      c = shade(c, 1 - 0.2 * soft(Math.sqrt((ex / 0.04) ** 2 + ((hyE - 0.003) / 0.02) ** 2), 1));
      if ((ex / 0.017) ** 2 + (hyE / 0.0045) ** 2 < 1) c = [196, 184, 166];
      if ((ex / 0.0065) ** 2 + (hyE / 0.0045) ** 2 < 1) c = [52, 40, 32];
      if (Math.abs(ex) < 0.019 && Math.abs(hyE - 0.005) < 0.0022) c = [78, 56, 44];
      if (Math.abs(ex) < 0.03 && Math.abs(hy - 1.69 + ex * ex * 5) < 0.0035) c = mix(c, [58, 44, 34], 0.85);
    }
    // The nose: lit ridge, shaded side and nostrils under it.
    if (adu < 0.022 && hy < 1.672 && hy > 1.635) c = shade(c, 1 + 0.06 * soft(adu, 0.01) - 0.12 * Math.max(0, du) / 0.022);
    if (Math.abs(adu - 0.012) < 0.006 && Math.abs(hy - 1.633) < 0.003) c = shade(c, 0.62);
    // The mouth: a thin dark line, the lower lip a touch redder.
    if (adu < 0.035 && Math.abs(hy - 1.605) < 0.0025) c = shade(c, 0.58);
    if (adu < 0.03 && hy < 1.602 && hy > 1.595) c = mix(c, [168, 100, 86], 0.3);
    // The chinstrap: a thin olive line down each cheek under the jaw.
    if (Math.abs(hy - 1.572 - (adu - 0.12) * 0.35) < 0.0028 && adu > 0.1 && adu < 0.26) c = [84, 78, 58];
    return c;
  },
  helmet(u, v, x, y) {
    // The PASGT cover: DCU, gathered at the rim by the band, a crease or two.
    let c = dcu(u, v, x, y, 21, 5);
    if (v > 0.9) c = shade(c, 0.8);
    c = shade(c, seam(u, 0.5, 0.004) * seam(u, 0, 0.004));
    return c;
  },
  blouse(u, v, x, y) {
    let c = dcu(u, v, x, y, 41, 4);
    c = shade(c, seam(u, 0.25, 0.004) * seam(u, 0.75, 0.004));
    return c;
  },
  trousers(u, v, x, y) {
    let c = dcu(u, v, x, y, 61, 4);
    // Side seams, and the knee darkened by wear.
    c = shade(c, seam(u, 0.25, 0.004) * seam(u, 0.75, 0.004));
    if (Math.abs(v - 0.55) < 0.06 && Math.abs(u - 0.5) < 0.18) c = shade(c, 0.9);
    return c;
  },
  vest(u, v, x, y) {
    // Interceptor outer tactical vest: tan nylon, MOLLE rows across the front and back, the side opening.
    const g = grain(x, y, 81);
    let c = shade(NYLON, 0.9 + tiledNoise(83, u * 8, v * 8, 8) * 0.12 + (g - 0.5) * 0.05);
    const row = (v * 9) % 1;
    const molle = v > 0.18 && v < 0.85 && row < 0.22 && Math.abs(Math.abs(u - 0.5) - 0.25) > 0.07;
    if (molle) c = shade(c, row < 0.04 || row > 0.18 ? 0.72 : 1.05);
    // The collar at the top and the hem.
    if (v < 0.08) c = shade(c, 0.85);
    if (v > 0.94) c = shade(c, 0.78);
    // The side closures, darker.
    if (Math.abs(Math.abs(u - 0.5) - 0.25) < 0.02) c = shade(c, 0.75);
    return c;
  },
  pack(u, v, x, y) {
    // A tan three-day pack: two compression straps down the back, a lid at the top.
    const g = grain(x, y, 91);
    let c = shade(mix(NYLON, DCU.khaki, 0.3), 0.9 + tiledNoise(93, u * 8, v * 8, 8) * 0.14 + (g - 0.5) * 0.05);
    for (const s of [0.4, 0.6]) if (Math.abs(u - s) < 0.02) c = shade(c, 0.78);
    if (v < 0.2) c = shade(c, 0.9);
    if (Math.abs(v - 0.2) < 0.008) c = shade(c, 0.65);
    return c;
  },
  pouch(u, v, x, y) {
    // A magazine pouch: the flap over the top third, its edge in shadow, a snap.
    const g = grain(x, y, 101);
    let c = shade(NYLON, 0.9 + (g - 0.5) * 0.08);
    if (v < 0.35) c = shade(c, 1.05);
    if (Math.abs(v - 0.35) < 0.02) c = shade(c, 0.6);
    c = shade(c, seam(v, 0.9, 0.01));
    if (Math.abs(u - 0.5) < 0.03 && Math.abs(v - 0.28) < 0.03) c = [60, 58, 50];
    return c;
  },
  boot(u, v, x, y) {
    // Rough-out tan leather over a dark rubber sole, laces up the front.
    const g = grain(x, y, 111);
    let c = shade([170, 138, 98], 0.86 + tiledNoise(113, u * 12, v * 12, 12) * 0.16 + (g - 0.5) * 0.08);
    if (v > 0.82) c = shade([56, 50, 44], 0.9 + g * 0.1);
    if (Math.abs(u - 0.5) < 0.05 && v < 0.6 && (v * 20) % 1 < 0.3) c = [110, 90, 64];
    return c;
  },
  glove(u, v, x, y) {
    const g = grain(x, y, 121);
    let c = shade([150, 120, 84], 0.88 + tiledNoise(123, u * 10, v * 10, 10) * 0.14 + (g - 0.5) * 0.06);
    if (v < 0.12) c = shade(c, 0.8);
    // Knuckle and finger seams on the back of the hand.
    if (v > 0.55 && (u * 8) % 1 < 0.06) c = shade(c, 0.8);
    return c;
  },
  belt(u, v, x, y) {
    const g = grain(x, y, 131);
    let c = shade([160, 140, 102], 0.9 + (g - 0.5) * 0.08 + ((y % 4) === 0 ? -0.08 : 0));
    if (v < 0.1 || v > 0.9) c = shade(c, 0.8);
    if (Math.abs(u - 0.5) < 0.04) c = [96, 92, 80]; // the buckle
    return c;
  },
  skin(u, v, x, y) {
    const g = grain(x, y, 141);
    return shade(SKIN, 0.9 + tiledNoise(143, u * 4, v * 4, 4) * 0.1 + (g - 0.5) * 0.04);
  },
  goggle(u, v, x, y) {
    // Tinted lenses in a tan frame.
    const g = grain(x, y, 151);
    const lens = Math.abs(v - 0.5) < 0.3 && Math.abs(Math.abs(u - 0.5) - 0.22) < 0.18;
    if (lens) return shade([46, 52, 58], 0.9 + (1 - v) * 0.4 + g * 0.05);
    return shade([140, 124, 94], 0.9 + g * 0.08);
  },
  strap(u, v, x, y) {
    const g = grain(x, y, 161);
    return shade([96, 92, 70], 0.85 + ((x % 3) === 0 ? 0.1 : 0) + (g - 0.5) * 0.06);
  },
  cuff(u, v, x, y) {
    // A blouse cuff or collar: DCU, doubled over, a seam across it.
    return shade(dcu(u, v, x, y, 171, 2), seam(v, 0.5, 0.03) * 0.95);
  },
};

export function paintSoldierAtlas(): Uint8Array {
  const S = SOLDIER_ATLAS_SIZE;
  const out = new Uint8Array(S * S * 4).fill(96);
  for (const [name, [rx, ry, rw, rh]] of Object.entries(PX) as [RegionName, readonly [number, number, number, number]][]) {
    const paint = PAINT[name];
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const [r, g, b] = paint((x + 0.5) / rw, (y + 0.5) / rh, x, y);
        const o = ((ry + y) * S + rx + x) * 4;
        out[o] = clamp(r);
        out[o + 1] = clamp(g);
        out[o + 2] = clamp(b);
        out[o + 3] = 255;
      }
    }
  }
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return out;
}

export function soldierAtlasPng(): Uint8Array {
  const png = new PNG({ width: SOLDIER_ATLAS_SIZE, height: SOLDIER_ATLAS_SIZE });
  png.data = Buffer.from(paintSoldierAtlas());
  return new Uint8Array(PNG.sync.write(png));
}

const clamp = (n: number): number => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));
