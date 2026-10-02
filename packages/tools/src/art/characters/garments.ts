/** Cloth landmarks in metres. Geometry and diffuse paint sample the same field,
 * so a painted crease never runs across an unrelated smooth part of the mesh. */
export type Garment = "sleeve" | "trousers" | "blouse";
const bell = (d: number, w: number): number => Math.exp(-((d / w) ** 2));
interface Fold {
  height: number;
  slope: number;
  width: number;
  depth: number;
  centre: number;
  span: number;
}
const FOLDS: Record<Garment, readonly Fold[]> = {
  sleeve: [
    {
      height: 1.34,
      slope: 0.045,
      width: 0.025,
      depth: 0.008,
      centre: 0.72,
      span: 0.3,
    },
    {
      height: 1.24,
      slope: -0.09,
      width: 0.014,
      depth: 0.009,
      centre: 0.42,
      span: 0.24,
    },
    {
      height: 1.175,
      slope: 0.1,
      width: 0.016,
      depth: 0.013,
      centre: 0.15,
      span: 0.26,
    },
    {
      height: 1.115,
      slope: -0.07,
      width: 0.011,
      depth: 0.009,
      centre: 0.7,
      span: 0.25,
    },
    {
      height: 1.005,
      slope: 0.05,
      width: 0.014,
      depth: 0.01,
      centre: 0.5,
      span: 0.4,
    },
  ],
  trousers: [
    {
      height: 0.74,
      slope: 0.07,
      width: 0.025,
      depth: 0.009,
      centre: 0.65,
      span: 0.25,
    },
    {
      height: 0.61,
      slope: -0.12,
      width: 0.018,
      depth: 0.012,
      centre: 0.48,
      span: 0.25,
    },
    {
      height: 0.5,
      slope: 0.1,
      width: 0.018,
      depth: 0.014,
      centre: 0.05,
      span: 0.29,
    },
    {
      height: 0.43,
      slope: -0.08,
      width: 0.013,
      depth: 0.012,
      centre: 0.85,
      span: 0.22,
    },
    {
      height: 0.3,
      slope: 0.08,
      width: 0.014,
      depth: 0.013,
      centre: 0.55,
      span: 0.32,
    },
    {
      height: 0.255,
      slope: -0.05,
      width: 0.011,
      depth: 0.012,
      centre: 0.18,
      span: 0.34,
    },
  ],
  blouse: [
    {
      height: 1.42,
      slope: -0.08,
      width: 0.018,
      depth: 0.007,
      centre: 0.25,
      span: 0.2,
    },
    {
      height: 1.1,
      slope: 0.12,
      width: 0.018,
      depth: 0.013,
      centre: 0.52,
      span: 0.22,
    },
    {
      height: 1.025,
      slope: -0.05,
      width: 0.012,
      depth: 0.01,
      centre: 0.0,
      span: 0.3,
    },
  ],
};
function wrapDelta(a: number, b: number): number {
  return ((a - b + 1.5) % 1) - 0.5;
}
export function clothDisplacement(
  kind: Garment,
  t: number,
  height: number,
  side: number = 1,
): number {
  let d = 0;
  for (const f of FOLDS[kind]) {
    const u = wrapDelta(t, f.centre + (side < 0 ? 0.075 : 0));
    const h = height - f.height - f.slope * u - (side < 0 ? 0.007 : 0);
    // Fold crest beside a shallow valley, with ends fading into the garment.
    d +=
      f.depth *
      (bell(h, f.width) - 0.45 * bell(h - f.width * 1.5, f.width)) *
      bell(u, f.span);
  }
  // Gravity folds: long, uneven ridges with no ring-shaped ribbing.
  const hang =
    kind === "trousers"
      ? bell(height - 0.73, 0.16)
      : kind === "sleeve"
        ? bell(height - 1.32, 0.13)
        : 0.5;
  d +=
    0.005 *
    hang *
    (Math.cos(t * Math.PI * 8 + side * 0.7) +
      0.35 * Math.cos(t * Math.PI * 14 + 1.1));
  return d;
}
export function clothShade(
  kind: Garment,
  t: number,
  height: number,
  side = 1,
): number {
  const gradient =
    (clothDisplacement(kind, t, height + 0.002, side) -
      clothDisplacement(kind, t, height - 0.002, side)) /
    0.004;
  return Math.max(0.64, Math.min(1.16, 1 - gradient * 0.23));
}
