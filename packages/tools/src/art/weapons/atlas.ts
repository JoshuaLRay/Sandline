/**
 * The weapons atlas (T-4.36; ADR-018, ADR-020): one 512² diffuse shared by
 * every weapon. Sixteen 128² regions, each a surface a 2002 console rifle
 * wore:
 *   - parkerized steel with worn edges;
 *   - black stippled polymer;
 *   - AK laminate and old walnut;
 *   - olive drab paint;
 *   - an M249's and a PKM's black finish;
 *   - an RPG warhead's green;
 *   - brass;
 *   - glass.
 * Each surface tiles, because weapon UVs are planar at a fixed texel size
 * (`mesh.ts`), and is filtered smoothly (T-4.08).
 */
import { PNG } from 'pngjs';
import { rng, tiledFbm, tiledNoise } from '../noise.ts';

export const WEAPON_ATLAS_SIZE = 512;
const CELL = 128;

const REGIONS = ['steel', 'polymer', 'laminate', 'walnut', 'olive', 'rail', 'warhead', 'brass', 'glass', 'rubber', 'webbing', 'label'] as const;
export type WeaponRegion = (typeof REGIONS)[number];

export interface Rect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** A 3-texel inset keeps filtering inside the region. */
export function weaponRegion(name: WeaponRegion): Rect {
  const i = REGIONS.indexOf(name);
  const per = WEAPON_ATLAS_SIZE / CELL;
  const x = (i % per) * CELL + 3;
  const y = Math.floor(i / per) * CELL + 3;
  const s = WEAPON_ATLAS_SIZE;
  return { u0: x / s, v0: y / s, u1: (x + CELL - 6) / s, v1: (y + CELL - 6) / s };
}

type Rgb = [number, number, number];
const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

type Painter = (u: number, v: number, g: number, seed: number) => Rgb;

const PAINT: Record<WeaponRegion, Painter> = {
  steel(u, v, g, seed) {
    // Parkerized: grey-black, a fine mottle, lighter where hands and holsters have worn it.
    const wear = tiledFbm(seed, u * 4, v * 4, 4, 3);
    return shade(mix([46, 48, 48], [96, 98, 96], wear > 0.66 ? (wear - 0.66) * 2.5 : 0), 0.92 + (g - 0.5) * 0.16);
  },
  polymer(u, v, g, seed) {
    const stipple = tiledNoise(seed, u * 32, v * 32, 32);
    return shade([36, 37, 36], 0.9 + stipple * 0.18 + (g - 0.5) * 0.08);
  },
  laminate(u, v, g, seed) {
    // An AK's laminate: reddish layers banded along the wood.
    const band = tiledNoise(seed, u * 2, v * 24, 2) * 0.3 + tiledNoise(seed + 5, u * 16, v * 3, 16) * 0.1;
    return shade([128, 62, 36], 0.82 + band + (g - 0.5) * 0.06);
  },
  walnut(u, v, g, seed) {
    const grain = tiledNoise(seed, u * 3, v * 40, 3) * 0.2 + tiledFbm(seed + 3, u * 4, v * 4, 4, 2) * 0.15;
    return shade([104, 70, 44], 0.8 + grain + (g - 0.5) * 0.06);
  },
  olive(u, v, g, seed) {
    const m = tiledFbm(seed, u * 4, v * 4, 4, 3);
    return shade([84, 90, 58], 0.9 + m * 0.14 + (g - 0.5) * 0.06);
  },
  rail(u, v, g) {
    // Picatinny: raised ribs across the rail at a fixed pitch, their tops worn bright.
    const rib = (u * 16) % 1 < 0.5;
    return shade(rib ? [72, 74, 74] : [30, 31, 31], 0.92 + (g - 0.5) * 0.12);
  },
  warhead(u, v, g, seed) {
    const m = tiledFbm(seed, u * 4, v * 4, 4, 2);
    return shade([72, 86, 52], 0.88 + m * 0.16 + (g - 0.5) * 0.06);
  },
  brass(u, v, g, seed) {
    return shade([176, 140, 64], 0.86 + tiledNoise(seed, u * 8, v * 8, 8) * 0.2 + (g - 0.5) * 0.06);
  },
  glass(u, v, g) {
    return shade([20, 34, 44], 0.8 + (1 - v) * 0.5 + g * 0.05);
  },
  rubber(u, v, g) {
    return shade([28, 27, 26], 0.9 + (g - 0.5) * 0.1);
  },
  webbing(u, v, g) {
    // A sling: olive nylon with a woven edge.
    const edge = v < 0.1 || v > 0.9;
    return shade([88, 86, 64], (edge ? 0.8 : 0.95) + ((Math.floor(u * 128) % 2) * 0.04) + (g - 0.5) * 0.06);
  },
  label(u, v, g) {
    // Stencilled yellow bands on olive, as on an AT4's tube.
    const band = Math.abs(v - 0.5) < 0.08;
    return band ? shade([170, 150, 60], 0.9 + g * 0.1) : shade([84, 90, 58], 0.9 + (g - 0.5) * 0.08);
  },
};

export function paintWeaponAtlas(): Uint8Array {
  const S = WEAPON_ATLAS_SIZE;
  const out = new Uint8Array(S * S * 4).fill(64);
  const per = S / CELL;
  REGIONS.forEach((name, i) => {
    const cx = (i % per) * CELL;
    const cy = Math.floor(i / per) * CELL;
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const g = rng((x * 73856093) ^ (y * 19349663) ^ (i * 83492791))();
        const [r, gg, b] = PAINT[name]((x + 0.5) / CELL, (y + 0.5) / CELL, g, 1000 + i * 17);
        const o = ((cy + y) * S + cx + x) * 4;
        out[o] = clamp(r);
        out[o + 1] = clamp(gg);
        out[o + 2] = clamp(b);
        out[o + 3] = 255;
      }
    }
  });
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return out;
}

export function weaponAtlasPng(): Uint8Array {
  const png = new PNG({ width: WEAPON_ATLAS_SIZE, height: WEAPON_ATLAS_SIZE });
  png.data = Buffer.from(paintWeaponAtlas());
  return new Uint8Array(PNG.sync.write(png));
}

const clamp = (n: number): number => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));
