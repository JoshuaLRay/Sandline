/**
 * Seeded randomness for the art generators (T-4.04, ADR-018). Nothing here
 * may read the clock or `Math.random`: a generator's output is committed and
 * checked for staleness, so the same seed must paint the same texels on
 * every machine. Integer arithmetic throughout, with `Math.imul`.
 */

/** mulberry32: a small, fast, well-mixed 32-bit generator. Returns [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A lattice value in [0, 1) for integer (x, y) under a seed. */
function lattice(seed: number, x: number, y: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);
const mod = (n: number, m: number): number => ((n % m) + m) % m;

/**
 * Value noise that tiles with period `period` lattice cells, so a texture
 * painted with it repeats across a wall without a seam. `(u, v)` are in
 * lattice units; the result is in [0, 1).
 */
export function tiledNoise(seed: number, u: number, v: number, period: number): number {
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = smooth(u - x0);
  const fy = smooth(v - y0);
  const at = (x: number, y: number) => lattice(seed, mod(x, period), mod(y, period));
  const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
  const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
  return top + (bottom - top) * fy;
}

/** Octaves of `tiledNoise`, each twice the frequency and half the weight; still tiles. Result in [0, 1). */
export function tiledFbm(seed: number, u: number, v: number, period: number, octaves: number): number {
  let sum = 0;
  let weight = 0.5;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const f = 1 << o;
    sum += tiledNoise(seed + o * 101, u * f, v * f, period * f) * weight;
    total += weight;
    weight /= 2;
  }
  return sum / total;
}
