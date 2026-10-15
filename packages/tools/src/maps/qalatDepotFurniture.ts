/** U-172 fixed §7.3 internals. Decoration never supplies collision or nav. */
import type { BoxSpec } from '@sandline/shared';

const solid = (name: string, x: number, z: number, w: number, d: number, h: number): BoxSpec =>
  ({ id: `depot-furniture-${name}`, x, y: 0, z, w, d, h });

export function buildDepotFurniture(): BoxSpec[] {
  return [
    // Owner-approved 0.4 m shift keeps the centered west-door landing free.
    solid('B1-crate', -6, 98.4, 3, .8, 1.1),
    solid('B2-sacks', -24, 116, .8, 4, 1.1),
    // §7.3 permits trimming only B2's crate depth outside the aisle. Keep
    // its nominal -14 datum as the east face, trimming the east 0.6 m so
    // the wall bypass is a full 4 m. The central x[-23,-17] aisle is intact.
    solid('B2-crate', -14.3, 124, .6, 4, 2.2),
    ...[[-44, 152], [-28, 152], [-44, 168], [-28, 168]].map(([x, z], i) =>
      solid(`B3-pier-${i}`, x!, z!, 1.2, 1.2, 5.5)),
    solid('B3-wall', -36, 164, 4, .8, 1.1),
    ...[-24, -12].map((x, i) => solid(`B4-engine-${i}`, x, 200, 3, 8, 2.2)),
    solid('B5-bench', 3, 234, .8, 4, 1.1),
    ...[258, 270, 282].flatMap((z, row) => [22, 38].map((x, col) =>
      solid(`B6-pier-${row * 2 + col}`, x, z, 1.2, 1.2, 5.5))),
    solid('B6-crate-west', 19, 265, 1.2, 4, 2.2),
    solid('B6-crate-east', 41, 277, 1.2, 4, 2.2),
    solid('B6-low-stack', 30, 276, 4, .8, 1.1),
    solid('B7-bench', -22, 312, 1, 6, 1),
    ...[-22, -6].map((x, i) => solid(`B8-shelf-${i}`, x, 346, 1, 16, 2.2)),
    solid('B9-crate', -12, 367, 1.2, 3, 2.2),
  ];
}

/** Shallow construction cues on closed walls/floors. All stay outside the
 * standing body envelope; no pipe, rack or painted channel is a foothold. */
export function depotDecorations(): BoxSpec[] {
  const decor = (name: string, x: number, y: number, z: number, w: number, h: number, d: number): BoxSpec =>
    ({ id: `depot-decor-${name}`, x, y, z, w, h, d });
  return [
    decor('B1-blue-pipe', -2, 2.65, 90.07, 8, .14, .14),
    ...[-40, -32].map((x, i) => decor(`B3-dry-channel-${i}`, x, .002, 160, .22, .004, 28)),
    ...[151, 160, 169].map((z, i) => decor(`B3-water-stain-${i}`, -47.99, .15, z, .02, .7, 3)),
    ...[228, 236].map((z, i) => decor(`B5-sealed-service-door-${i}`, 15.99, 0, z, .02, 2.7, 2)),
    ...[307, 316].map((z, i) => decor(`B7-wall-rack-${i}`, -23.94, 1.35, z, .12, .8, 2)),
    decor('B9-up-arrow-shaft', -2.01, 1, 371, .02, 1.2, .16),
    ...[0, 1, 2, 3].map((i) => decor(`B9-up-arrow-head-${i}`, -2.01, 2.05 + i * .12, 371, .02, .12, .88 - i * .22)),
  ];
}
