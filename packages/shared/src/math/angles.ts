/**
 * Binary angles (ADR-014, ADR-009).
 *
 * Angles are integers, not radians. A full turn is ANGLE_UNITS; arithmetic on
 * them wraps exactly with a mask, and they index the trig table directly with
 * no interpolation.
 *
 * The wire format quantises angles to 1/1024 turn (T-1.02). The table is four
 * times finer at 1/4096 turn, so every wire angle lands exactly on a table
 * entry: `tableIndex = wireAngle << 2`. Changing either resolution means
 * regenerating the table — see tools/src/gen-trig-table.ts.
 */

/** Table resolution: one full turn. */
export const ANGLE_BITS = 12;
export const ANGLE_UNITS = 1 << ANGLE_BITS; // 4096
export const ANGLE_MASK = ANGLE_UNITS - 1;
export const ANGLE_QUARTER = ANGLE_UNITS >> 2; // 1024

/** Wire resolution (T-1.02): 1/1024 turn. */
export const WIRE_ANGLE_BITS = 10;
export const WIRE_ANGLE_UNITS = 1 << WIRE_ANGLE_BITS; // 1024
/** Shift taking a wire angle to a table angle. Exact by construction. */
export const WIRE_TO_TABLE_SHIFT = ANGLE_BITS - WIRE_ANGLE_BITS; // 2

/** An angle in table units, always normalised to [0, ANGLE_UNITS). */
export type BinAngle = number;

/** Wrap any integer into [0, ANGLE_UNITS). Exact: bitwise only. */
export function wrapAngle(a: number): BinAngle {
  return a & ANGLE_MASK;
}

/** Shortest signed difference a - b, in (-ANGLE_UNITS/2, ANGLE_UNITS/2]. */
export function angleDelta(a: BinAngle, b: BinAngle): number {
  const d = (a - b) & ANGLE_MASK;
  return d > ANGLE_UNITS / 2 ? d - ANGLE_UNITS : d;
}

export function wireToTable(wire: number): BinAngle {
  return (wire << WIRE_TO_TABLE_SHIFT) & ANGLE_MASK;
}

export function tableToWire(a: BinAngle): number {
  return (a >> WIRE_TO_TABLE_SHIFT) & (WIRE_ANGLE_UNITS - 1);
}

/**
 * Radians are for authoring and rendering only — never for simulation. Math.PI
 * is an exactly specified constant and Math.round is exactly specified, so this
 * conversion is deterministic; it is the transcendental *functions* that are not.
 */
export function fromRadians(rad: number): BinAngle {
  return wrapAngle(Math.round((rad / (Math.PI * 2)) * ANGLE_UNITS));
}

export function toRadians(a: BinAngle): number {
  return (a / ANGLE_UNITS) * Math.PI * 2;
}
