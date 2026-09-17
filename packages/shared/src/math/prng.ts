/**
 * Deterministic pseudo-random numbers (T-0.14, ADR-014).
 *
 * Math.random is banned in simulation code: it is unseeded, so client and server
 * can never agree. These use only 32-bit integer operations and Math.imul, all
 * of which ARE exactly specified by ECMAScript — unlike the transcendentals.
 */

/** Integer hash (murmur3 finaliser). Pure: same input, same output, everywhere. */
export function mix32(x: number): number {
  let h = x | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Combine several integers into one seed. Use for stateless per-event
 * randomness — weapon spread is seeded from (tick, entityId, shotIndex) so both
 * sides compute the same value without exchanging anything (T-1.17).
 */
export function seedFrom(...parts: readonly number[]): number {
  let h = 0x9e3779b9;
  for (const p of parts) h = mix32((h ^ (p | 0)) >>> 0);
  return h >>> 0;
}

/** Uniform float in [0, 1) from a seed. Stateless. */
export function unitFromSeed(seed: number): number {
  return mix32(seed) / 4294967296;
}

/**
 * sfc32 — a small, fast, 128-bit-state generator using only 32-bit integer ops.
 * Chosen over PCG32 and xorshift128+ because those need 64-bit arithmetic, which
 * in JavaScript means BigInt (slow) or manual hi/lo splitting (error-prone).
 */
export class Sfc32 {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    this.a = mix32(seed) | 0;
    this.b = mix32(seed ^ 0x9e3779b9) | 0;
    this.c = mix32(seed ^ 0x85ebca6b) | 0;
    this.d = 1;
  }

  /** Next uint32. */
  nextUint32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) + t;
    this.c = this.c | 0;
    return t >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }
}
