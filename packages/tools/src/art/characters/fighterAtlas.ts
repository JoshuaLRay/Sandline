/**
 * The enemy fighter's atlas (T-4.35; ADR-018, ADR-020): one 1024² diffuse for
 * an irregular fighter in Afghanistan, winter 2001–2002, painted from
 * arithmetic and seeded noise like the soldier's (`soldierAtlas.ts`).
 *
 * TINTED PARTS ARE PAINTED PALE. The kameez, the trousers, the pakol and the
 * turban are painted in a light, near-neutral cloth with its weave, folds
 * and seams; the page multiplies each by a variant's colour
 * (`fighterLook.json`), so a handful of fighters in different earth colours
 * is one texture. Everything else — the face and beard, the hands, the
 * waistcoat, the chest rig, the sash, the scarf, the boots and the
 * bandolier — is painted in its own colour and never tinted.
 */
import { PNG } from 'pngjs';
import { rng, tiledFbm, tiledNoise } from '../noise.ts';
import type { Region } from './skin.ts';

export const FIGHTER_ATLAS_SIZE = 1024;

type Rgb = [number, number, number];

/** Regions in texels: x, y from the top left, width, height. */
const PX = {
  face: [0, 0, 256, 256],
  kameez: [256, 0, 256, 256],
  trousers: [512, 0, 256, 256],
  waistcoat: [768, 0, 256, 256],
  pakol: [0, 256, 256, 128],
  turban: [0, 384, 256, 128],
  scarf: [256, 256, 256, 256],
  rig: [512, 256, 128, 128],
  boot: [640, 256, 128, 128],
  skin: [512, 384, 128, 128],
  sash: [640, 384, 128, 128],
  bandolier: [768, 256, 256, 128],
  sleeve: [768, 384, 256, 128],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export type FighterRegion = keyof typeof PX;

/** Every region, for a test that walks them. */
export const FIGHTER_REGIONS = Object.keys(PX) as FighterRegion[];

/** A 2-texel inset keeps bilinear filtering inside its own region. */
const INSET = 2;

export function fighterRegion(name: FighterRegion): Region {
  const [x, y, w, h] = PX[name];
  const s = FIGHTER_ATLAS_SIZE;
  return { u0: (x + INSET) / s, v0: (y + INSET) / s, u1: (x + w - INSET) / s, v1: (y + h - INSET) / s };
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];
const grain = (x: number, y: number, seed: number): number => rng((x * 73856093) ^ (y * 19349663) ^ seed)();
const soft = (d: number, r: number): number => Math.max(0, 1 - d / r) ** 2;

/** The pale cloth every tinted part is painted in: a variant's colour multiplies it. */
const PALE: Rgb = [236, 230, 218];
const SKIN: Rgb = [178, 128, 94];

/**
 * Homespun cotton: the weave, long soft folds down the hang of the cloth,
 * worn patches and dust at the hem (v near 1). `folds` is folds per region width.
 */
function cloth(u: number, v: number, x: number, y: number, seed: number, folds: number): Rgb {
  const g = grain(x, y, seed);
  const weave = ((x + (y >> 1)) % 2) * 0.025;
  const fold = tiledNoise(seed + 7, u * folds, v * 2, folds);
  const blotch = tiledFbm(seed + 13, u * 3, v * 3, 3, 2);
  let c = shade(PALE, 0.84 + weave + (fold - 0.5) * 0.22 + (blotch - 0.5) * 0.08 + (g - 0.5) * 0.05);
  // Dust climbs the cloth from the ground.
  c = mix(c, [196, 176, 146], Math.max(0, v - 0.7) * 0.9);
  return c;
}

/** A seam: a darker line with a pale stitch row beside it, `at` in [0, 1] across `t`. */
function seam(t: number, at: number, width: number): number {
  const d = Math.abs(t - at);
  return d < width ? 0.74 : d < width * 2 ? 1.05 : 1;
}

type Painter = (u: number, v: number, x: number, y: number) => Rgb;

const PAINT: Record<FighterRegion, Painter> = {
  face(u, v, x, y) {
    // u round the head, the face at u = 0.5; v by height from the crown (y 1.83) to the neck (1.52).
    const g = grain(x, y, 211);
    const du = u - 0.5;
    const adu = Math.abs(du);
    const hy = 1.83 - v * 0.31;
    // Sun-darkened skin, shadowed toward the sides.
    let c = shade(SKIN, 0.9 + tiledNoise(213, u * 6, v * 6, 6) * 0.08 + (g - 0.5) * 0.05 - adu * 0.22);
    for (const side of [-1, 1]) c = mix(c, [176, 104, 80], 0.18 * soft(Math.sqrt(((du - side * 0.07) / 0.06) ** 2 + ((hy - 1.64) / 0.03) ** 2), 1));
    // Dark hair above the brow and round the back (mostly under the cap).
    if (hy > 1.71 || (adu > 0.2 && hy > 1.63)) c = mix(c, [34, 28, 24], 0.85 + g * 0.15);
    // The beard: full and dark on the jaw, chin and lip, thinning up the cheek.
    const beard = Math.min(1, Math.max(0, (1.64 - hy) / 0.025)) * (adu < 0.3 ? 1 : 0);
    const lip = Math.abs(hy - 1.617) < 0.006 && adu < 0.04;
    c = mix(c, shade([40, 32, 26], 0.9 + g * 0.25), Math.min(1, beard * (0.75 + g * 0.3)) * (lip ? 0.7 : 1));
    // Ears in shadow.
    if (Math.abs(adu - 0.25) < 0.03 && hy > 1.63 && hy < 1.7) c = shade(c, Math.abs(adu - 0.25) < 0.012 ? 0.66 : 0.85);
    // Deep-set eyes under a heavy brow.
    for (const side of [-1, 1]) {
      const ex = du - side * 0.048;
      const hyE = hy - 1.672;
      c = shade(c, 1 - 0.24 * soft(Math.sqrt((ex / 0.042) ** 2 + ((hyE - 0.004) / 0.022) ** 2), 1));
      if ((ex / 0.016) ** 2 + (hyE / 0.0045) ** 2 < 1) c = [190, 176, 156];
      if ((ex / 0.0065) ** 2 + (hyE / 0.0045) ** 2 < 1) c = [44, 32, 24];
      if (Math.abs(ex) < 0.028 && Math.abs(hy - 1.69 + ex * ex * 5) < 0.004) c = mix(c, [30, 24, 20], 0.9);
    }
    // The nose: lit ridge, shaded side, nostrils.
    if (adu < 0.024 && hy < 1.672 && hy > 1.632) c = shade(c, 1 + 0.06 * soft(adu, 0.01) - 0.14 * Math.max(0, du) / 0.024);
    if (Math.abs(adu - 0.012) < 0.006 && Math.abs(hy - 1.63) < 0.003) c = shade(c, 0.6);
    // The mouth, a dark line in the beard.
    if (adu < 0.03 && Math.abs(hy - 1.607) < 0.0028) c = shade(c, 0.55);
    return c;
  },
  kameez(u, v, x, y) {
    // The long shirt: side seams, a placket down the front's top, the hem stitched.
    let c = cloth(u, v, x, y, 221, 7);
    c = shade(c, seam(u, 0.25, 0.004) * seam(u, 0.75, 0.004));
    if (Math.abs(u - 0.5) < 0.012 && v < 0.3) c = shade(c, 0.8);
    if (v > 0.95) c = shade(c, 0.82);
    return c;
  },
  trousers(u, v, x, y) {
    // Loose shalwar: deep folds gathered toward the ankle.
    const folds = 5 + Math.round(v * 6);
    let c = cloth(u, v, x, y, 231, folds);
    c = shade(c, seam(u, 0.25, 0.004) * seam(u, 0.75, 0.004));
    if (v > 0.9) c = shade(c, 0.85 + ((x >> 2) % 2) * 0.08);
    return c;
  },
  sleeve(u, v, x, y) {
    let c = cloth(u, v, x, y, 241, 5);
    c = shade(c, seam(u, 0.5, 0.004));
    if (v > 0.9) c = shade(c, 0.84);
    return c;
  },
  waistcoat(u, v, x, y) {
    // A dark wool waistcoat, open down the front: it is lofted from the left
    // front edge (u = 0) round the back (u = 0.5) to the right front edge
    // (u = 1). Nap and wear; piping and a row of buttons along the front
    // edges; a pocket on each breast; a seam down the back.
    const g = grain(x, y, 251);
    let c = shade([70, 62, 54], 0.88 + tiledFbm(253, u * 8, v * 8, 8, 2) * 0.2 + (g - 0.5) * 0.08);
    const edge = Math.min(u, 1 - u);
    if (edge < 0.02) c = shade(c, 1.25);
    if (Math.abs(edge - 0.04) < 0.012 && (v * 7) % 1 < 0.12 && v < 0.85) c = [150, 132, 96];
    if (Math.abs(edge - 0.12) < 0.05 && Math.abs(v - 0.3) < 0.04) c = shade(c, Math.abs(v - 0.26) < 0.006 ? 0.55 : 0.9);
    c = shade(c, seam(u, 0.5, 0.004));
    if (v < 0.05 || v > 0.95) c = shade(c, 1.2);
    return c;
  },
  pakol(u, v, x, y) {
    // A felted wool cap: dense nap, the rolled rim's creases round it.
    const g = grain(x, y, 261);
    let c = shade(PALE, 0.8 + tiledFbm(263, u * 12, v * 4, 12, 3) * 0.24 + (g - 0.5) * 0.08);
    if (v > 0.35) c = shade(c, 0.9 + Math.sin(v * 40) * 0.05);
    return c;
  },
  turban(u, v, x, y) {
    // Wound cloth: bands running round the head, each wrap's edge in shadow.
    let c = cloth(u, v, x, y, 271, 3);
    const wrap = (v * 7 + u * 0.8) % 1;
    c = shade(c, wrap < 0.12 ? 0.74 : 0.98 + wrap * 0.05);
    return c;
  },
  scarf(u, v, x, y) {
    // A patterned wool scarf: a woven check in dull red and ochre.
    const g = grain(x, y, 281);
    const a = ((u * 16) % 1) < 0.5;
    const b = ((v * 16) % 1) < 0.5;
    let c: Rgb = a === b ? [128, 58, 44] : [168, 128, 76];
    if (((u * 16) % 1) < 0.08 || ((v * 16) % 1) < 0.08) c = [204, 186, 150];
    c = shade(c, 0.86 + tiledNoise(283, u * 5, v * 5, 5) * 0.14 + (g - 0.5) * 0.06);
    return c;
  },
  rig(u, v, x, y) {
    // A chest rig: faded olive canvas, three magazine cells with flaps and a buckle strap.
    const g = grain(x, y, 291);
    let c = shade([96, 92, 64], 0.86 + tiledNoise(293, u * 8, v * 8, 8) * 0.16 + (g - 0.5) * 0.08);
    const cell = (u * 3) % 1;
    if (cell < 0.04 || cell > 0.96) c = shade(c, 0.6);
    if (v < 0.35) c = shade(c, 1.08);
    if (Math.abs(v - 0.35) < 0.02) c = shade(c, 0.58);
    if (Math.abs(cell - 0.5) < 0.05 && Math.abs(v - 0.25) < 0.04) c = [58, 54, 44];
    return c;
  },
  boot(u, v, x, y) {
    // Worn dark leather, scuffed pale at the toes, a thin sole.
    const g = grain(x, y, 301);
    let c = shade([66, 50, 38], 0.84 + tiledFbm(303, u * 10, v * 10, 10, 2) * 0.26 + (g - 0.5) * 0.08);
    if (Math.abs(u - 0.5) < 0.12 && v > 0.55 && v < 0.82) c = mix(c, [140, 118, 92], 0.35);
    if (v > 0.84) c = shade([40, 34, 30], 0.9 + g * 0.1);
    return c;
  },
  skin(u, v, x, y) {
    const g = grain(x, y, 311);
    return shade(SKIN, 0.88 + tiledNoise(313, u * 4, v * 4, 4) * 0.1 + (g - 0.5) * 0.05);
  },
  sash(u, v, x, y) {
    // A cloth belt wound round the waist, its folds running round it.
    const g = grain(x, y, 321);
    let c = shade([112, 96, 70], 0.86 + tiledNoise(323, u * 3, v * 9, 3) * 0.2 + (g - 0.5) * 0.06);
    if ((v * 4) % 1 < 0.1) c = shade(c, 0.72);
    return c;
  },
  bandolier(u, v, x, y) {
    // Leather belt with brass cartridges in loops along it.
    const g = grain(x, y, 331);
    let c = shade([84, 60, 40], 0.86 + (g - 0.5) * 0.1);
    const loop = (u * 40) % 1;
    if (v > 0.2 && v < 0.8) c = loop < 0.6 ? shade([176, 138, 70], 0.8 + (1 - Math.abs(loop - 0.3) * 3) * 0.4) : shade(c, 0.7);
    if (v < 0.1 || v > 0.9) c = shade(c, 0.75);
    return c;
  },
};

export function paintFighterAtlas(): Uint8Array {
  const S = FIGHTER_ATLAS_SIZE;
  const out = new Uint8Array(S * S * 4).fill(96);
  for (const [name, [rx, ry, rw, rh]] of Object.entries(PX) as [FighterRegion, readonly [number, number, number, number]][]) {
    const paint = PAINT[name];
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const [r, g, b] = paint((x + 0.5) / rw, (y + 0.5) / rh, x, y);
        const o = ((ry + y) * S + rx + x) * 4;
        out[o] = clamp(r);
        out[o + 1] = clamp(g);
        out[o + 2] = clamp(b);
      }
    }
  }
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return out;
}

export function fighterAtlasPng(): Uint8Array {
  const png = new PNG({ width: FIGHTER_ATLAS_SIZE, height: FIGHTER_ATLAS_SIZE });
  png.data = Buffer.from(paintFighterAtlas());
  return new Uint8Array(PNG.sync.write(png));
}

const clamp = (n: number): number => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));
