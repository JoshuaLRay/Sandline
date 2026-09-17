/**
 * Deterministic trigonometry (T-0.14, ADR-014).
 *
 * Math.sin/cos are not specified to bit precision by ECMAScript, so they differ
 * between V8 (Node, Chrome), JSC (Safari) and SpiderMonkey (Firefox). A
 * character controller that converts yaw to a direction vector with Math.cos
 * will therefore drift between server and client — and because the server is
 * Node and the common client is Chrome, both V8, the drift is INVISIBLE during
 * development and appears only for Safari and Firefox players.
 *
 * These lookups are exact everywhere: an integer index into committed literal
 * data, plus negation. No interpolation, no floating-point transcendentals.
 */
import { ANGLE_MASK, ANGLE_QUARTER, ANGLE_UNITS, type BinAngle, wrapAngle } from './angles.ts';
import { QUARTER_SIN } from './trigTable.ts';

function quarter(i: number): number {
  // Table is 0..ANGLE_QUARTER inclusive, so this index is always in range.
  return QUARTER_SIN[i] as number;
}

/**
 * Collapse negative zero to positive zero.
 *
 * Negating table entry 0 yields -0. Arithmetically -0 === 0, but Object.is
 * distinguishes them and, more importantly, they have different bit patterns:
 * a byte-level state hash would read -0 and 0 as a divergence between two runs
 * that are in fact identical. That is a spurious parity failure of exactly the
 * kind ADR-014's R10 warns about, so we remove the distinction at the source.
 *
 * `x + 0` is exact for every finite x and maps -0 to +0 under IEEE-754.
 */
function noNegZero(x: number): number {
  return x + 0;
}

/** sin of a binary angle. Exact and identical on every JS engine. */
export function sin(a: BinAngle): number {
  const x = a & ANGLE_MASK;
  const r = x & (ANGLE_QUARTER - 1);
  switch (x >> 10) {
    case 0: return quarter(r);
    case 1: return quarter(ANGLE_QUARTER - r);
    case 2: return noNegZero(-quarter(r));
    default: return noNegZero(-quarter(ANGLE_QUARTER - r));
  }
}

/** cos of a binary angle, as sin shifted a quarter turn. */
export function cos(a: BinAngle): number {
  return sin(a + ANGLE_QUARTER);
}

/**
 * Ground direction for a yaw. This is the call the character controller makes
 * every tick (T-1.12) and the single most likely source of client/server drift
 * if it ever reaches for Math.cos.
 */
export function dirFromYaw(yaw: BinAngle): { x: number; z: number } {
  const a = wrapAngle(yaw);
  return { x: sin(a), z: cos(a) };
}

/** Rotate (x, z) about the Y axis by a binary angle. */
export function rotateY(x: number, z: number, a: BinAngle): { x: number; z: number } {
  const s = sin(a);
  const c = cos(a);
  return { x: x * c + z * s, z: -x * s + z * c };
}

export { ANGLE_UNITS };
