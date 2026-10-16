/** U-179 fixed §8.2 furnishings. No encounter, interaction or campaign activation. */
import type { BoxSpec } from '@sandline/shared';

const box = (id: string, x: number, y: number, z: number, w: number, h: number, d: number): BoxSpec =>
  ({ id: `outpost-${id}`, x, y, z, w, h, d });

export function buildOutpostFurniture(): BoxSpec[] {
  return [
    // Original positions remain explicit until U-180 resolves the V3 gun view.
    box('furniture-O-C01', 38, 8, 359, 6, 1.1, .8),
    box('furniture-O-C02', 30, 8, 376, 1.2, 2.2, 4),
    box('furniture-O-C03', 40, 8, 385, 5, 1.1, 1.8),
    box('furniture-O-C04', 32, 8, 400, 1.2, 2.2, 4),
    box('furniture-radio-table', 52, 8, 404, 2, 1, 1),
    ...[46.3, 51.7].flatMap((x, i) => [414.3, 419.7].map((z, j) =>
      box(`tower-leg-${i}-${j}`, x, 8, z, .6, 14, .6))),
    // A closed tank, no deck, ladder, intermediate brace or firing platform.
    box('tower-tank', 49, 22, 417, 6, 4, 6),
  ];
}

/** Flush visual cues never add a step, collision surface or interaction. */
export function outpostDecorations(): BoxSpec[] {
  return [
    ...[24, 36].map((x, i) => box(`decor-south-leaf-${i}`, x + 2, 8, 356.03, 4, 3, .06)),
    ...[24, 36].map((x, i) => box(`decor-north-leaf-${i}`, x + 2, 8, 411.97, 4, 3, .06)),
    ...[370, 376].flatMap((z, i) => [8.03, 55.97].map((x, j) =>
      box(`decor-side-leaf-${i}-${j}`, x, 8, z + 1, .06, 3, 2))),
    box('decor-radio-lamp-stem', 52.5, 9, 404, .08, .45, .08),
    box('decor-radio-lamp-shade', 52.5, 9.4, 404, .4, .16, .3),
    box('decor-radio-set', 51.8, 9, 404, .8, .35, .5),
    box('decor-radio-aerial-lead', 53.98, 9.05, 404, .04, 2.9, .04),
    ...[13.96, 18.04].map((x, i) => box(`decor-cell-blue-trim-${i}`, x, 8, 396.03, .08, 3, .06)),
    box('decor-cell-blue-trim-head', 16, 10.98, 396.03, 4.16, .08, .06),
    box('decor-cell-paperwork', 10.02, 10.2, 406, .04, .6, .5),
  ];
}
